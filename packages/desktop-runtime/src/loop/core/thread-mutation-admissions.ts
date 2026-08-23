/** Tracks admitted per-thread mutations so destructive deletion can drain them safely. */
export class ThreadMutationAdmissions {
  private readonly pendingByThread = new Map<string, Set<Promise<void>>>();

  count(): number {
    return [...this.pendingByThread.values()].reduce((total, pending) => total + pending.size, 0);
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
