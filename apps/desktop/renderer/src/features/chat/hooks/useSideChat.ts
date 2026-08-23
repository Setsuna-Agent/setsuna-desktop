import type {
  AnswerRuntimeApprovalInput,
  CoreRuntimeEvent,
  DesktopRuntimeClient,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimeReviewTarget,
  RuntimeThread,
  RuntimeUsageResponse,
} from '@setsuna-desktop/contracts';
import { isCoreRuntimeEvent } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  activeTurnIdFromThreadSnapshot,
  applyCurrentThreadEventBatch,
  isThreadContextCompacting,
} from '../../../services/runtime-client/runtimeThreadState.js';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useRendererFeatureViews } from '../../../composition/feature-view-registries.js';
import { startThreadReview } from '../../workspace/hooks/startThreadReview.js';
import { chatComposerTargetIdentity, useChatComposerSession } from './useChatComposerSession.js';
import { useChatTurnActions } from './useChatTurnActions.js';

type SideChatOptions = {
  activeProjectId: string | null;
  client: DesktopRuntimeClient;
  config: RuntimeConfigState | null;
  parentThread: RuntimeThread | null;
  reloadThreads: () => Promise<unknown>;
  setError: Dispatch<SetStateAction<string | null>>;
};

type SideConversationCreationClient = Pick<
  DesktopRuntimeClient,
  'createSideConversation' | 'deleteThread'
>;

/**
 * The panel owner can disappear while the runtime is creating its snapshot.
 * A stale result must be deleted before control returns to the send pipeline.
 */
export async function createSideConversationForOwner(
  client: SideConversationCreationClient,
  parentThreadId: string,
  isCurrentOwner: () => boolean,
): Promise<RuntimeThread> {
  const thread = await client.createSideConversation(parentThreadId);
  if (isCurrentOwner()) return thread;
  await client.deleteThread(thread.id).catch(() => undefined);
  throw new Error('Side conversation owner changed before creation completed.');
}

/**
 * 维护右侧对话自己的线程快照和 SSE 订阅，避免它与主对话共享草稿或活动 turn。
 */
