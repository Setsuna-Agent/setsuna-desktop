import type { RuntimeEvent, RuntimeEventBatch } from '@setsuna-desktop/contracts';

const DEFAULT_FLUSH_INTERVAL_MS = 16;
const DEFAULT_MAX_BATCH_SIZE = 128;

type RuntimeEventBatcherOptions = {
  flushIntervalMs?: number;
  maxBatchSize?: number;
};

/**
 * Bounds high-frequency renderer IPC while retaining strict event order. User-blocking
 * lifecycle events flush synchronously so batching never delays approvals or turn exit.
 */
export class RuntimeEventBatcher {
  private events: RuntimeEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;

  constructor(
    private readonly deliver: (batch: RuntimeEventBatch) => void,
    options: RuntimeEventBatcherOptions = {},
  ) {
    this.flushIntervalMs = Math.max(0, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.maxBatchSize = Math.max(1, Math.floor(options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE));
  }

  enqueue(event: RuntimeEvent): void {
    this.events.push(event);
    if (isImmediateRuntimeEvent(event) || this.events.length >= this.maxBatchSize) {
      this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    this.timer.unref();
  }

  flush(): void {
    this.clearTimer();
    if (!this.events.length) return;
    const events = this.events;
    this.events = [];
    this.deliver({ events });
  }

  cancel(): void {
    this.clearTimer();
    this.events = [];
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

function isImmediateRuntimeEvent(event: RuntimeEvent): boolean {
  return event.type === 'approval.requested'
    || event.type === 'approval.resolved'
    || event.type === 'runtime.error'
    || event.type === 'turn.cancelled'
    || event.type === 'turn.completed';
}
