import type {
  AnswerRuntimeApprovalInput,
  CoreRuntimeEvent,
  RuntimeConfiguredModelReference,
  DesktopRuntimeClient,
  RuntimeReviewTarget,
  RuntimeThread,
  RuntimeThreadSummary,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { isCoreRuntimeEvent, isRuntimeActivityEvent } from '@setsuna-desktop/contracts';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { startThreadReview } from '../../features/workspace/hooks/startThreadReview.js';
import { isPrimaryConversationThread } from './runtimeThreadRelations.js';
import { useRendererFeatureViews } from '../../composition/feature-view-registries.js';
import { useIdentityRequestGuard } from '../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { readBrowserStorageValue, writeBrowserStorageValue } from '../../shared/preferences/browserStorage.js';
import {
  reportRuntimeBackgroundFailure,
  runtimeClientErrorMessage,
} from './runtimeClientErrors.js';
import {
  activeTurnIdFromThreadSnapshot,
  adoptOwnedThreadSnapshot,
  applyCurrentThreadEventBatch,
  isThreadContextCompacting,
  selectInitialThreadSummary,
  updateThreadApprovalRun,
} from './runtimeThreadState.js';

const lastActiveThreadStorageKey = 'setsuna-desktop:last-active-thread-id';

export type RuntimeThreadClient = Pick<
  DesktopRuntimeClient,
  | 'answerApproval'
  | 'clearThreadContext'
  | 'compactThreadContext'
  | 'createThread'
  | 'deleteThread'
  | 'getThread'
  | 'listThreads'
  | 'startReview'
  | 'subscribeEvents'
  | 'updateThread'
>;

export type RuntimeThreadBootstrap = {
  allThreads: RuntimeThreadSummary[];
  projects: WorkspaceProject[];
  visibleThreads: RuntimeThreadSummary[];
};

export type RuntimeTurnSettlement = {
  refreshThreadUsage: boolean;
  refreshUsage: boolean;
  threadId: string;
};

type RuntimeThreadStateOptions = {
  activeProjectId: string | null;
  client: RuntimeThreadClient;
  onError: (message: string) => void;
  onTurnSettled: (settlement: RuntimeTurnSettlement) => void;
  setActiveProjectId: Dispatch<SetStateAction<string | null>>;
};

/**
 * Owns the main conversation's thread snapshots, SSE sequence, and active-turn lifecycle.
 *
 * Cross-domain capability/usage refreshes are emitted through `onTurnSettled` so this hook
 * does not depend on those state domains.
 */
export function useRuntimeThreadState({
  activeProjectId,
  client,
  onError,
  onTurnSettled,
  setActiveProjectId,
}: RuntimeThreadStateOptions) {
  const { locale, t } = useI18n();
  const featureViews = useRendererFeatureViews();
  const [threads, setThreads] = useState<RuntimeThreadSummary[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<RuntimeThreadSummary[]>([]);
  const [currentThread, setCurrentThreadState] = useState<RuntimeThread | null>(null);
  const [contextCompactingThreadId, setContextCompactingThreadId] = useState<string | null>(null);
  const [activityEvents, setActivityEvents] = useState<CoreRuntimeEvent[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const initializedSelectionRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const currentThreadLastSeqRef = useRef(0);
  const currentThreadRef = useRef<RuntimeThread | null>(currentThread);
  const threadListRefreshTimerRef = useRef<number | null>(null);
  const threadSummaryPollingActiveRef = useRef(false);
  // 终态 turn 记录在本地，避免延迟快照把已完成 turn 重新推断成 active。
  const terminalTurnIdsRef = useRef<Set<string>>(new Set());
  const currentThreadId = currentThread?.id ?? null;
  const contextRequests = useIdentityRequestGuard(currentThreadId ?? 'no-current-thread');

  if (currentThreadRef.current?.id !== currentThreadId) {
    currentThreadLastSeqRef.current = currentThread?.lastSeq ?? 0;
  } else {
    currentThreadLastSeqRef.current = Math.max(
      currentThreadLastSeqRef.current,
      currentThread?.lastSeq ?? 0,
    );
  }
  currentThreadRef.current = currentThread;

  /** Keep local mutations and the synchronous SSE owner on one ordered state path. */
  const setCurrentThread = useCallback<Dispatch<SetStateAction<RuntimeThread | null>>>(
    (action) => {
      // Resolve functional mutations against the ref immediately. Otherwise an SSE
      // event received before React commits could project from stale state and replace
      // an optimistic approval/goal mutation queued in front of it.
      const next = typeof action === 'function'
        ? action(currentThreadRef.current)
        : action;
      currentThreadRef.current = next;
      currentThreadLastSeqRef.current = next?.lastSeq ?? 0;
      setCurrentThreadState(next);
    },
    [],
  );

  const contextCompacting = isThreadContextCompacting(
    contextCompactingThreadId,
    currentThreadId,
  );
  const effectiveActiveTurnId = activeTurnId ?? activeTurnIdFromThreadSnapshot(
    currentThread,
    terminalTurnIdsRef.current,
  );
  const hasRunningThreadSummary = threads.some((thread) => Boolean(thread.activeTurnId))
    || archivedThreads.some((thread) => Boolean(thread.activeTurnId));
  threadSummaryPollingActiveRef.current = Boolean(
    effectiveActiveTurnId || hasRunningThreadSummary,
  );

  const adoptSnapshot = useCallback((
    requestedThreadId: string,
    snapshot: RuntimeThread,
  ): boolean => {
    const current = currentThreadRef.current;
    const adopted = adoptOwnedThreadSnapshot(current, requestedThreadId, snapshot);
    if (adopted === current) return false;
    currentThreadRef.current = adopted;
    currentThreadLastSeqRef.current = adopted?.lastSeq ?? 0;
    setCurrentThreadState(adopted);
    return true;
  }, []);

  const applyBootstrapThreads = useCallback(async ({
    allThreads,
    projects,
    visibleThreads,
  }: RuntimeThreadBootstrap) => {
    const primaryThreads = visibleThreads.filter(isPrimaryConversationThread);
    setThreads(primaryThreads);
    setArchivedThreads(allThreads.filter((thread) => thread.archived && isPrimaryConversationThread(thread)));
    if (initializedSelectionRef.current) return;

    initializedSelectionRef.current = true;
    const initialThread = selectInitialThreadSummary(
      primaryThreads,
      readPersistedActiveThreadId(),
    );
    if (initialThread) {
      try {
        const thread = await client.getThread(initialThread.id);
        setCurrentThread(thread);
        setActiveProjectId(thread.projectId ?? null);
        return;
      } catch (unknownError) {
        console.warn('[runtime] failed to restore the last active thread', unknownError);
        setCurrentThread(null);
      }
    }
    setActiveProjectId((current) => current ?? projects[0]?.id ?? null);
  }, [client, setActiveProjectId, setCurrentThread]);

  useEffect(() => {
    if (currentThreadId) persistActiveThreadId(currentThreadId);
  }, [currentThreadId]);

  const refreshThreadsSoon = useCallback((force = false) => {
    // The one-second summary poll already owns sidebar freshness while turns run.
    // Avoid turning every streamed token/event into another localhost request.
    if (!force && threadSummaryPollingActiveRef.current) return;
    if (threadListRefreshTimerRef.current !== null) return;
    // 线程列表摘要不需要每条 SSE 都立即刷新，短 debounce 足够保持侧栏一致。
    threadListRefreshTimerRef.current = window.setTimeout(() => {
      threadListRefreshTimerRef.current = null;
      void client
        .listThreads()
        .then((list) => setThreads(list.threads.filter(isPrimaryConversationThread)))
        .catch((unknownError) => {
          reportRuntimeBackgroundFailure('thread list refresh', unknownError);
        });
    }, 120);
  }, [client]);

  useEffect(() => {
    if (!effectiveActiveTurnId && !hasRunningThreadSummary) return undefined;
    let cancelled = false;
    let timeoutId: number | undefined;
    const pollThreadSummaries = async () => {
      try {
        const all = await client.listThreads({ includeArchived: true });
        if (cancelled) return;
        setThreads(all.threads.filter((thread) => !thread.archived && isPrimaryConversationThread(thread)));
        setArchivedThreads(all.threads.filter((thread) => thread.archived && isPrimaryConversationThread(thread)));
        const stillRunning = all.threads.some((thread) => Boolean(thread.activeTurnId));
        if (stillRunning || effectiveActiveTurnId) {
          timeoutId = window.setTimeout(pollThreadSummaries, 1000);
        }
      } catch (unknownError) {
        if (!cancelled) {
          reportRuntimeBackgroundFailure('running thread summaries refresh', unknownError);
          timeoutId = window.setTimeout(pollThreadSummaries, 1000);
        }
      }
    };
    timeoutId = window.setTimeout(pollThreadSummaries, 250);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [client, effectiveActiveTurnId, hasRunningThreadSummary]);

  useEffect(() => () => {
    if (threadListRefreshTimerRef.current !== null) {
      window.clearTimeout(threadListRefreshTimerRef.current);
      threadListRefreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    setActivityEvents([]);
    terminalTurnIdsRef.current.clear();
    setActiveTurnId(null);
  }, [currentThreadId]);

  useEffect(() => {
    unsubscribeRef.current?.();
    if (!currentThreadId) return undefined;
    // Projection and every event side effect share one owner/sequence acceptance gate.
    unsubscribeRef.current = client.subscribeEvents(
      currentThreadId,
      currentThreadLastSeqRef.current,
      (batch) => {
        const current = currentThreadRef.current;
        const projection = applyCurrentThreadEventBatch(current, batch);
        if (!projection.resynced && (
          projection.thread === current || !projection.acceptedEvents.length
        )) return;

        currentThreadRef.current = projection.thread;
        currentThreadLastSeqRef.current = projection.thread?.lastSeq
          ?? projection.acceptedEvents.at(-1)?.seq
          ?? currentThreadLastSeqRef.current;
        // The bridge batch owns one React projection commit, independent of its token count.
        setCurrentThreadState(projection.thread);

        if (projection.resynced) {
          if (projection.thread) {
            featureViews.events.advance(projection.thread.id, projection.thread.lastSeq);
          }
          setActivityEvents([]);
          terminalTurnIdsRef.current.clear();
          setActiveTurnId(activeTurnIdFromThreadSnapshot(
            projection.thread,
            terminalTurnIdsRef.current,
          ));
          refreshThreadsSoon(true);
        }

        for (const event of projection.acceptedEvents) featureViews.events.accept(event);
        const coreEvents = projection.acceptedEvents.filter(isCoreRuntimeEvent);
        const activityBatch = coreEvents.filter(isRuntimeActivityEvent);
        if (activityBatch.length) {
          setActivityEvents((items) => mergeRecentActivityEvents(items, activityBatch));
        }
        const terminalTurnEvent = coreEvents.some(isTerminalTurnEvent);
        refreshThreadsSoon(terminalTurnEvent);
        const activeTurnEvents = coreEvents.filter((event) => (
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
        for (const event of coreEvents) {
          if (event.type === 'runtime.error') onError(event.payload.message);
          if (event.type !== 'turn.completed') continue;
          const refreshUsage = Boolean(event.payload.usage);
          onTurnSettled({
            threadId: event.threadId,
            refreshUsage,
            refreshThreadUsage: refreshUsage,
          });
        }
      },
    );
    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [client, currentThreadId, featureViews.events, onError, onTurnSettled, refreshThreadsSoon]);

  useEffect(() => {
    if (!effectiveActiveTurnId || !currentThreadId) {
      return undefined;
    }
    let cancelled = false;
    let timeoutId: number | undefined;
    const threadId = currentThreadId;
    const turnId = effectiveActiveTurnId;

    // polling 校正线程快照和 activeTurnId；runtime 快照里的 activeTurnId 是终态兜底真源。
    const pollThread = async () => {
      let continuePolling = true;
      try {
        const nextThread = await client.getThread(threadId);
        if (cancelled) return;
        if (!adoptSnapshot(threadId, nextThread)) {
          // A switched owner stops this polling loop. A temporarily older snapshot is
          // ignored and retried without applying turn or refresh side effects.
          continuePolling = currentThreadRef.current?.id === threadId;
          if (!cancelled && continuePolling) {
            timeoutId = window.setTimeout(pollThread, 1000);
          }
          return;
        }
        refreshThreadsSoon();
        const snapshotActiveTurnId = activeTurnIdFromThreadSnapshot(
          nextThread,
          terminalTurnIdsRef.current,
        );
        if (!turnId) {
          if (snapshotActiveTurnId) {
            terminalTurnIdsRef.current.delete(snapshotActiveTurnId);
            setActiveTurnId(snapshotActiveTurnId);
          } else {
            continuePolling = false;
          }
        } else if (!snapshotActiveTurnId) {
          terminalTurnIdsRef.current.add(turnId);
          setActiveTurnId((active) => (active === turnId ? null : active));
          refreshThreadsSoon(true);
          onTurnSettled({
            threadId,
            refreshUsage: true,
            refreshThreadUsage: false,
          });
          continuePolling = false;
        } else if (snapshotActiveTurnId !== turnId) {
          terminalTurnIdsRef.current.delete(snapshotActiveTurnId);
          setActiveTurnId(snapshotActiveTurnId);
        }
      } catch (unknownError) {
        if (!cancelled) {
          reportRuntimeBackgroundFailure('active thread snapshot refresh', unknownError);
        }
      }
      if (!cancelled && continuePolling) {
        timeoutId = window.setTimeout(pollThread, 1000);
      }
    };

    timeoutId = window.setTimeout(pollThread, 250);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [
    adoptSnapshot,
    client,
    currentThreadId,
    effectiveActiveTurnId,
    onTurnSettled,
    refreshThreadsSoon,
  ]);

  const reloadThreads = useCallback(async () => {
    const [list, allList] = await Promise.all([
      client.listThreads(),
      client.listThreads({ includeArchived: true }),
    ]);
    const primaryThreads = list.threads.filter(isPrimaryConversationThread);
    setThreads(primaryThreads);
    setArchivedThreads(allList.threads.filter((thread) => thread.archived && isPrimaryConversationThread(thread)));
    return primaryThreads;
  }, [client]);

  const clearCurrentThreadContext = useCallback(async () => {
    if (!currentThread) return null;
    const requestedThreadId = currentThread.id;
    const isCurrentRequest = contextRequests.begin();
    const cleared = await client.clearThreadContext(requestedThreadId);
    if (isCurrentRequest()) adoptSnapshot(requestedThreadId, cleared);
    await reloadThreads();
    return cleared;
  }, [adoptSnapshot, client, contextRequests, currentThread, reloadThreads]);

  const compactCurrentThreadContext = useCallback(async () => {
    if (!currentThread || contextCompacting) return null;
    const requestedThreadId = currentThread.id;
    const isCurrentRequest = contextRequests.begin();
    setContextCompactingThreadId(requestedThreadId);
    try {
      // 手动压缩会立刻置本地 loading，最终状态仍以 runtime 返回的 thread 为准。
      const compacted = await client.compactThreadContext(requestedThreadId);
      if (isCurrentRequest()) adoptSnapshot(requestedThreadId, compacted);
      await reloadThreads();
      return compacted;
    } catch (unknownError) {
      if (isCurrentRequest() && currentThreadRef.current?.id === requestedThreadId) {
        onError(runtimeClientErrorMessage(unknownError));
        setCurrentThread((thread) => (
          thread?.id === requestedThreadId && thread.contextCompaction?.status === 'running'
            ? { ...thread, contextCompaction: undefined }
            : thread
        ));
      }
      return null;
    } finally {
      setContextCompactingThreadId((active) => (
        active === requestedThreadId ? null : active
      ));
    }
  }, [
    adoptSnapshot,
    client,
    contextCompacting,
    contextRequests,
    currentThread,
    onError,
    reloadThreads,
    setCurrentThread,
  ]);

  const restoreArchivedThread = useCallback(async (threadId: string) => {
    const restored = await client.updateThread(threadId, { archived: false });
    await reloadThreads();
    return restored;
  }, [client, reloadThreads]);

  const permanentlyDeleteThread = useCallback(async (threadId: string) => {
    await client.deleteThread(threadId);
    await reloadThreads();
  }, [client, reloadThreads]);

  const permanentlyDeleteArchivedThreads = useCallback(async (threadIds: string[]) => {
    const uniqueThreadIds = [...new Set(threadIds)];
    if (!uniqueThreadIds.length) return;

    const results = await Promise.allSettled(
      uniqueThreadIds.map((threadId) => client.deleteThread(threadId)),
    );
    await reloadThreads();

    const failureCount = results.filter((result) => result.status === 'rejected').length;
    if (failureCount) {
      throw new Error(t('settings.archives.deleteSomeError', { count: failureCount }));
    }
  }, [client, reloadThreads, t]);

  const startCurrentThreadReview = useCallback(async (
    target: RuntimeReviewTarget,
    scope?: {
      claimComposerForThread: (threadId: string) => void;
      isCurrentRequest: () => boolean;
      modelSelection?: RuntimeConfiguredModelReference;
    },
  ) => {
    const isCurrentRequest = scope?.isCurrentRequest ?? (() => true);
    const started = await startThreadReview({
      activeProjectId,
      client,
      currentThread,
      language: locale,
      modelSelection: scope?.modelSelection,
      onThreadCreated: async (thread) => {
        if (isCurrentRequest()) {
          scope?.claimComposerForThread(thread.id);
          setCurrentThread(thread);
        }
        await reloadThreads();
      },
      t,
      target,
    });
    if (isCurrentRequest()) setActiveTurnId(started.turnId);
    return started;
  }, [
    activeProjectId,
    client,
    currentThread,
    locale,
    reloadThreads,
    setCurrentThread,
    t,
  ]);

  const answerApproval = useCallback(
    async (approvalId: string, input: AnswerRuntimeApprovalInput) => {
      const requestedThreadId = currentThreadId;
      await client.answerApproval(approvalId, input);
      if (!requestedThreadId || currentThreadRef.current?.id !== requestedThreadId) return;
      const resolvedAt = new Date().toISOString();
      // 先乐观更新当前线程 toolRun，再异步拉一次线程快照校正 seq。
      setCurrentThread((thread) => (
        updateThreadApprovalRun(thread, approvalId, input, resolvedAt)
      ));
      client
        .getThread(requestedThreadId)
        .then((nextThread) => adoptSnapshot(requestedThreadId, nextThread))
        .catch((unknownError) => {
          if (currentThreadRef.current?.id === requestedThreadId) {
            reportRuntimeBackgroundFailure('approval snapshot reconciliation', unknownError);
          }
        });
    },
    [adoptSnapshot, client, currentThreadId, setCurrentThread],
  );

  return {
    activeTurnId: effectiveActiveTurnId,
    activityEvents,
    answerApproval,
    applyBootstrapThreads,
    archivedThreads,
    clearCurrentThreadContext,
    compactCurrentThreadContext,
    contextCompacting,
    currentThread,
    permanentlyDeleteArchivedThreads,
    permanentlyDeleteThread,
    reloadThreads,
    restoreArchivedThread,
    setActiveTurnId,
    setCurrentThread,
    startCurrentThreadReview,
    terminalTurnIdsRef,
    threads,
  };
}

function isTerminalTurnEvent(event: CoreRuntimeEvent): boolean {
  return event.type === 'turn.completed'
    || event.type === 'turn.cancelled'
    || event.type === 'runtime.error';
}

function mergeRecentActivityEvents(
  current: CoreRuntimeEvent[],
  incoming: CoreRuntimeEvent[],
): CoreRuntimeEvent[] {
  const seen = new Set<string>();
  return [...incoming].reverse().concat(current).filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  }).slice(0, 80);
}

function readPersistedActiveThreadId(): string | null {
  return normalizeStoredThreadId(readBrowserStorageValue(lastActiveThreadStorageKey));
}

function persistActiveThreadId(threadId: string): void {
  writeBrowserStorageValue(lastActiveThreadStorageKey, threadId);
}

function normalizeStoredThreadId(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}
