import type { PullRequestConnection } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';

type ConnectionSnapshot = Readonly<{
  connection: PullRequestConnection | null;
  error: string;
  pending: boolean;
}>;

/** One CLI account check and focus listener shared by the sidebar and PR page. */
export class PullRequestConnectionState {
  private snapshot: ConnectionSnapshot = { connection: null, error: '', pending: false };
  private readonly listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private focusTarget: Window | null = null;
  private disposed = false;

  constructor(private readonly client: Pick<PullRequestsClient, 'connection'>) {}

  getSnapshot = (): ConnectionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.focusTarget = window;
      this.focusTarget.addEventListener('focus', this.handleFocus);
      void this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  };

  refresh = async (): Promise<void> => {
    if (this.disposed) return;
    this.controller?.abort();
    const request = new AbortController();
    this.controller = request;
    this.update({ ...this.snapshot, error: '', pending: true });
    try {
      const connection = await this.client.connection({}, request.signal);
      if (!request.signal.aborted) {
        this.update({ connection, error: connection.error ?? '', pending: false });
      }
    } catch (cause) {
      if (!request.signal.aborted) {
        this.update({ connection: null, error: cause instanceof Error ? cause.message : String(cause), pending: false });
      }
    } finally {
      if (this.controller === request) this.controller = null;
    }
  };

  dispose = (): void => {
    this.disposed = true;
    this.stop();
    this.listeners.clear();
  };

  private readonly handleFocus = () => { void this.refresh(); };

  private stop(): void {
    this.focusTarget?.removeEventListener('focus', this.handleFocus);
    this.focusTarget = null;
    this.controller?.abort();
    this.controller = null;
    this.snapshot = { ...this.snapshot, pending: false };
  }

  private update(snapshot: ConnectionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
