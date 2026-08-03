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
    setState((value) => ({ ...value, error: null, loading: true }));
    try {
      const page = await client.listThreadMessages(requestedThreadId, {
        before,
        limit: MESSAGE_PAGE_SIZE,
      });
      setState((value) => {
        if (value.threadId !== requestedThreadId) return value;
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
      setState((value) => value.threadId === requestedThreadId
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
  if (current.threadId !== thread?.id) return stateFromThread(thread);
  if (!thread) return stateFromThread(null);
  if (!thread.messagePage) return stateFromThread(thread);
  return {
    ...current,
    // Polling can shift the server tail window as messages arrive. Retain displaced rows
    // already held by the renderer and let the smallest cursor remain authoritative.
    messages: mergeMessages(current.messages, thread.messages),
    nextBefore: current.nextBefore === null || thread.messagePage.nextBefore === null
      ? null
      : Math.min(current.nextBefore, thread.messagePage.nextBefore),
    total: thread.messagePage.total,
  };
}

export function mergeMessages(
  older: RuntimeMessage[],
  newer: RuntimeMessage[],
): RuntimeMessage[] {
  const byId = new Map(older.map((message) => [message.id, message]));
  for (const message of newer) byId.set(message.id, message);
  return [...byId.values()];
}

function stateFromThread(thread: RuntimeThread | null): ThreadMessageHistoryState {
  return {
    error: null,
    loading: false,
    messages: thread?.messages ?? [],
    nextBefore: thread?.messagePage?.nextBefore ?? null,
    threadId: thread?.id ?? null,
    total: thread?.messagePage?.total ?? thread?.messages.length ?? 0,
  };
}
