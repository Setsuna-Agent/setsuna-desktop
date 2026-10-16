import type { BrowserPageSleepBlocker, BrowserPageSleepResult } from '../contracts/page-lifecycle.js';

type PageLifecyclePort = Readonly<{
  blocker(): BrowserPageSleepBlocker | null;
  inspect(signal: AbortSignal): Promise<BrowserPageSleepBlocker | null>;
  setFrozen(frozen: boolean): Promise<void>;
  changed(suspended: boolean): void;
  dispose(): void;
}>;

/** Sleep transitions are serialized; browser work reserves the page before any await. */
export class BrowserPageLifecycle {
  private suspended = false;
  private disposed = false;
  private busy = 0;
  private revision = 0;
  private pendingTransitions = 0;
  private transition: Promise<unknown> = Promise.resolve();

  constructor(private readonly port: PageLifecyclePort) {}

  get isSuspended(): boolean { return this.suspended; }

  setSuspended(suspended: boolean, signal?: AbortSignal): Promise<BrowserPageSleepResult> {
    if (signal?.aborted) return Promise.resolve({ suspended: this.suspended, blocker: 'unavailable' });
    if (!suspended) this.revision += 1;
    if (!this.disposed && !this.pendingTransitions && suspended === this.suspended) return Promise.resolve({ suspended });
    const revision = this.revision;
    this.pendingTransitions += 1;
    const transition = this.transition.then(async (): Promise<BrowserPageSleepResult> => {
      if (this.disposed || signal?.aborted) return { suspended: this.suspended, blocker: 'unavailable' };
      if (suspended === this.suspended) return { suspended };
      if (suspended) {
        const blocker = this.busy ? 'busy' : this.port.blocker();
        if (blocker) return { suspended: false, blocker };
        const inspected = await inspectWithTimeout((signal) => this.port.inspect(signal), signal);
        // Navigation, activation or a new tool call can invalidate a slow inspection.
        const changed = this.disposed || signal?.aborted ? 'unavailable' : this.busy || revision !== this.revision ? 'busy' : this.port.blocker();
        if (changed || inspected) return { suspended: false, blocker: changed ?? inspected! };
      }
      try {
        await this.port.setFrozen(suspended);
        if (this.disposed || signal?.aborted || (suspended && revision !== this.revision)) {
          if (suspended) await this.port.setFrozen(false).catch(() => undefined);
          return { suspended: this.suspended, blocker: 'unavailable' };
        }
        this.suspended = suspended;
        this.port.changed(suspended);
        return { suspended };
      } catch {
        return { suspended: this.suspended, blocker: 'unavailable' };
      }
    }).finally(() => { this.pendingTransitions -= 1; });
    this.transition = transition.catch(() => undefined);
    return transition;
  }

  async run<T>(operation: () => Promise<T> | T): Promise<T> {
    this.busy += 1;
    this.revision += 1;
    try {
      if (this.disposed) throw new Error('Browser page is unavailable.');
      if (this.suspended || this.pendingTransitions) {
        const result = await this.setSuspended(false);
        if (result.blocker) throw new Error('Browser page could not be resumed.');
      }
      return await operation();
    } finally {
      this.busy -= 1;
    }
  }

  reset(): void {
    if (this.disposed) return;
    this.revision += 1;
    this.suspended = false;
    this.port.dispose();
    this.port.changed(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision += 1;
    this.port.dispose();
    // Teardown thaws retained guests; their renderer projection must follow it.
    if (this.suspended) {
      this.suspended = false;
      this.port.changed(false);
    }
  }
}

async function inspectWithTimeout(inspect: (signal: AbortSignal) => Promise<BrowserPageSleepBlocker | null>, signal?: AbortSignal): Promise<BrowserPageSleepBlocker | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted!: () => void;
  try {
    const cancelled = new Promise<BrowserPageSleepBlocker>((resolve) => {
      aborted = () => { controller.abort(); resolve('unavailable'); };
      timer = setTimeout(aborted, 2_000);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
    });
    return await Promise.race([
      inspect(controller.signal),
      cancelled,
    ]);
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    controller.abort();
  }
}
