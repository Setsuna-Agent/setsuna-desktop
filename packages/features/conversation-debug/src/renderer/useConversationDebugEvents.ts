import type { DesktopRuntimeClient, RuntimeThread, StoredThreadEvent } from '@setsuna-desktop/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  conversationDebugEventMayBeVisible,
  filterConversationDebugEvents,
  type ConversationDebugVisibility,
} from './conversationDebugVisibility.js';
import type { ConversationDebugRendererService } from './service.js';

type DebugEventSnapshot = {
  error: string | null;
  events: StoredThreadEvent[];
  highestObservedSeq: number;
  loadingHistory: boolean;
  threadId: string | null;
};

export type ConversationDebugEventsState = {
  error: string | null;
  events: StoredThreadEvent[];
  highestSeq: number;
  syncing: boolean;
};

export type ConversationDebugEventSource = Pick<DesktopRuntimeClient, 'subscribeEvents'>;

const DEBUG_EVENT_HISTORY_PAGE_SIZE = 500;
const DEBUG_EVENT_LIVE_COMMIT_INTERVAL_MS = 80;
const EMPTY_SNAPSHOT: DebugEventSnapshot = {
  error: null,
  events: [],
  highestObservedSeq: 0,
  loadingHistory: false,
  threadId: null,
};

/**
 * Reads a fixed durable history watermark page by page, then opens the live SSE
 * stream at that watermark. Keeping history reads out of SSE avoids retention
 * resyncs and lets the graph paint useful partial results after every page.
 */
