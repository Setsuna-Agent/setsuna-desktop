import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import type { EventBus } from '../ports/event-bus.js';
import type { ThreadStore } from '../ports/thread-store.js';

type PendingRuntimeEvent = Omit<RuntimeEvent, 'seq'>;

type PendingBatch = {
  events: PendingRuntimeEvent[];
  mergeIndexes: Map<string, number>;
  timer: NodeJS.Timeout;
};

const DEFAULT_DELTA_FLUSH_MS = 25;

/**
 * Persists runtime events before broadcasting them and coalesces high-frequency
 * stream deltas without changing terminal/tool lifecycle ordering.
 */
export class RuntimeEventWriter {
  private readonly batches = new Map<string, PendingBatch>();
  private readonly writeQueues = new Map<string, Promise<void>>();
  private fatalError: Error | null = null;

  constructor(
    private readonly threadStore: ThreadStore,
    private readonly eventBus: EventBus,
    private readonly flushIntervalMs = DEFAULT_DELTA_FLUSH_MS,
  ) {}

  async append(threadId: string, event: PendingRuntimeEvent): Promise<RuntimeEvent | null> {
    this.throwIfFailed();
    const mergeKey = mergeKeyForEvent(event);
    if (mergeKey) {
      this.enqueueDelta(threadId, mergeKey, event);
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

  private enqueueDelta(threadId: string, mergeKey: string, event: PendingRuntimeEvent): void {
    let batch = this.batches.get(threadId);
    if (!batch) {
      const timer = setTimeout(() => {
        const pending = this.takeBatch(threadId);
        if (!pending.length) return;
        void this.enqueueWrite(threadId, () => this.persistAndPublish(pending)).catch((error) => this.recordFailure(error));
      }, this.flushIntervalMs);
      timer.unref();
      batch = { events: [], mergeIndexes: new Map(), timer };
      this.batches.set(threadId, batch);
    }
    const existingIndex = batch.mergeIndexes.get(mergeKey);
    if (existingIndex !== undefined && mergeDeltaEvent(batch.events[existingIndex], event)) return;
    batch.mergeIndexes.set(mergeKey, batch.events.length);
    batch.events.push(clonePendingEvent(event));
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
    for (const event of events) await this.persistAndPublishOne(event);
  }

  private async persistAndPublishOne(event: PendingRuntimeEvent): Promise<RuntimeEvent> {
    const saved = await this.threadStore.appendEvent(event.threadId, event);
    this.eventBus.publish(saved);
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
  if (event.type === 'message.delta') return `${event.type}:${String(payload.messageId ?? '')}`;
  if (event.type === 'item.delta') return `${event.type}:${String(payload.itemId ?? '')}`;
  if (event.type === 'tool.output_delta') {
    return [event.type, payload.toolCallId, payload.stream, payload.processId].map((value) => String(value ?? '')).join(':');
  }
  return '';
}

function mergeDeltaEvent(target: PendingRuntimeEvent, next: PendingRuntimeEvent): boolean {
  if (target.type !== next.type) return false;
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
