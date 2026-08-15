import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import type { EventBus } from '../../ports/event-bus.js';
import type { RuntimeDebugTraceSink } from '../../ports/runtime-debug-trace.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { RuntimeStreamMetricsCollector } from './runtime-stream-metrics.js';

type PendingRuntimeEvent = Omit<RuntimeEvent, 'seq'>;

type PendingBatch = {
  events: PendingRuntimeEvent[];
  lastMergeKey?: string;
  timer: NodeJS.Timeout;
};

const DEFAULT_DELTA_FLUSH_MS = 25;

/**
 * 广播 runtime 事件前先将其持久化，并合并高频流式增量，且不改变终止事件与
 * 工具生命周期事件的顺序。
 */
export class RuntimeEventWriter {
  private readonly batches = new Map<string, PendingBatch>();
  private readonly streamMetrics: RuntimeStreamMetricsCollector;
  private readonly writeQueues = new Map<string, Promise<void>>();
  private fatalError: Error | null = null;

  constructor(
    private readonly threadStore: ThreadStore,
    private readonly eventBus: EventBus,
    private readonly flushIntervalMs = DEFAULT_DELTA_FLUSH_MS,
    debugTrace?: RuntimeDebugTraceSink,
  ) {
    this.streamMetrics = new RuntimeStreamMetricsCollector(debugTrace);
  }

  async append(threadId: string, event: PendingRuntimeEvent): Promise<RuntimeEvent | null> {
    this.throwIfFailed();
    const mergeKey = mergeKeyForEvent(event);
    this.streamMetrics.recordReceived(event, Boolean(mergeKey));
    if (mergeKey) {
      const buffered = this.enqueueDelta(threadId, mergeKey, event);
      this.streamMetrics.recordBuffered(event, buffered.eventCount, buffered.coalesced);
      return null;
    }
    const pending = this.takeBatch(threadId);
    let savedEvent: RuntimeEvent | null = null;
    await this.enqueueWrite(threadId, async () => {
      await this.persistAndPublish(pending);
      savedEvent = await this.persistAndPublishOne(event);
    });
    return savedEvent;
  }

  async flushThread(threadId: string): Promise<void> {
    this.throwIfFailed();
    const pending = this.takeBatch(threadId);
    if (pending.length) await this.enqueueWrite(threadId, () => this.persistAndPublish(pending));
    const queued = this.writeQueues.get(threadId);
    if (queued) await queued;
    this.throwIfFailed();
  }

  async flushAll(): Promise<void> {
    const threadIds = new Set([...this.batches.keys(), ...this.writeQueues.keys()]);
    await Promise.all([...threadIds].map((threadId) => this.flushThread(threadId)));
    this.throwIfFailed();
  }

  private enqueueDelta(
    threadId: string,
    mergeKey: string,
    event: PendingRuntimeEvent,
  ): { coalesced: boolean; eventCount: number } {
    let batch = this.batches.get(threadId);
    if (!batch) {
      const timer = setTimeout(() => {
        const pending = this.takeBatch(threadId);
        if (!pending.length) return;
        void this.enqueueWrite(threadId, () => this.persistAndPublish(pending)).catch((error) => this.recordFailure(error));
      }, this.flushIntervalMs);
      timer.unref();
      batch = { events: [], timer };
      this.batches.set(threadId, batch);
    }
    const lastEvent = batch.events.at(-1);
    // Only adjacent deltas may coalesce. Reusing an earlier slot after another channel or item has
    // streamed would move the new delta backwards in the persisted event order.
    if (batch.lastMergeKey === mergeKey && lastEvent && mergeBufferedEvent(lastEvent, event)) {
      return { coalesced: true, eventCount: batch.events.length };
    }
    batch.events.push(clonePendingEvent(event));
    batch.lastMergeKey = mergeKey;
    return { coalesced: false, eventCount: batch.events.length };
  }

  private takeBatch(threadId: string): PendingRuntimeEvent[] {
    const batch = this.batches.get(threadId);
    if (!batch) return [];
    clearTimeout(batch.timer);
    this.batches.delete(threadId);
    return batch.events;
  }

  private async enqueueWrite(threadId: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(threadId) ?? Promise.resolve();
    const run = previous.then(operation);
    const queue = run.then(() => undefined, () => undefined);
    this.writeQueues.set(threadId, queue);
    try {
      await run;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    } finally {
      if (this.writeQueues.get(threadId) === queue) this.writeQueues.delete(threadId);
    }
  }

  private async persistAndPublish(events: PendingRuntimeEvent[]): Promise<void> {
    this.streamMetrics.recordBatchFlushed(events);
    for (const event of events) await this.persistAndPublishOne(event);
  }

  private async persistAndPublishOne(event: PendingRuntimeEvent): Promise<RuntimeEvent> {
    const saved = await this.threadStore.appendEvent(event.threadId, event);
    this.eventBus.publish(saved);
    this.streamMetrics.recordPersisted(saved);
    return saved;
  }

  private recordFailure(error: unknown): void {
    this.fatalError = error instanceof Error ? error : new Error(String(error));
  }

  private throwIfFailed(): void {
    if (this.fatalError) throw this.fatalError;
  }
}

function mergeKeyForEvent(event: PendingRuntimeEvent): string {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === 'message.delta') return mergeKey(event, payload.messageId, payload.channel ?? 'content');
  if (event.type === 'item.delta' || event.type === 'plan.delta') {
    return mergeKey(event, payload.itemId);
  }
  if (event.type === 'reasoning.summary_delta') {
    return mergeKey(event, payload.itemId, payload.summaryIndex ?? 0);
  }
  if (event.type === 'reasoning.raw_delta') {
    return mergeKey(event, payload.itemId, payload.contentIndex ?? 0);
  }
  if (event.type === 'tool.output_delta') {
    return mergeKey(event, payload.toolCallId, payload.stream, payload.processId);
  }
  if (event.type === 'tool.preview') return mergeKey(event, payload.toolCallId);
  return '';
}

function mergeKey(event: PendingRuntimeEvent, ...identity: unknown[]): string {
  // NUL cannot occur in runtime IDs, so unlike a visible delimiter this cannot
  // alias IDs that themselves contain punctuation (for example `${turnId}:plan`).
  return [event.turnId, event.type, ...identity]
    .map((value) => String(value ?? ''))
    .join('\u0000');
}

function mergeBufferedEvent(target: PendingRuntimeEvent, next: PendingRuntimeEvent): boolean {
  if (target.type !== next.type) return false;
  if (target.type === 'tool.preview') {
    // 工具参数预览只需要最新状态；中间 token 预览没有独立的审计价值。
    Object.assign(target, clonePendingEvent(next));
    return true;
  }
  const targetPayload = target.payload as Record<string, unknown>;
  const nextPayload = next.payload as Record<string, unknown>;
  const field = target.type === 'message.delta' ? 'text' : 'delta';
  if (typeof targetPayload[field] !== 'string' || typeof nextPayload[field] !== 'string') return false;
  targetPayload[field] = `${targetPayload[field]}${nextPayload[field]}`;
  return true;
}

function clonePendingEvent(event: PendingRuntimeEvent): PendingRuntimeEvent {
  return structuredClone(event);
}
