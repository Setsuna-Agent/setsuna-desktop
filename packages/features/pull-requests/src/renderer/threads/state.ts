import type { ThreadPullRequest, ThreadPullRequestsStateService } from '../../contracts/index.js';
import type { PullRequestsClient } from '../client.js';

const EMPTY: readonly ThreadPullRequest[] = Object.freeze([]);

/** One batched local poll for all mounted thread badges and the environment panel. */
export class ThreadPullRequestsState implements ThreadPullRequestsStateService {
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly snapshots = new Map<string, readonly ThreadPullRequest[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  private again = false;
  private disposed = false;
  constructor(private readonly client: Pick<PullRequestsClient, 'threads'>) {}

  getSnapshot = (threadId: string): readonly ThreadPullRequest[] => this.snapshots.get(threadId) ?? EMPTY;
  subscribe = (threadId: string, listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    const listeners = this.listeners.get(threadId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(threadId, listeners);
    if (!this.timer) {
      this.timer = setInterval(this.refresh, 5_000);
      window.addEventListener('focus', this.refresh);
      document.addEventListener('visibilitychange', this.refresh);
    }
    this.refresh();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(threadId);
      if (!this.listeners.size) this.stop();
    };
  };
  refresh = (): void => {
    if (this.disposed || !this.listeners.size || document.visibilityState === 'hidden') return;
    if (this.request) { this.again = true; return; }
    if (!this.scheduled) this.scheduled = setTimeout(() => { this.scheduled = null; void this.read(); }, 0);
  };
  dispose = (): void => { this.disposed = true; this.stop(); this.listeners.clear(); this.snapshots.clear(); };

  private async read(): Promise<void> {
    const controller = new AbortController();
    this.request = controller;
    const ids = [...this.listeners.keys()];
    try {
      for (let index = 0; index < ids.length; index += 50) {
        const result = await this.client.threads({ threadIds: ids.slice(index, index + 50) }, controller.signal);
        if (controller.signal.aborted) return;
        for (const { threadId, items, error } of result.threads) {
          // One failed history/status read must not erase previously associated PRs.
          if (error || !this.listeners.has(threadId) || JSON.stringify(items) === JSON.stringify(this.getSnapshot(threadId))) continue;
          this.snapshots.set(threadId, items);
          for (const listener of this.listeners.get(threadId) ?? []) listener();
        }
      }
    } catch { /* Keep the last known state; retry on the next visible poll or focus. */ }
    finally {
      if (this.request === controller) {
        this.request = null;
        if (this.again) { this.again = false; this.refresh(); }
      }
    }
  }
  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.scheduled) clearTimeout(this.scheduled);
    this.timer = null; this.scheduled = null; this.again = false;
    this.request?.abort(); this.request = null;
    window.removeEventListener('focus', this.refresh);
    document.removeEventListener('visibilitychange', this.refresh);
  }
}
