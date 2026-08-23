import type {
  PendingStoredThreadEvent,
  StoredThreadEvent,
  RuntimeStreamPipelineDebugPayload,
} from '@setsuna-desktop/contracts';
import {
  appendRuntimeDebugTraceSafely,
  type RuntimeDebugTraceSink,
} from '../../ports/runtime-debug-trace.js';

type PendingRuntimeEvent = PendingStoredThreadEvent;
type StreamMetricEvent = PendingStoredThreadEvent | StoredThreadEvent;

type TurnStreamMetrics = Omit<
  RuntimeStreamPipelineDebugPayload,
  'terminalEventType'
>;

const terminalEventTypes = new Set<string>([
  'runtime.error',
  'turn.cancelled',
  'turn.completed',
]);
const TERMINAL_TURN_TOMBSTONE_LIMIT = 1_024;

/**
 * Collects bounded, memory-only counters for the event writer fast path. The
 * collector never awaits or writes transcript state, so diagnostics cannot
 * change event ordering or turn behavior.
 */
export class RuntimeStreamMetricsCollector {
  private readonly metricsByTurn = new Map<string, TurnStreamMetrics>();
  private readonly terminalTurns = new Set<string>();

  constructor(private readonly debugTrace?: RuntimeDebugTraceSink) {}

  recordReceived(event: PendingRuntimeEvent, mergeable: boolean): void {
    const metrics = this.metricsFor(event);
    if (!metrics) return;
    metrics.receivedEventCount += 1;
    if (mergeable) metrics.receivedMergeableEventCount += 1;
    const characters = streamDeltaCharacters(event);
    if (characters === null) return;
    metrics.receivedStreamDeltaCount += 1;
    metrics.receivedStreamCharacters += characters;
  }

  recordBuffered(event: PendingRuntimeEvent, bufferedEventCount: number, coalesced: boolean): void {
    const metrics = this.metricsFor(event);
    if (!metrics) return;
    metrics.maxBufferedEventCount = Math.max(metrics.maxBufferedEventCount, bufferedEventCount);
    if (coalesced) metrics.coalescedEventCount += 1;
  }

  recordBatchFlushed(events: PendingRuntimeEvent[]): void {
    const keys = new Set(events.map(turnMetricsKey).filter((key): key is string => Boolean(key)));
    for (const key of keys) {
      const metrics = this.metricsByTurn.get(key);
      if (metrics) metrics.batchFlushCount += 1;
    }
  }

  recordPersisted(event: StoredThreadEvent): void {
    const metrics = this.metricsFor(event);
    if (!metrics) return;
    metrics.persistedEventCount += 1;
    const characters = streamDeltaCharacters(event);
    if (characters !== null) {
      metrics.persistedStreamDeltaCount += 1;
      metrics.persistedStreamCharacters += characters;
    }
    if (!terminalEventTypes.has(event.type)) return;

    appendRuntimeDebugTraceSafely(this.debugTrace, {
      afterEventSeq: event.seq,
      kind: 'stream.pipeline.summary',
      payload: {
        ...metrics,
        terminalEventType: event.type as RuntimeStreamPipelineDebugPayload['terminalEventType'],
      },
      threadId: event.threadId,
      turnId: event.turnId,
    });
    const key = turnMetricsKey(event);
    if (key) {
      this.metricsByTurn.delete(key);
      this.rememberTerminalTurn(key);
    }
  }

  private metricsFor(event: StreamMetricEvent): TurnStreamMetrics | null {
    const key = turnMetricsKey(event);
    // Cancellation is persisted before providers and tools necessarily unwind. Keep a
    // bounded tombstone so their late callbacks cannot reopen a finalized metrics bucket.
    if (!key || this.terminalTurns.has(key)) return null;
    let metrics = this.metricsByTurn.get(key);
    if (!metrics) {
      metrics = emptyTurnStreamMetrics();
      this.metricsByTurn.set(key, metrics);
    }
    return metrics;
  }

  private rememberTerminalTurn(key: string): void {
    this.terminalTurns.add(key);
    if (this.terminalTurns.size <= TERMINAL_TURN_TOMBSTONE_LIMIT) return;
    const oldest = this.terminalTurns.values().next().value;
    if (oldest !== undefined) this.terminalTurns.delete(oldest);
  }
}

function turnMetricsKey(event: StreamMetricEvent): string | null {
  return event.turnId ? `${event.threadId}\u0000${event.turnId}` : null;
}

function emptyTurnStreamMetrics(): TurnStreamMetrics {
  return {
    batchFlushCount: 0,
    coalescedEventCount: 0,
    maxBufferedEventCount: 0,
    persistedEventCount: 0,
    persistedStreamCharacters: 0,
    persistedStreamDeltaCount: 0,
    receivedEventCount: 0,
    receivedMergeableEventCount: 0,
    receivedStreamCharacters: 0,
    receivedStreamDeltaCount: 0,
  };
}

function streamDeltaCharacters(event: StreamMetricEvent): number | null {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === 'message.delta') {
    return typeof payload.text === 'string' ? payload.text.length : null;
  }
  if (
    event.type === 'item.delta'
    || event.type === 'plan.delta'
    || event.type === 'reasoning.summary_delta'
    || event.type === 'reasoning.raw_delta'
    || event.type === 'tool.output_delta'
  ) {
    return typeof payload.delta === 'string' ? payload.delta.length : null;
  }
  return null;
}
