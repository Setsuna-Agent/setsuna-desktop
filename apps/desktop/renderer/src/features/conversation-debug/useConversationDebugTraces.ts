import type {
  DesktopRuntimeClient,
  RuntimeDebugTraceEvent,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterConversationDebugTraces,
  type ConversationDebugVisibility,
} from './conversationDebugVisibility.js';
import { mergeConversationDebugTracePage } from './conversationDebugTraceBuffer.js';

const TRACE_POLL_INTERVAL_MS = 650;
const TRACE_RETRY_INTERVAL_MS = 1_500;

type DebugTraceSnapshot = {
  droppedBeforeSeq?: number;
  error: string | null;
  threadId: string | null;
  traces: RuntimeDebugTraceEvent[];
};

export type ConversationDebugTracesState = {
  droppedBeforeSeq?: number;
  error: string | null;
  traces: RuntimeDebugTraceEvent[];
};

const EMPTY_TRACE_SNAPSHOT: DebugTraceSnapshot = {
  error: null,
  threadId: null,
  traces: [],
};

export function useConversationDebugTraces(
  client: DesktopRuntimeClient,
  thread: RuntimeThread | null,
  visibility: ConversationDebugVisibility,
): ConversationDebugTracesState {
  const [snapshot, setSnapshot] = useState<DebugTraceSnapshot>(EMPTY_TRACE_SNAPSHOT);
  const threadId = thread?.id ?? null;
  const visibilityRef = useRef<ConversationDebugVisibility>(visibility);
  const pruneRef = useRef<(() => void) | null>(null);
  visibilityRef.current = visibility;

  useEffect(() => {
    pruneRef.current?.();
  }, [visibility.key]);

  useEffect(() => {
    if (!threadId) {
      setSnapshot(EMPTY_TRACE_SNAPSHOT);
      return undefined;
    }

    let disposed = false;
    let afterSeq = 0;
    let droppedBeforeSeq: number | undefined;
    let timerId: number | null = null;
    const tracesBySequence = new Map<number, RuntimeDebugTraceEvent>();
    setSnapshot({ error: null, threadId, traces: [] });

    const commitVisibleTraces = () => {
      const traces = filterConversationDebugTraces(
        [...tracesBySequence.values()],
        visibilityRef.current,
      ).sort((left, right) => left.seq - right.seq);
      setSnapshot({
        ...(droppedBeforeSeq !== undefined ? { droppedBeforeSeq } : {}),
        error: null,
        threadId,
        traces,
      });
    };
    const schedule = (delay: number) => {
      if (disposed) return;
      timerId = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      try {
        const result = await client.listDebugTraces(threadId, afterSeq);
        if (disposed) return;
        droppedBeforeSeq = mergeConversationDebugTracePage(
          tracesBySequence,
          result,
          droppedBeforeSeq,
        );
        afterSeq = Math.max(afterSeq, result.nextSeq - 1);
        commitVisibleTraces();
        schedule(TRACE_POLL_INTERVAL_MS);
      } catch (unknownError) {
        if (disposed) return;
        setSnapshot((current) => ({
          ...current,
          error: unknownError instanceof Error ? unknownError.message : String(unknownError),
        }));
        schedule(TRACE_RETRY_INTERVAL_MS);
      }
    };

    pruneRef.current = commitVisibleTraces;
    void poll();
    return () => {
      disposed = true;
      pruneRef.current = null;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [client, threadId]);

  return useMemo(() => {
    if (snapshot.threadId !== threadId) return { error: null, traces: [] };
    return {
      ...(snapshot.droppedBeforeSeq !== undefined
        ? { droppedBeforeSeq: snapshot.droppedBeforeSeq }
        : {}),
      error: snapshot.error,
      traces: snapshot.traces,
    };
  }, [snapshot, threadId]);
}
