import type { RendererFeatureEventFeed } from '@setsuna-desktop/feature-core/renderer';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import {
  cloneGoalState,
  createInitialGoalState,
  type Goal,
  type GoalPatch,
  type GoalStateSnapshot,
} from '../contracts/index.js';
import type { GoalClient } from './client.js';

export type GoalRendererControllerSnapshot = Readonly<{
  error: string | null;
  goal: Goal | null;
  loading: boolean;
  stale: boolean;
  throughSeq: number;
}>;

type Listener = (snapshot: GoalRendererControllerSnapshot) => void;

/** Re-reads typed Goal state when the host's global sequence gate signals a change. */
export class GoalRendererController {
  private readonly abort = new AbortController();
  private readonly listeners = new Set<Listener>();
  private feedSubscription: Readonly<{ dispose(): void }> | null = null;
  private projection: GoalStateSnapshot | null = null;
  private minimumThroughSeq = 0;
  private refreshAgain = false;
  private reading = false;
  private disposed = false;
  private view: GoalRendererControllerSnapshot = Object.freeze({
    error: null,
    goal: null,
    loading: true,
    stale: false,
    throughSeq: 0,
  });

  constructor(
    private readonly options: Readonly<{
      client: GoalClient;
      feed: RendererFeatureEventFeed;
      scope: FeatureScope;
      threadId: string;
    }>,
  ) {}

  start(): void {
    if (this.disposed || this.feedSubscription) return;
    // Subscription is installed synchronously before the first snapshot request starts.
    this.feedSubscription = this.options.feed.subscribe(
      this.options.scope,
      this.options.threadId,
      (throughSeq) => this.accept(throughSeq),
    );
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

  snapshot(): GoalRendererControllerSnapshot {
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

  async update(patch: GoalPatch): Promise<void> {
    const snapshot = await this.options.client.updateState(
      this.options.threadId,
      patch,
      { signal: this.abort.signal },
    );
    this.adoptSnapshot(snapshot);
    if (this.projection && this.projection.throughSeq < this.minimumThroughSeq) void this.refresh();
  }

  async clear(): Promise<void> {
    const snapshot = await this.options.client.clearState(
      this.options.threadId,
      { signal: this.abort.signal },
    );
    this.adoptSnapshot(snapshot);
    if (this.projection && this.projection.throughSeq < this.minimumThroughSeq) void this.refresh();
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
    ) {
      void this.refresh();
    }
  }

  private adoptSnapshot(snapshot: GoalStateSnapshot): void {
    if (this.disposed) return;
    if (this.projection && snapshot.throughSeq < this.projection.throughSeq) return;
    this.projection = Object.freeze({
      state: cloneGoalState(snapshot.state),
      throughSeq: snapshot.throughSeq,
    });
    const stale = snapshot.throughSeq < this.minimumThroughSeq;
    this.publishProjection({
      error: null,
      loading: false,
      stale,
    });
  }

  private publishProjection(patch: Partial<GoalRendererControllerSnapshot>): void {
    const projection = this.projection ?? Object.freeze({
      state: createInitialGoalState(),
      throughSeq: 0,
    });
    this.updateView({
      goal: projection.state.goal,
      throughSeq: projection.throughSeq,
      ...patch,
    });
  }

  private updateView(patch: Partial<GoalRendererControllerSnapshot>): void {
    this.view = Object.freeze({ ...this.view, ...patch });
    for (const listener of [...this.listeners]) listener(this.view);
  }
}
