import type { FeatureProjectionStore } from '@setsuna-desktop/feature-core/runtime';
import { pullRequestKey, summary as readSummary, type PullRequestReference, type PullRequestSummary, type ThreadPullRequestsResult } from '../contracts/index.js';
import type { AttachmentProjection } from './thread-attachments.js';

type Status = { summary: PullRequestSummary | null; error: string | null; expires: number };

/** Associations are durable projections; GitHub status is a shared, disposable background cache. */
export class ThreadPullRequests {
  private readonly statuses = new Map<string, Status>();
  private readonly pending = new Map<string, AbortController>();
  private disposed = false;
  constructor(
    private readonly projection: FeatureProjectionStore<AttachmentProjection>,
    private readonly load: (reference: PullRequestReference, signal: AbortSignal) => Promise<PullRequestSummary>,
  ) {}

  async read(threadIds: string[], signal?: AbortSignal): Promise<ThreadPullRequestsResult> {
    const threads: ThreadPullRequestsResult['threads'] = [];
    // Replay only requested conversations, in bounded pages; never scan histories during startup.
    for (const threadId of threadIds) {
      signal?.throwIfAborted();
      if (this.disposed) throw new Error('Pull request tracking is disposed.');
      try {
        const { state } = await this.projection.read(threadId);
        signal?.throwIfAborted();
        const items = state.attachments.map((attachment) => {
          const key = pullRequestKey(attachment);
          const status = this.statuses.get(key);
          if (!status || status.expires <= Date.now()) this.refresh(attachment);
          return { attachment, summary: status?.summary ?? null, error: status?.error ?? null };
        });
        threads.push({ threadId, items, error: null });
      } catch (error) {
        signal?.throwIfAborted();
        threads.push({ threadId, items: [], error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { threads };
  }

  remember(summary: PullRequestSummary): void {
    const key = pullRequestKey(summary);
    this.pending.get(key)?.abort();
    this.pending.delete(key);
    if (!this.disposed) this.statuses.set(key, { summary: readSummary(summary), error: null, expires: Date.now() + 45_000 });
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
    this.statuses.clear();
  }

  private refresh(reference: PullRequestReference): void {
    const key = pullRequestKey(reference);
    if (this.disposed || this.pending.has(key)) return;
    const controller = new AbortController();
    this.pending.set(key, controller);
    void this.load(reference, controller.signal).then((summary) => {
      if (!controller.signal.aborted) this.statuses.set(key, { summary, error: null, expires: Date.now() + 45_000 });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) this.statuses.set(key, {
        summary: this.statuses.get(key)?.summary ?? null,
        error: error instanceof Error ? error.message : String(error), expires: Date.now() + 60_000,
      });
    }).finally(() => { if (this.pending.get(key) === controller) this.pending.delete(key); });
  }
}
