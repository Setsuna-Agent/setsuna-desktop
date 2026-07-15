/** Serial, abortable queue for auxiliary work that must not hold an active turn open. */
export class RuntimeBackgroundTaskQueue {
  private readonly controller = new AbortController();
  private tail: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly name: string) {}

  enqueue<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error(`${this.name} task queue is closed`));
    const result = this.tail.then(async () => {
      throwIfAborted(this.controller.signal);
      return task(this.controller.signal);
    });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async shutdown(timeoutMs: number): Promise<boolean> {
    if (!this.closed) {
      this.closed = true;
      this.controller.abort(new Error(`${this.name} task queue is shutting down`));
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      timeout.unref?.();
    });
    const drained = this.tail.then(() => true);
    const result = await Promise.race([drained, timedOut]);
    if (timeout) clearTimeout(timeout);
    return result;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Background task aborted');
}
