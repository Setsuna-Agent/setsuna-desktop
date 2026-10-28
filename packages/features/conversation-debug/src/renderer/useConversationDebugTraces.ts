import type {
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import type { RuntimeDebugTraceEvent } from '../contracts/index.js';
import type { ConversationDebugRendererService } from './service.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterConversationDebugTraces,
  type ConversationDebugVisibility,
} from './conversationDebugVisibility.js';
import { mergeConversationDebugTracePage } from './conversationDebugTraceBuffer.js';

const TRACE_POLL_INTERVAL_MS = 650;
const TRACE_IDLE_MAX_MS = 10_000;

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
  client: ConversationDebugRendererService,
  thread: RuntimeThread | null,
  visibility: ConversationDebugVisibility,
  paused = false,
): ConversationDebugTracesState {
  const [snapshot, setSnapshot] = useState<DebugTraceSnapshot>(EMPTY_TRACE_SNAPSHOT);
  const threadId = thread?.id ?? null;
  const visibilityRef = useRef<ConversationDebugVisibility>(visibility);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const wakeRef = useRef<(() => void) | null>(null);
  const pruneRef = useRef<(() => void) | null>(null);
  visibilityRef.current = visibility;

  useEffect(() => {
    pruneRef.current?.();
  }, [visibility.key]);

  useEffect(() => { wakeRef.current?.(); }, [thread?.lastSeq, paused]);

  useEffect(() => {
    if (!threadId) {
      setSnapshot(EMPTY_TRACE_SNAPSHOT);
      return undefined;
    }

    let disposed = false;
    let afterSeq = 0;
    let idleDelay = TRACE_POLL_INTERVAL_MS;
    let inFlight = false;
    let wakePending = false;
    let hadError = false;
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
      if (disposed || (document.hidden || pausedRef.current)) return;
      timerId = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      timerId = null;
      if (disposed || (document.hidden || pausedRef.current) || inFlight) return;
      inFlight = true;
      try {
        const result = await client.listTraces(threadId, afterSeq);
        if (disposed) return;
        const changed = result.nextSeq - 1 > afterSeq || result.droppedBeforeSeq !== droppedBeforeSeq;
        droppedBeforeSeq = mergeConversationDebugTracePage(
          tracesBySequence,
          result,
          droppedBeforeSeq,
        );
        afterSeq = Math.max(afterSeq, result.nextSeq - 1);
        if (changed || hadError) commitVisibleTraces();
        hadError = false;
        idleDelay = changed ? TRACE_POLL_INTERVAL_MS : Math.min(idleDelay * 2, TRACE_IDLE_MAX_MS);
      } catch (unknownError) {
        if (disposed) return;
        hadError = true;
        setSnapshot((current) => ({
          ...current,
          error: unknownError instanceof Error ? unknownError.message : String(unknownError),
        }));
        idleDelay = Math.min(idleDelay * 2, TRACE_IDLE_MAX_MS);
      } finally {
        inFlight = false;
        schedule(wakePending ? 0 : idleDelay);
        wakePending = false;
      }
    };

    const wake = () => {
      if (timerId !== null) window.clearTimeout(timerId);
      idleDelay = TRACE_POLL_INTERVAL_MS;
      if ((document.hidden || pausedRef.current)) return;
      if (inFlight) wakePending = true;
      else void poll();
    };
    wakeRef.current = wake;
    document.addEventListener('visibilitychange', wake);
    pruneRef.current = commitVisibleTraces;
    void poll();
    return () => {
      disposed = true;
      wakeRef.current = null;
      document.removeEventListener('visibilitychange', wake);
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
