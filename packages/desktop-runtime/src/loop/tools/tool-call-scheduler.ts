/** A FIFO pool: parallel reads may overlap; exclusive calls form barriers. */
export class ToolCallScheduler {
  private readonly queue: Array<{
    parallel: boolean;
    run(): Promise<void>;
    reject(error: unknown): void;
  }> = [];
  private readonly active = new Set<Promise<void>>();
  private exclusive = false;
  private closed = false;

  constructor(private readonly limit: number, private readonly signal: AbortSignal) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid tool concurrency limit.');
    signal.addEventListener('abort', this.cancel, { once: true });
  }

  run<T>(parallel: boolean, operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.signal.aborted) return Promise.reject(this.signal.reason ?? new Error('Tool scheduler closed.'));
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ parallel, reject, run: async () => {
        try { resolve(await operation()); } catch (error) { reject(error); }
      } });
      this.pump();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.cancel();
    await Promise.allSettled([...this.active]);
    this.signal.removeEventListener('abort', this.cancel);
  }

  private readonly cancel = () => {
    for (const job of this.queue.splice(0)) job.reject(this.signal.reason ?? new Error('Tool scheduler closed.'));
  };

  private pump(): void {
    while (!this.closed && !this.signal.aborted && !this.exclusive && this.active.size < this.limit) {
      const next = this.queue[0];
      if (!next || (!next.parallel && this.active.size)) return;
      this.queue.shift();
      this.exclusive = !next.parallel;
      const operation = next.run().finally(() => {
        this.active.delete(operation);
        if (!next.parallel) this.exclusive = false;
        this.pump();
      });
      this.active.add(operation);
    }
  }
}
