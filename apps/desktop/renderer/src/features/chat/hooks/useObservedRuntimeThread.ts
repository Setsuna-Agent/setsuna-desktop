import type {
  AnswerRuntimeApprovalInput,
  DesktopRuntimeClient,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeTurnIdFromThreadSnapshot,
  adoptOwnedThreadSnapshot,
  applyCurrentThreadEventBatch,
  updateThreadApprovalRun,
} from '../../../services/runtime-client/runtimeThreadState.js';

export type ObservedRuntimeThreadClient = Pick<
  DesktopRuntimeClient,
  'answerApproval' | 'getThread' | 'subscribeEvents'
>;

type ObservedRuntimeThreadOptions = {
  client: ObservedRuntimeThreadClient;
  onError?: (message: string) => void;
  onResynced?: () => void;
  threadId: string | null;
};

/**
 * 只读地观察一个已存在的 runtime 线程：加载快照、订阅 SSE、处理审批。
 * 不创建、不删除线程；关闭面板或切换对话不会影响线程本身。
 *
 * SideChat 的 create/delete 生命周期和 SubagentConversationPanel 共用本 hook，
 * 但前者额外创建临时 side 线程，后者只观察 child 线程。
 */
export function useObservedRuntimeThread({
  client,
  onError,
  onResynced,
  threadId,
}: ObservedRuntimeThreadOptions) {
  const [currentThread, setCurrentThreadState] = useState<RuntimeThread | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const terminalTurnIdsRef = useRef<Set<string>>(new Set());
  const currentThreadLastSeqRef = useRef(0);
  const currentThreadRef = useRef<RuntimeThread | null>(null);
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onResyncedRef = useRef(onResynced);
  onResyncedRef.current = onResynced;

  const setCurrentThread = useCallback<React.Dispatch<React.SetStateAction<RuntimeThread | null>>>(
    (action) => {
      const next = typeof action === 'function' ? action(currentThreadRef.current) : action;
      currentThreadRef.current = next;
      currentThreadLastSeqRef.current = next?.lastSeq ?? 0;
      setCurrentThreadState(next);
    },
    [],
  );

  useEffect(() => {
    setCurrentThread(null);
    setActiveTurnId(null);
    terminalTurnIdsRef.current.clear();
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return undefined;
    let cancelled = false;
    setCurrentThread(null);
    setActiveTurnId(null);
    terminalTurnIdsRef.current.clear();
    currentThreadLastSeqRef.current = 0;
    client.getThread(threadId).then((snapshot) => {
      if (cancelled || threadIdRef.current !== threadId) return;
      setCurrentThread(snapshot);
      setActiveTurnId(activeTurnIdFromThreadSnapshot(snapshot, terminalTurnIdsRef.current));
    }).catch((error: unknown) => {
      if (!cancelled) onErrorRef.current?.(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [client, threadId]);

  useEffect(() => {
    if (!threadId) return undefined;
    return client.subscribeEvents(threadId, currentThreadLastSeqRef.current, (batch) => {
      const current = currentThreadRef.current;
      const projection = applyCurrentThreadEventBatch(current, batch);
      if (!projection.resynced && (
        projection.thread === current || !projection.acceptedEvents.length
      )) return;
      setCurrentThread(projection.thread);

      if (projection.resynced) {
        terminalTurnIdsRef.current.clear();
        setActiveTurnId(activeTurnIdFromThreadSnapshot(
          projection.thread,
          terminalTurnIdsRef.current,
        ));
        onResyncedRef.current?.();
      }

      const activeTurnEvents = projection.acceptedEvents.filter((event) => (
        event.type === 'turn.started' || isTerminalTurnEvent(event)
      ));
      for (const event of activeTurnEvents) {
        if (!event.turnId) continue;
        if (event.type === 'turn.started') terminalTurnIdsRef.current.delete(event.turnId);
        else terminalTurnIdsRef.current.add(event.turnId);
      }
      if (activeTurnEvents.length) {
        setActiveTurnId((active) => activeTurnEvents.reduce<string | null>((next, event) => {
          if (!event.turnId) return next;
          if (event.type === 'turn.started') return event.turnId;
          return next === event.turnId ? null : next;
        }, active));
      }
      for (const event of projection.acceptedEvents) {
        if (event.type === 'runtime.error') {
          onErrorRef.current?.(event.payload.message);
        }
      }
    });
  }, [client, threadId]);

  const adoptSnapshot = useCallback((requestedThreadId: string, snapshot: RuntimeThread): boolean => {
    const current = currentThreadRef.current;
    const adopted = adoptOwnedThreadSnapshot(current, requestedThreadId, snapshot);
    if (adopted === current) return false;
    setCurrentThread(adopted);
    return true;
  }, []);

  const answerApproval = useCallback(async (approvalId: string, input: AnswerRuntimeApprovalInput) => {
    const requestedThreadId = threadIdRef.current;
    await client.answerApproval(approvalId, input);
    if (!requestedThreadId || currentThreadRef.current?.id !== requestedThreadId) return;
    const resolvedAt = new Date().toISOString();
    // 先乐观更新当前线程 toolRun，再异步拉一次线程快照校正 seq。
    setCurrentThread((thread) => (
      updateThreadApprovalRun(thread, approvalId, input, resolvedAt)
    ));
    client.getThread(requestedThreadId).then((nextThread) => {
      adoptSnapshot(requestedThreadId, nextThread);
    }).catch((error: unknown) => {
      if (currentThreadRef.current?.id === requestedThreadId) {
        onErrorRef.current?.(error instanceof Error ? error.message : String(error));
      }
    });
  }, [adoptSnapshot, client]);

  // 轮询校正快照，覆盖 SSE 断开或事件丢失的窗口。
  const effectiveActiveTurnId = activeTurnId ?? activeTurnIdFromThreadSnapshot(
    currentThread,
    terminalTurnIdsRef.current,
  );
  useEffect(() => {
    if (!effectiveActiveTurnId || !threadId) return undefined;
    let cancelled = false;
    let timeoutId: number | undefined;
    const requestedThreadId = threadId;
    const poll = async () => {
      try {
        const snapshot = await client.getThread(requestedThreadId);
        if (cancelled) return;
        if (!adoptSnapshot(requestedThreadId, snapshot)) {
          timeoutId = window.setTimeout(poll, 1000);
          return;
        }
        const snapshotTurnId = activeTurnIdFromThreadSnapshot(snapshot, terminalTurnIdsRef.current);
        if (!snapshotTurnId) {
          terminalTurnIdsRef.current.add(effectiveActiveTurnId);
          setActiveTurnId((current) => (current === effectiveActiveTurnId ? null : current));
          return;
        }
        if (snapshotTurnId !== effectiveActiveTurnId) setActiveTurnId(snapshotTurnId);
      } catch {
        // 观察线程可能已被删除；保持现状，不反复报错。
      }
      if (!cancelled) timeoutId = window.setTimeout(poll, 1000);
    };
    timeoutId = window.setTimeout(poll, 350);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [adoptSnapshot, client, effectiveActiveTurnId, threadId]);

  return useMemo(() => ({
    activeTurnId: effectiveActiveTurnId,
    adoptSnapshot,
    answerApproval,
    currentThread,
    setActiveTurnId,
  }), [
    adoptSnapshot,
    answerApproval,
    currentThread,
    effectiveActiveTurnId,
    setActiveTurnId,
  ]);
}

function isTerminalTurnEvent(event: { type: string }): boolean {
  return event.type === 'turn.completed'
    || event.type === 'turn.cancelled'
    || event.type === 'runtime.error';
}
