import type { RendererFeatureEventFeed } from '@setsuna-desktop/feature-core/renderer';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import {
  cloneCollaborationState,
  createInitialCollaborationState,
  type CollaborationRendererStateController,
  type CollaborationRendererStateSnapshot,
  type CollaborationStateSnapshot,
} from '../contracts/index.js';
import type { CollaborationClient } from './client.js';

type Listener = (snapshot: CollaborationRendererStateSnapshot) => void;

/** Re-reads typed Collaboration state when the global sequence gate signals a change. */
export class CollaborationRendererController implements CollaborationRendererStateController {
  private readonly abort = new AbortController();
  private readonly listeners = new Set<Listener>();
  private feedSubscription: Readonly<{ dispose(): void }> | null = null;
  private projection: CollaborationStateSnapshot | null = null;
  private minimumThroughSeq = 0;
  private refreshAgain = false;
  private reading = false;
  private disposed = false;
  private view: CollaborationRendererStateSnapshot = Object.freeze({
    state: createInitialCollaborationState(),
    throughSeq: 0,
    error: null,
    loading: true,
    stale: false,
  });

  constructor(private readonly options: Readonly<{
    client: CollaborationClient;
    feed: RendererFeatureEventFeed;
    scope: FeatureScope;
    threadId: string;
  }>) {}

  start(): void {
    if (this.disposed) return;
    if (!this.feedSubscription) {
      this.feedSubscription = this.options.feed.subscribe(
        this.options.scope,
        this.options.threadId,
        (throughSeq) => this.accept(throughSeq),
      );
    }
    // The service caches controllers across transcript switches. The event hub only follows the
    // active thread, so every consumer activation must reconcile with the durable projection.
    void this.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.feedSubscription?.dispose();
    this.feedSubscription = null;
    this.listeners.clear();
  }

  snapshot(): CollaborationRendererStateSnapshot {
    return this.view;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }

  retry(): void {
    void this.refresh();
  }

  private accept(throughSeq: number): void {
    if (this.disposed) return;
    this.minimumThroughSeq = Math.max(this.minimumThroughSeq, throughSeq);
    if ((this.projection?.throughSeq ?? 0) >= this.minimumThroughSeq) return;
    if (this.projection) this.updateView({ stale: true });
    if (this.reading) this.refreshAgain = true;
    else void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.disposed || this.reading) return;
    this.reading = true;
    this.refreshAgain = false;
    this.updateView({
      error: null,
      loading: this.projection === null,
      stale: this.projection !== null,
    });
    let succeeded = false;
    try {
      const snapshot = await this.options.client.readState(
        this.options.threadId,
        { signal: this.abort.signal },
      );
      if (!this.disposed) {
        this.adoptSnapshot(snapshot);
        succeeded = true;
      }
    } catch (error) {
      if (!this.disposed && !this.abort.signal.aborted) {
        this.updateView({
          error: error instanceof Error ? error.message : String(error),
          loading: false,
          stale: this.projection !== null,
        });
      }
    } finally {
      this.reading = false;
    }
    if (
      !this.disposed
      && succeeded
      && this.refreshAgain
      && (this.projection?.throughSeq ?? 0) < this.minimumThroughSeq
    ) void this.refresh();
  }

  private adoptSnapshot(snapshot: CollaborationStateSnapshot): void {
    if (this.disposed) return;
    if (this.projection && snapshot.throughSeq < this.projection.throughSeq) return;
    this.projection = Object.freeze({
      state: cloneCollaborationState(snapshot.state),
      throughSeq: snapshot.throughSeq,
    });
    const stale = snapshot.throughSeq < this.minimumThroughSeq;
    this.publishProjection({
      error: null,
      loading: false,
      stale,
    });
  }

  private publishProjection(patch: Partial<CollaborationRendererStateSnapshot>): void {
    const projection = this.projection ?? Object.freeze({
      state: createInitialCollaborationState(),
      throughSeq: 0,
    });
    this.updateView({
      state: projection.state,
      throughSeq: projection.throughSeq,
      ...patch,
    });
  }

  private updateView(patch: Partial<CollaborationRendererStateSnapshot>): void {
    this.view = Object.freeze({ ...this.view, ...patch });
    for (const listener of [...this.listeners]) listener(this.view);
  }
}
