import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AnswerRuntimeApprovalInput,
  DesktopRuntimeClient,
  RuntimeReviewTarget,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeUsageResponse,
} from '@setsuna-desktop/contracts';
import { useChatTurnActions } from './useChatTurnActions.js';
import { activeTurnIdFromThreadSnapshot } from './useRuntimeClientState.js';
import { applyRuntimeEvent } from '../utils/runtimeEvents.js';

type SideChatOptions = {
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  reloadThreads: () => Promise<unknown>;
  setError: Dispatch<SetStateAction<string | null>>;
};

/**
 * 维护右侧对话自己的线程快照和 SSE 订阅，避免它与主对话共享草稿或活动 turn。
 */
export function useSideChat({
  activeProjectId,
  client,
  reloadThreads,
  setError,
}: SideChatOptions) {
  const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(null);
  const [draft, setDraft] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [threadUsage, setThreadUsage] = useState<RuntimeUsageResponse | null>(null);
  const [contextCompacting, setContextCompacting] = useState(false);
  const terminalTurnIdsRef = useRef<Set<string>>(new Set());
  const currentThreadLastSeqRef = useRef(0);
  const threadId = currentThread?.id ?? null;
  const effectiveActiveTurnId = activeTurnId ?? activeTurnIdFromThreadSnapshot(currentThread, terminalTurnIdsRef.current);
  currentThreadLastSeqRef.current = currentThread?.lastSeq ?? 0;

  useEffect(() => {
    // 侧边任务沿用打开时的项目上下文；主区切换项目后从空白侧边任务重新开始。
    setCurrentThread(null);
    setDraft('');
    setActiveTurnId(null);
    setThreadUsage(null);
    terminalTurnIdsRef.current.clear();
  }, [activeProjectId]);

  useEffect(() => {
    if (!threadId) return undefined;
    return client.subscribeEvents(threadId, currentThreadLastSeqRef.current, (event) => {
      setCurrentThread((thread) => {
        if (!thread || thread.id !== event.threadId || event.seq <= thread.lastSeq) return thread;
        return applyRuntimeEvent(thread, event);
      });
      if (event.type === 'turn.started' && event.turnId) {
        terminalTurnIdsRef.current.delete(event.turnId);
        setActiveTurnId(event.turnId);
        void reloadThreads();
      }
      if ((event.type === 'turn.completed' || event.type === 'turn.cancelled' || event.type === 'runtime.error') && event.turnId) {
        terminalTurnIdsRef.current.add(event.turnId);
        setActiveTurnId((current) => (current === event.turnId ? null : current));
        void reloadThreads();
      }
      if (event.type === 'runtime.error') setError(event.payload.message);
      if (event.type === 'turn.completed') {
        if (event.payload.usage) void client.getUsage({ threadId: event.threadId }).then(setThreadUsage);
      }
    });
  }, [client, reloadThreads, setError, threadId]);

  useEffect(() => {
    if (!threadId) {
      setThreadUsage(null);
      return;
    }
    void client.getUsage({ threadId }).then(setThreadUsage).catch((error) => {
      setError(error instanceof Error ? error.message : String(error));
    });
  }, [client, setError, threadId]);

  useEffect(() => {
    if (!effectiveActiveTurnId || !threadId) return undefined;
    let cancelled = false;
    let timeoutId: number | undefined;
    const poll = async () => {
      try {
        const snapshot = await client.getThread(threadId);
        if (cancelled) return;
        setCurrentThread((current) => (!current || current.id !== threadId || snapshot.lastSeq >= current.lastSeq ? snapshot : current));
        const snapshotTurnId = activeTurnIdFromThreadSnapshot(snapshot, terminalTurnIdsRef.current);
        if (!snapshotTurnId) {
          terminalTurnIdsRef.current.add(effectiveActiveTurnId);
          setActiveTurnId((current) => (current === effectiveActiveTurnId ? null : current));
          void reloadThreads();
          return;
        }
        if (snapshotTurnId !== effectiveActiveTurnId) setActiveTurnId(snapshotTurnId);
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : String(error));
      }
      if (!cancelled) timeoutId = window.setTimeout(poll, 1000);
    };
    timeoutId = window.setTimeout(poll, 350);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [client, effectiveActiveTurnId, reloadThreads, setError, threadId]);

  const actions = useChatTurnActions({
    activeProjectId,
    activeTurnId: effectiveActiveTurnId,
    client,
    currentThread,
    draft,
    reloadThreads,
    setActiveTurnId,
    setCurrentThread,
    setDraft,
    setError,
    terminalTurnIdsRef,
  });

  const clearContext = useCallback(async () => {
    if (!currentThread) return null;
    const updated = await client.clearThreadContext(currentThread.id);
    setCurrentThread(updated);
    await reloadThreads();
    return updated;
  }, [client, currentThread, reloadThreads]);

  const compactContext = useCallback(async () => {
    if (!currentThread || contextCompacting) return null;
    setContextCompacting(true);
    try {
      const updated = await client.compactThreadContext(currentThread.id);
      setCurrentThread((current) => (!current || updated.lastSeq >= current.lastSeq ? updated : current));
      await reloadThreads();
      return updated;
    } finally {
      setContextCompacting(false);
    }
  }, [client, contextCompacting, currentThread, reloadThreads]);

  const updateMemoryMode = useCallback(async (mode: RuntimeThreadMemoryMode) => {
    if (!currentThread) return null;
    const updated = await client.updateThreadMemoryMode(currentThread.id, { mode });
    setCurrentThread(updated);
    await reloadThreads();
    return updated;
  }, [client, currentThread, reloadThreads]);

  const clearGoal = useCallback(async () => {
    if (!currentThread) return false;
    const cleared = await client.clearThreadGoal(currentThread.id);
    if (cleared) {
      setCurrentThread((current) => {
        if (!current || current.id !== currentThread.id) return current;
        const next = { ...current };
        delete next.goal;
        return next;
      });
    }
    await reloadThreads();
    return cleared;
  }, [client, currentThread, reloadThreads]);

  const answerApproval = useCallback(async (approvalId: string, input: AnswerRuntimeApprovalInput) => {
    await client.answerApproval(approvalId, input);
    if (!threadId) return;
    const updated = await client.getThread(threadId);
    setCurrentThread((current) => (!current || updated.lastSeq >= current.lastSeq ? updated : current));
  }, [client, threadId]);

  const startReview = useCallback(async (target: RuntimeReviewTarget) => {
    if (!currentThread) return null;
    const started = await client.startReview(currentThread.id, target);
    setActiveTurnId(started.turnId);
    return started;
  }, [client, currentThread]);

  return useMemo(() => ({
    actions,
    activeTurnId: effectiveActiveTurnId,
    answerApproval,
    clearContext,
    clearGoal,
    compactContext,
    contextCompacting,
    currentThread,
    draft,
    setDraft,
    startReview,
    threadUsage,
    updateMemoryMode,
  }), [
    actions,
    answerApproval,
    clearContext,
    clearGoal,
    compactContext,
    contextCompacting,
    currentThread,
    draft,
    effectiveActiveTurnId,
    startReview,
    threadUsage,
    updateMemoryMode,
  ]);
}
