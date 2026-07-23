import type { DesktopRuntimeClient, RuntimeEvent, RuntimeThread } from '@setsuna-desktop/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  conversationDebugEventMayBeVisible,
  filterConversationDebugEvents,
  type ConversationDebugVisibility,
} from './conversationDebugVisibility.js';

type DebugEventSnapshot = {
  events: RuntimeEvent[];
  highestObservedSeq: number;
  threadId: string | null;
};

export type ConversationDebugEventsState = {
  events: RuntimeEvent[];
  highestSeq: number;
  syncing: boolean;
};

const DEBUG_EVENT_COMMIT_INTERVAL_MS = 80;
const DEBUG_EVENT_REPLAY_IDLE_COMMIT_MS = 1_000;
const EMPTY_SNAPSHOT: DebugEventSnapshot = {
  events: [],
  highestObservedSeq: 0,
  threadId: null,
};

export function useConversationDebugEvents(
  client: DesktopRuntimeClient,
  thread: RuntimeThread | null,
  visibility: ConversationDebugVisibility,
): ConversationDebugEventsState {
  const [snapshot, setSnapshot] = useState<DebugEventSnapshot>(EMPTY_SNAPSHOT);
  const threadId = thread?.id ?? null;
  const visibilityRef = useRef<ConversationDebugVisibility>(visibility);
  const pruneRef = useRef<(() => void) | null>(null);
  visibilityRef.current = visibility;

  useEffect(() => {
    pruneRef.current?.();
  }, [thread?.lastSeq, visibility.key]);

  useEffect(() => {
    if (!threadId) {
      setSnapshot(EMPTY_SNAPSHOT);
      return undefined;
    }

    const eventsBySequence = new Map<number, RuntimeEvent>();
    let flushTimerId: number | null = null;
    let replayIdleTimerId: number | null = null;
    let disposed = false;
    let highestObservedSeq = 0;
    let lastReplayEventAt = 0;
    const replayTargetSeq = visibilityRef.current.lastSeq;
    let replayingHistory = replayTargetSeq > 0;
    setSnapshot({ events: [], highestObservedSeq, threadId });

    const clearReplayIdleTimer = () => {
      if (replayIdleTimerId === null) return;
      window.clearTimeout(replayIdleTimerId);
      replayIdleTimerId = null;
    };
    const flush = () => {
      flushTimerId = null;
      if (disposed) return;
      const visibleEvents = filterConversationDebugEvents(
        [...eventsBySequence.values()],
        visibilityRef.current,
      );
      eventsBySequence.clear();
      for (const event of visibleEvents) eventsBySequence.set(event.seq, event);
      setSnapshot({
        events: visibleEvents.sort((left, right) => left.seq - right.seq),
        highestObservedSeq,
        threadId,
      });
    };
    const flushAfterReplayIdle = () => {
      const remainingDelay = DEBUG_EVENT_REPLAY_IDLE_COMMIT_MS
        - (window.performance.now() - lastReplayEventAt);
      if (remainingDelay > 0) {
        replayIdleTimerId = window.setTimeout(flushAfterReplayIdle, remainingDelay);
        return;
      }
      replayIdleTimerId = null;
      flush();
    };
    const scheduleFlush = () => {
      if (flushTimerId !== null) return;
      // Re-projecting a long retained transcript for every token delta is more
      // expensive than the paint itself. A short fixed batch keeps the panel
      // live while bounding projection frequency.
      flushTimerId = window.setTimeout(flush, DEBUG_EVENT_COMMIT_INTERVAL_MS);
    };
    const scheduleReplayIdleFlush = () => {
      lastReplayEventAt = window.performance.now();
      if (replayIdleTimerId !== null) return;
      // Historical SSE is delivered as individual IPC events. Avoid exposing
      // and re-projecting a partial graph while that contiguous replay is
      // flowing; the idle fallback still surfaces partial data if it stalls.
      replayIdleTimerId = window.setTimeout(
        flushAfterReplayIdle,
        DEBUG_EVENT_REPLAY_IDLE_COMMIT_MS,
      );
    };
    const unsubscribe = client.subscribeEvents(threadId, 0, (event) => {
      if (disposed || event.threadId !== threadId) return;
      highestObservedSeq = Math.max(highestObservedSeq, event.seq);
      if (conversationDebugEventMayBeVisible(event, visibilityRef.current)) {
        const current = eventsBySequence.get(event.seq);
        if (current && current.id !== event.id) return;
        eventsBySequence.set(event.seq, event);
      }

      if (replayingHistory) {
        if (highestObservedSeq < replayTargetSeq) {
          scheduleReplayIdleFlush();
          return;
        }
        replayingHistory = false;
        clearReplayIdleTimer();
        flush();
        return;
      }
      scheduleFlush();
    });
    pruneRef.current = () => {
      if (replayingHistory) scheduleReplayIdleFlush();
      else scheduleFlush();
    };

    return () => {
      disposed = true;
      pruneRef.current = null;
      unsubscribe();
      if (flushTimerId !== null) window.clearTimeout(flushTimerId);
      clearReplayIdleTimer();
    };
  }, [client, threadId]);

  return useMemo(() => {
    const events = snapshot.threadId === threadId ? snapshot.events : [];
    const highestSeq = snapshot.threadId === threadId ? snapshot.highestObservedSeq : 0;
    return {
      events,
      highestSeq,
      syncing: Boolean(thread && highestSeq < thread.lastSeq),
    };
  }, [snapshot, thread, threadId]);
}
