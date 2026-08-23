import type { FeatureEventFeedItem } from '@setsuna-desktop/feature-core/events';
import type { RendererFeatureEventFeed } from '@setsuna-desktop/feature-core/renderer';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import {
  cloneGoalState,
  createInitialGoalState,
  type Goal,
  type GoalPatch,
  type GoalState,
  type GoalStateSnapshot,
} from '../contracts/index.js';
import type { GoalClient } from './client.js';
import { createRendererGoalEventRegistry } from './goal-event-registry.js';

export type GoalRendererControllerSnapshot = Readonly<{
  error: string | null;
  goal: Goal | null;
  loading: boolean;
  stale: boolean;
  throughSeq: number;
}>;

type Listener = (snapshot: GoalRendererControllerSnapshot) => void;

/** Owns the subscribe-before-query sequence gate for one renderer thread. */
export class GoalRendererController {
  private readonly abort = new AbortController();
  private readonly buffered = new Map<number, FeatureEventFeedItem>();
  private readonly listeners = new Set<Listener>();
  private readonly registry = createRendererGoalEventRegistry();
  private feedSubscription: Readonly<{ dispose(): void }> | null = null;
  private projection: GoalStateSnapshot | null = null;
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
      (item) => this.accept(item),
    );
    void this.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.feedSubscription?.dispose();
    this.feedSubscription = null;
    this.buffered.clear();
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
  }

  async clear(): Promise<void> {
    const snapshot = await this.options.client.clearState(
      this.options.threadId,
      { signal: this.abort.signal },
    );
    this.adoptSnapshot(snapshot);
  }

  private accept(item: FeatureEventFeedItem): void {
    if (this.disposed) return;
    const throughSeq = this.projection?.throughSeq ?? 0;
    if (item.seq <= throughSeq) return;
    if (!this.projection || this.reading || item.seq !== throughSeq + 1) {
      this.buffered.set(item.seq, item);
      if (this.projection && item.seq > throughSeq + 1) {
        this.updateView({ stale: true });
        void this.refresh();
      }
      return;
    }
    if (!this.applyContiguous(item)) void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.disposed || this.reading) return;
    this.reading = true;
    this.updateView({
      error: null,
      loading: this.projection === null,
      stale: this.projection !== null,
    });
    try {
      const snapshot = await this.options.client.readState(
        this.options.threadId,
        { signal: this.abort.signal },
      );
      if (!this.disposed) this.adoptSnapshot(snapshot);
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
    if (!this.disposed && this.projection && this.hasGap()) {
      this.updateView({ stale: true });
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
    for (const seq of this.buffered.keys()) {
      if (seq <= snapshot.throughSeq) this.buffered.delete(seq);
    }
    let healthy = true;
    for (;;) {
      const next = this.buffered.get(this.projection.throughSeq + 1);
      if (!next) break;
      this.buffered.delete(next.seq);
      if (!this.applyContiguous(next)) {
        healthy = false;
        break;
      }
    }
    this.publishProjection({
      error: healthy ? null : this.view.error,
      loading: false,
      stale: !healthy || this.hasGap(),
    });
  }

  private applyContiguous(item: FeatureEventFeedItem): boolean {
    if (!this.projection || item.seq !== this.projection.throughSeq + 1) return false;
    try {
      const state: GoalState = item.kind === 'event'
        ? this.registry.reduce(this.projection.state, item.event)
        : this.projection.state;
      this.projection = Object.freeze({
        state: cloneGoalState(state),
        throughSeq: item.seq,
      });
      this.publishProjection({ error: null, loading: false, stale: false });
      return true;
    } catch (error) {
      // Unknown or corrupt Goal payloads fail closed and force a typed snapshot replay.
      this.buffered.set(item.seq, item);
      this.updateView({
        error: error instanceof Error ? error.message : String(error),
        loading: false,
        stale: true,
      });
      return false;
    }
  }

  private hasGap(): boolean {
    if (!this.projection || !this.buffered.size) return false;
    const first = Math.min(...this.buffered.keys());
    return first > this.projection.throughSeq + 1;
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
