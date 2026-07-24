import type {
  AnswerRuntimeApprovalInput,
  DesktopRuntimeClient,
  RuntimeReviewTarget,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeUsageResponse,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { applyRuntimeEvent } from '../../../services/runtime-client/runtimeEvents.js';
import {
  activeTurnIdFromThreadSnapshot,
  isThreadContextCompacting,
} from '../../../services/runtime-client/useRuntimeClientState.js';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useLatestRequestGuard } from '../../../shared/hooks/useLatestRequestGuard.js';
import { startThreadReview } from '../../workspace/hooks/startThreadReview.js';
import { chatComposerTargetIdentity, useChatComposerSession } from './useChatComposerSession.js';
import { useChatTurnActions } from './useChatTurnActions.js';

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
  const { t } = useI18n();
  const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [threadUsage, setThreadUsage] = useState<RuntimeUsageResponse | null>(null);
  const [contextCompactingThreadId, setContextCompactingThreadId] = useState<string | null>(null);
  const terminalTurnIdsRef = useRef<Set<string>>(new Set());
  const currentThreadLastSeqRef = useRef(0);
  const memoryModeRequests = useLatestRequestGuard();
  const threadId = currentThread?.id ?? null;
  const {
    claimForThread: claimComposerForThread,
    composerKey,
    draft,
    reset: resetComposer,
    setDraft,
  } = useChatComposerSession(chatComposerTargetIdentity(
    threadId,
    threadId ? null : activeProjectId,
  ));
  const contextRequests = useIdentityRequestGuard(threadId ?? `new-side-thread:${activeProjectId ?? 'global'}`);
  const reviewRequests = useIdentityRequestGuard(composerKey);
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const contextCompacting = isThreadContextCompacting(contextCompactingThreadId, threadId);
  const effectiveActiveTurnId = activeTurnId ?? activeTurnIdFromThreadSnapshot(currentThread, terminalTurnIdsRef.current);
  currentThreadLastSeqRef.current = currentThread?.lastSeq ?? 0;

  useEffect(() => {
    // 侧边对话沿用打开时的项目上下文；主区切换项目后从空白侧边对话重新开始。
    setCurrentThread(null);
    resetComposer();
    setActiveTurnId(null);
    setThreadUsage(null);
    memoryModeRequests.invalidate();
    terminalTurnIdsRef.current.clear();
  }, [activeProjectId, memoryModeRequests, resetComposer]);

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
        if (event.payload.usage) {
          void client.getUsage({ threadId: event.threadId }).then((nextUsage) => {
            if (threadIdRef.current === event.threadId) setThreadUsage(nextUsage);
          });
        }
      }
    });
  }, [client, reloadThreads, setError, threadId]);

  useEffect(() => {
    if (!threadId) {
      setThreadUsage(null);
      return;
    }
    let cancelled = false;
    const requestedThreadId = threadId;
    setThreadUsage(null);
    void client.getUsage({ threadId: requestedThreadId }).then((nextUsage) => {
      if (!cancelled && threadIdRef.current === requestedThreadId) setThreadUsage(nextUsage);
    }).catch((error) => {
      if (!cancelled) setError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
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
    claimComposerForThread,
    client,
    composerKey,
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
    const isCurrentRequest = contextRequests.begin();
    const updated = await client.clearThreadContext(currentThread.id);
    if (isCurrentRequest()) setCurrentThread(updated);
    await reloadThreads();
    return updated;
  }, [client, contextRequests, currentThread, reloadThreads]);

  const compactContext = useCallback(async () => {
    if (!currentThread || contextCompacting) return null;
    const requestedThreadId = currentThread.id;
    const isCurrentRequest = contextRequests.begin();
    setContextCompactingThreadId(requestedThreadId);
    try {
      const updated = await client.compactThreadContext(requestedThreadId);
      if (isCurrentRequest()) {
        setCurrentThread((current) => (
          current?.id === requestedThreadId && updated.lastSeq >= current.lastSeq ? updated : current
        ));
      }
      await reloadThreads();
      return updated;
    } finally {
      setContextCompactingThreadId((current) => current === requestedThreadId ? null : current);
    }
  }, [client, contextCompacting, contextRequests, currentThread, reloadThreads]);

  const updateMemoryMode = useCallback(async (mode: RuntimeThreadMemoryMode) => {
    if (!currentThread) return null;
    const requestedThreadId = currentThread.id;
    const isLatest = memoryModeRequests.begin();
    const updated = await client.updateThreadMemoryMode(requestedThreadId, { mode });
    if (isLatest() && threadIdRef.current === requestedThreadId) {
      setCurrentThread((thread) => (
        thread?.id === requestedThreadId && updated.lastSeq >= thread.lastSeq ? updated : thread
      ));
    }
    await reloadThreads();
    return updated;
  }, [client, currentThread, memoryModeRequests, reloadThreads]);

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
    const requestedThreadId = threadId;
    const updated = await client.getThread(requestedThreadId);
    if (threadIdRef.current === requestedThreadId) {
      setCurrentThread((current) => (!current || updated.lastSeq >= current.lastSeq ? updated : current));
    }
  }, [client, threadId]);

  const startReview = useCallback(async (target: RuntimeReviewTarget) => {
    const isCurrentRequest = reviewRequests.begin();
    const started = await startThreadReview({
      activeProjectId,
      client,
      currentThread,
      onThreadCreated: async (thread) => {
        if (isCurrentRequest()) {
          claimComposerForThread(thread.id);
          setCurrentThread(thread);
        }
        await reloadThreads();
      },
      t,
      target,
    });
    if (isCurrentRequest()) setActiveTurnId(started.turnId);
    return started;
  }, [activeProjectId, claimComposerForThread, client, currentThread, reloadThreads, reviewRequests, t]);

  return useMemo(() => ({
    actions,
    activeTurnId: effectiveActiveTurnId,
    answerApproval,
    clearContext,
    clearGoal,
    composerKey,
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
    composerKey,
    compactContext,
    contextCompacting,
    currentThread,
    draft,
    effectiveActiveTurnId,
    setDraft,
    startReview,
    threadUsage,
    updateMemoryMode,
  ]);
}