export function useSideChat({
  activeProjectId,
  client,
  config,
  parentThread,
  reloadThreads,
  setError,
}: SideChatOptions) {
  const { locale, t } = useI18n();
  const featureViews = useRendererFeatureViews();
  const [currentThread, setCurrentThreadState] = useState<RuntimeThread | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [threadUsage, setThreadUsage] = useState<RuntimeUsageResponse | null>(null);
  const [contextCompactingThreadId, setContextCompactingThreadId] = useState<string | null>(null);
  const terminalTurnIdsRef = useRef<Set<string>>(new Set());
  const currentThreadLastSeqRef = useRef(0);
  const currentThreadRef = useRef<RuntimeThread | null>(currentThread);
  const parentThreadId = parentThread?.id ?? null;
  const threadId = currentThread?.id ?? null;
  const {
    claimForThread: claimComposerForThread,
    composerKey,
    draft,
    reset: resetComposer,
    setDraft,
  } = useChatComposerSession(chatComposerTargetIdentity(
    threadId,
    threadId ? null : parentThreadId ? `side:${parentThreadId}` : 'side:unavailable',
  ));
  const contextRequests = useIdentityRequestGuard(threadId ?? `new-side-thread:${parentThreadId ?? 'unavailable'}`);
  const creationRequests = useIdentityRequestGuard(`side-conversation-owner:${parentThreadId ?? 'unavailable'}`);
  const reviewRequests = useIdentityRequestGuard(composerKey);
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const contextCompacting = isThreadContextCompacting(contextCompactingThreadId, threadId);
  const effectiveActiveTurnId = activeTurnId ?? activeTurnIdFromThreadSnapshot(currentThread, terminalTurnIdsRef.current);
  if (currentThreadRef.current?.id !== threadId) {
    currentThreadLastSeqRef.current = currentThread?.lastSeq ?? 0;
  } else {
    currentThreadLastSeqRef.current = Math.max(
      currentThreadLastSeqRef.current,
      currentThread?.lastSeq ?? 0,
    );
  }
  currentThreadRef.current = currentThread;

  const setCurrentThread = useCallback<Dispatch<SetStateAction<RuntimeThread | null>>>(
    (action) => {
      const next = typeof action === 'function' ? action(currentThreadRef.current) : action;
      currentThreadRef.current = next;
      currentThreadLastSeqRef.current = next?.lastSeq ?? 0;
      setCurrentThreadState(next);
    },
    [],
  );

  useEffect(() => {
    const staleThreadId = currentThreadRef.current?.id;
    if (staleThreadId) void client.deleteThread(staleThreadId).catch(() => undefined);
    // Side context is bound to one primary thread; changing the primary starts
    // a fresh snapshot and disposes the previous transient fork.
    setCurrentThread(null);
    resetComposer();
    setActiveTurnId(null);
    setThreadUsage(null);
    terminalTurnIdsRef.current.clear();
  }, [client, parentThreadId, resetComposer]);

  useEffect(() => () => {
    // setCurrentThread updates this ref synchronously, so cleanup also sees a
    // thread accepted immediately before React has committed the next render.
    const staleThreadId = currentThreadRef.current?.id;
    if (staleThreadId) void client.deleteThread(staleThreadId).catch(() => undefined);
  }, [client]);

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
        if (projection.thread) {
          featureViews.events.advance(projection.thread.id, projection.thread.lastSeq);
        }
        terminalTurnIdsRef.current.clear();
        setActiveTurnId(activeTurnIdFromThreadSnapshot(
          projection.thread,
          terminalTurnIdsRef.current,
        ));
        void reloadThreads();
      }

      for (const event of projection.acceptedEvents) featureViews.events.accept(event);
      const coreEvents = projection.acceptedEvents.filter(isCoreRuntimeEvent);
      const activeTurnEvents = coreEvents.filter((event) => (
        event.type === 'turn.started' || isTerminalSideChatEvent(event)
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
        void reloadThreads();
      }
      for (const event of coreEvents) {
        if (event.type === 'runtime.error') setError(event.payload.message);
        if (event.type !== 'turn.completed') continue;
        if (event.payload.usage) {
          void client.getUsage({ threadId: event.threadId }).then((nextUsage) => {
            if (threadIdRef.current === event.threadId) setThreadUsage(nextUsage);
          });
        }
      }
    });
  }, [client, featureViews.events, reloadThreads, setError, threadId]);

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

  const createSideConversation = useCallback(async () => {
    if (!parentThreadId) throw new Error(t('chat.sideChat.openMainFirst'));
    return createSideConversationForOwner(client, parentThreadId, creationRequests.begin());
  }, [client, creationRequests, parentThreadId, t]);

  const actions = useChatTurnActions({
    activeProjectId,
    activeTurnId: effectiveActiveTurnId,
    claimComposerForThread,
    client,
    config,
    composerKey,
    createThread: createSideConversation,
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

  const answerApproval = useCallback(async (approvalId: string, input: AnswerRuntimeApprovalInput) => {
    await client.answerApproval(approvalId, input);
    if (!threadId) return;
    const requestedThreadId = threadId;
    const updated = await client.getThread(requestedThreadId);
    if (threadIdRef.current === requestedThreadId) {
      setCurrentThread((current) => (!current || updated.lastSeq >= current.lastSeq ? updated : current));
    }
  }, [client, threadId]);

  const startReview = useCallback(async (
    target: RuntimeReviewTarget,
    modelSelection?: RuntimeConfiguredModelReference,
  ) => {
    const isCurrentRequest = reviewRequests.begin();
    if (isCurrentRequest()) setError(null);
    try {
      const started = await startThreadReview({
        activeProjectId,
        client,
        currentThread,
        language: locale,
        modelSelection,
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
    } catch (unknownError) {
      if (isCurrentRequest()) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
      throw unknownError;
    }
  }, [activeProjectId, claimComposerForThread, client, currentThread, locale, reloadThreads, reviewRequests, setError, t]);

  return useMemo(() => ({
    actions,
    activeTurnId: effectiveActiveTurnId,
    answerApproval,
    clearContext,
    composerKey,
    compactContext,
    contextCompacting,
    currentThread,
    draft,
    setDraft,
    startReview,
    threadUsage,
  }), [
    actions,
    answerApproval,
    clearContext,
    composerKey,
    compactContext,
    contextCompacting,
    currentThread,
    draft,
    effectiveActiveTurnId,
    setDraft,
    startReview,
    threadUsage,
  ]);
}

function isTerminalSideChatEvent(event: CoreRuntimeEvent): boolean {
  return event.type === 'turn.completed'
    || event.type === 'turn.cancelled'
    || event.type === 'runtime.error';
}
