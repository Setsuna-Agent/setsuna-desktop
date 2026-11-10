/** Tracks admitted per-thread mutations so destructive deletion can drain them safely. */
export class ThreadMutationAdmissions {
  private readonly pendingByThread = new Map<string, Set<Promise<void>>>();

  hasPending(threadId: string): boolean {
    return Boolean(this.pendingByThread.get(threadId)?.size);
  }

  count(): number {
    return [...this.pendingByThread.values()].reduce((total, pending) => total + pending.size, 0);
  }

  /** Claims all transcript gates before yielding, and tracks the import as one maintenance mutation. */
  async runIdle(threadIds: readonly string[], gates: {
    available(threadId: string): boolean;
    enter(threadId: string): void;
    leave(threadId: string): void;
    prepare(threadId: string): Promise<void>;
  }, operation: () => Promise<void>): Promise<boolean> {
    const targets = [...new Set(threadIds)];
    if (!targets.length) throw new Error('An idle mutation needs a thread.');
    if (targets.some((id) => this.hasPending(id) || !gates.available(id))) return false;
    const claimed: string[] = [];
    try {
      for (const id of targets) { gates.enter(id); claimed.push(id); }
      return await this.run(targets[0]!, async () => {
        for (const id of targets) await gates.prepare(id);
      }, async () => { await operation(); return true; });
    } finally { for (const id of claimed) gates.leave(id); }
  }

  async run<T>(
    threadId: string,
    beforeOperation: () => Promise<void>,
    operation: () => Promise<T>,
  ): Promise<T> {
    let resolveAdmission: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => {
      resolveAdmission = resolve;
    });
    const pending = this.pendingByThread.get(threadId) ?? new Set<Promise<void>>();
    pending.add(admission);
    this.pendingByThread.set(threadId, pending);
    try {
      await beforeOperation();
      return await operation();
    } finally {
      pending.delete(admission);
      if (!pending.size && this.pendingByThread.get(threadId) === pending) {
        this.pendingByThread.delete(threadId);
      }
      resolveAdmission();
    }
  }

  async waitForThread(threadId: string): Promise<void> {
    for (;;) {
      const pending = [...(this.pendingByThread.get(threadId) ?? [])];
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }
}