export function useConversationDebugEvents(
  eventSource: ConversationDebugEventSource,
  service: Pick<ConversationDebugRendererService, 'listEvents'>,
  thread: RuntimeThread | null,
  visibility: ConversationDebugVisibility,
): ConversationDebugEventsState {
  const [snapshot, setSnapshot] = useState<DebugEventSnapshot>(EMPTY_SNAPSHOT);
  const threadId = thread?.id ?? null;
  const visibilityRef = useRef<ConversationDebugVisibility>(visibility);
  const commitRef = useRef<(() => void) | null>(null);
  visibilityRef.current = visibility;

  useEffect(() => {
    commitRef.current?.();
  }, [thread?.lastSeq, visibility.key]);

  useEffect(() => {
    if (!threadId) {
      setSnapshot(EMPTY_SNAPSHOT);
      return undefined;
    }

    const historyAbort = new AbortController();
    const candidateEvents = new Map<number, StoredThreadEvent>();
    const initialHistoryHighWater = visibilityRef.current.lastSeq;
    let disposed = false;
    let error: string | null = null;
    let historyLoadedSeq = 0;
    let historyLoading = initialHistoryHighWater > 0;
    let historyTargetSeq = initialHistoryHighWater;
    let highestObservedSeq = initialHistoryHighWater;
    let liveCommitTimerId: number | null = null;
    let liveStarted = false;
    let unsubscribeLive: (() => void) | null = null;
    setSnapshot({
      error,
      events: [],
      highestObservedSeq,
      loadingHistory: historyLoading,
      threadId,
    });

    const acceptEvent = (event: StoredThreadEvent) => {
      if (event.threadId !== threadId) return;
      highestObservedSeq = Math.max(highestObservedSeq, event.seq);
      if (!conversationDebugEventMayBeVisible(event, visibilityRef.current)) return;
      const current = candidateEvents.get(event.seq);
      if (!current || current.id === event.id) candidateEvents.set(event.seq, event);
    };
    const commit = (pruneCandidates = false) => {
      if (disposed) return;
      const visibleEvents = filterConversationDebugEvents(
        [...candidateEvents.values()],
        visibilityRef.current,
      ).sort((left, right) => left.seq - right.seq);
      if (pruneCandidates) {
        candidateEvents.clear();
        for (const event of visibleEvents) candidateEvents.set(event.seq, event);
      }
      setSnapshot({
        error,
        events: visibleEvents,
        highestObservedSeq,
        loadingHistory: historyLoading,
        threadId,
      });
    };
    const scheduleLiveCommit = () => {
      if (liveCommitTimerId !== null) return;
      liveCommitTimerId = window.setTimeout(() => {
        liveCommitTimerId = null;
        commit(true);
      }, DEBUG_EVENT_LIVE_COMMIT_INTERVAL_MS);
    };
    const startLive = (sinceSeq: number) => {
      if (disposed || liveStarted) return;
      liveStarted = true;
      unsubscribeLive = eventSource.subscribeEvents(threadId, sinceSeq, (batch) => {
        if (disposed) return;
        if (batch.resync?.thread.id === threadId) {
          // A very active turn can outrun retention while history pages load.
          // Extend the exact paged range instead of discarding the graph snapshot.
          historyTargetSeq = Math.max(historyTargetSeq, batch.resync.thread.lastSeq);
          highestObservedSeq = Math.max(highestObservedSeq, batch.resync.thread.lastSeq);
          if (historyLoadedSeq < historyTargetSeq) {
            historyLoading = true;
            commit();
            void loadHistory();
          }
        }
        for (const event of batch.events) acceptEvent(event);
        if (batch.events.length) scheduleLiveCommit();
      });
    };
    let historyLoad: Promise<void> | null = null;
    const loadHistory = (): Promise<void> => {
      if (historyLoad) return historyLoad;
      const task = (async () => {
        try {
          while (!disposed && historyLoadedSeq < historyTargetSeq) {
            const pageThroughSeq = historyTargetSeq;
            const page = await service.listEvents(threadId, {
              afterSeq: historyLoadedSeq,
              limit: DEBUG_EVENT_HISTORY_PAGE_SIZE,
              throughSeq: pageThroughSeq,
            }, { signal: historyAbort.signal });
            if (disposed) return;
            if (page.throughSeq !== pageThroughSeq || !page.records.length) {
              throw new Error(`History page did not advance beyond E#${historyLoadedSeq}.`);
            }
            for (const event of page.records) acceptEvent(event);
            const nextLoadedSeq = page.records.at(-1)!.seq;
            if (nextLoadedSeq <= historyLoadedSeq || nextLoadedSeq > pageThroughSeq) {
              throw new Error(`History page returned an invalid E#${nextLoadedSeq} boundary.`);
            }
            historyLoadedSeq = nextLoadedSeq;
            highestObservedSeq = Math.max(highestObservedSeq, historyLoadedSeq);
            // Do not prune relation candidates until the fixed range is complete;
            // later records can provide the message/item/tool links for earlier pages.
            commit(false);
          }
          if (disposed) return;
          historyLoading = false;
          error = null;
          commit(true);
          startLive(historyLoadedSeq);
        } catch (unknownError) {
          if (disposed || historyAbort.signal.aborted) return;
          historyLoading = false;
          error = unknownError instanceof Error ? unknownError.message : String(unknownError);
          commit(true);
          // Preserve future live diagnostics without falling back to another E#0 replay.
          startLive(initialHistoryHighWater);
        }
      })();
      historyLoad = task.finally(() => {
        historyLoad = null;
        if (!disposed && historyLoadedSeq < historyTargetSeq && !error) void loadHistory();
      });
      return historyLoad;
    };

    commitRef.current = () => commit(!historyLoading);
    if (historyLoading) void loadHistory();
    else {
      commit(true);
      startLive(0);
    }

    return () => {
      disposed = true;
      commitRef.current = null;
      historyAbort.abort();
      unsubscribeLive?.();
      if (liveCommitTimerId !== null) window.clearTimeout(liveCommitTimerId);
    };
  }, [eventSource, service, threadId]);

  return useMemo(() => {
    const current = snapshot.threadId === threadId ? snapshot : EMPTY_SNAPSHOT;
    return {
      error: current.error,
      events: current.events,
      highestSeq: current.highestObservedSeq,
      syncing: current.loadingHistory || Boolean(
        thread && current.highestObservedSeq < thread.lastSeq,
      ),
    };
  }, [snapshot, thread, threadId]);
}
