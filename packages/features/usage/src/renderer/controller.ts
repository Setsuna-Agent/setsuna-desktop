import type {
  UsageRendererStateController,
  UsageRendererStateSnapshot,
  UsageSnapshot,
} from '../contracts/index.js';

type Listener = (snapshot: UsageRendererStateSnapshot) => void;

/** Owns one thread's durable usage read and ignores superseded responses. */
export class UsageRendererController implements UsageRendererStateController {
  private abort: AbortController | null = null;
  private readonly listeners = new Set<Listener>();
  private invalidationSubscription: (() => void) | null = null;
  private requestVersion = 0;
  private started = false;
  private disposed = false;
  private view: UsageRendererStateSnapshot = Object.freeze({
    usage: null,
    loading: true,
    error: null,
  });

  constructor(private readonly options: Readonly<{
    onStart(controller: UsageRendererController): void;
    onStop(controller: UsageRendererController): void;
    query(options?: Readonly<{ signal?: AbortSignal }>): Promise<UsageSnapshot>;
    subscribeInvalidation(listener: () => void): () => void;
  }>) {}

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.abort = new AbortController();
    this.options.onStart(this);
    this.invalidationSubscription = this.options.subscribeInvalidation(() => this.refresh());
    void this.read();
  }

  refresh(): void {
    if (!this.disposed && this.started) void this.read();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.listeners.clear();
  }

  snapshot(): UsageRendererStateSnapshot {
    return this.view;
  }

  subscribe(listener: Listener): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    listener(this.view);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  }

  private async read(): Promise<void> {
    const requestVersion = ++this.requestVersion;
    this.update({ loading: this.view.usage === null, error: null });
    try {
      const snapshot = await this.options.query({ signal: this.abort?.signal });
      if (this.disposed || requestVersion !== this.requestVersion) return;
      this.update({ usage: snapshot.usage, loading: false, error: null });
    } catch (error) {
      if (this.disposed || this.abort?.signal.aborted || requestVersion !== this.requestVersion) return;
      this.update({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private update(patch: Partial<UsageRendererStateSnapshot>): void {
    this.view = Object.freeze({ ...this.view, ...patch });
    for (const listener of [...this.listeners]) listener(this.view);
  }

  private stop(): void {
    if (!this.started) return;
    this.started = false;
    this.abort?.abort();
    this.abort = null;
    this.requestVersion += 1;
    this.invalidationSubscription?.();
    this.invalidationSubscription = null;
    this.options.onStop(this);
  }
}
