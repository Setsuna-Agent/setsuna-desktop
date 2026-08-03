import type {
  DesktopRuntimeClient,
  RuntimeMessage,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MESSAGE_PAGE_SIZE = 160;

type ThreadMessageHistoryState = {
  error: string | null;
  loading: boolean;
  messages: RuntimeMessage[];
  nextBefore: number | null;
  threadId: string | null;
  total: number;
  windowRevision: number;
};

export function useThreadMessageHistory(
  client: Pick<DesktopRuntimeClient, 'listThreadMessages'>,
  thread: RuntimeThread | null,
) {
  const [state, setState] = useState<ThreadMessageHistoryState>(() => stateFromThread(thread));
  const stateRef = useRef(state);
  const visibleState = useMemo(
    () => reconcileThreadSnapshot(state, thread),
    [state, thread],
  );
  // SSE snapshots should render in the same React pass; the effect below only persists
  // the derived page state for future requests and thread switches.
  stateRef.current = visibleState;

  useEffect(() => {
    setState((current) => reconcileThreadSnapshot(current, thread));
  }, [thread]);

  const loadOlder = useCallback(async () => {
    const current = stateRef.current;
    if (!current.threadId || current.nextBefore === null || current.loading) return;
    const requestedThreadId = current.threadId;
    const before = current.nextBefore;
    const windowRevision = current.windowRevision;
    setState((value) => ({ ...value, error: null, loading: true }));
    try {
      const page = await client.listThreadMessages(requestedThreadId, {
        before,
        limit: MESSAGE_PAGE_SIZE,
      });
      setState((value) => {
        if (
          value.threadId !== requestedThreadId
          || value.windowRevision !== windowRevision
        ) return value;
        return {
          ...value,
          error: null,
          loading: false,
          messages: mergeMessages(page.messages, value.messages),
          nextBefore: page.nextBefore,
          total: page.total,
        };
      });
    } catch (error) {
      setState((value) => (
        value.threadId === requestedThreadId
        && value.windowRevision === windowRevision
      )
        ? {
          ...value,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
        }
        : value);
    }
  }, [client]);

  return {
    error: visibleState.error,
    hasMore: visibleState.nextBefore !== null,
    loadOlder,
    loading: visibleState.loading,
    messages: visibleState.messages,
    remainingCount: visibleState.nextBefore ?? 0,
    total: visibleState.total,
  };
}

export function reconcileThreadSnapshot(
  current: ThreadMessageHistoryState,
  thread: RuntimeThread | null,
): ThreadMessageHistoryState {
  if (current.threadId !== thread?.id) {
    return stateFromThread(thread, current.windowRevision + 1);
  }
  if (!thread) return current;

  const reconciled = thread.messagePage
    ? reconcilePagedMessageWindow(current.messages, thread.messages, thread.messagePage.nextBefore)
    : { messages: thread.messages, retainedPrefix: false };
  const windowChanged = !sameMessageOrder(current.messages, reconciled.messages);
  const nextBefore = thread.messagePage
    ? reconciled.retainedPrefix
      ? minimumMessageCursor(current.nextBefore, thread.messagePage.nextBefore)
      : thread.messagePage.nextBefore
    : null;
  return {
    ...current,
    // The server page owns the overlapping tail. Cached rows are retained only before
    // that boundary, so delete/truncate cannot resurrect messages removed by runtime.
    loading: windowChanged ? false : current.loading,
    messages: reconciled.messages,
    nextBefore,
    total: thread.messagePage?.total ?? thread.messages.length,
    windowRevision: windowChanged
      ? current.windowRevision + 1
      : current.windowRevision,
  };
}

function reconcilePagedMessageWindow(
  cached: RuntimeMessage[],
  authoritativeTail: RuntimeMessage[],
  nextBefore: number | null,
): { messages: RuntimeMessage[]; retainedPrefix: boolean } {
  // A null cursor means the server supplied the complete transcript.
  if (nextBefore === null || !cached.length || !authoritativeTail.length) {
    return { messages: authoritativeTail, retainedPrefix: false };
  }
  const cachedIndexById = new Map(cached.map((message, index) => [message.id, index]));
  for (const message of authoritativeTail) {
    const overlapIndex = cachedIndexById.get(message.id);
    if (overlapIndex === undefined) continue;
    return {
      messages: mergeMessages(cached.slice(0, overlapIndex), authoritativeTail),
      retainedPrefix: overlapIndex > 0,
    };
  }
  // Without an overlap there is no safe ordering boundary for cached rows.
  return { messages: authoritativeTail, retainedPrefix: false };
}

function minimumMessageCursor(
  current: number | null,
  incoming: number | null,
): number | null {
  if (current === null || incoming === null) return null;
  return Math.min(current, incoming);
}

function sameMessageOrder(left: RuntimeMessage[], right: RuntimeMessage[]): boolean {
  return left.length === right.length
    && left.every((message, index) => message.id === right[index]?.id);
}

export function mergeMessages(
  older: RuntimeMessage[],
  newer: RuntimeMessage[],
): RuntimeMessage[] {
  const byId = new Map(older.map((message) => [message.id, message]));
  for (const message of newer) byId.set(message.id, message);
  return [...byId.values()];
}

function stateFromThread(
  thread: RuntimeThread | null,
  windowRevision = 0,
): ThreadMessageHistoryState {
  return {
    error: null,
    loading: false,
    messages: thread?.messages ?? [],
    nextBefore: thread?.messagePage?.nextBefore ?? null,
    threadId: thread?.id ?? null,
    total: thread?.messagePage?.total ?? thread?.messages.length ?? 0,
    windowRevision,
  };
}
