/**
 * Tracks async HTTP handlers independently from Node's socket lifecycle. Destroying a socket
 * does not cancel an already-running handler, so migration shutdown must wait for its durable
 * writes before SQLite and the process are closed.
 */
export class InFlightRequestTracker {
  private activeCount = 0;
  private readonly idleWaiters = new Set<() => void>();

  begin(): () => void {
    this.activeCount += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.activeCount -= 1;
      if (this.activeCount !== 0) return;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    };
  }

  waitForIdle(): Promise<void> {
    if (this.activeCount === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }
}
