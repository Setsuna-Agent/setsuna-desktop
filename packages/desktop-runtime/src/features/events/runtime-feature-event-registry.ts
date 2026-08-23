import type { SequencedThreadEventRecord } from '@setsuna-desktop/feature-core/events';
import type {
  FeatureProjectionStore,
  RuntimeFeatureEventRegistrar,
} from '@setsuna-desktop/feature-core/runtime';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';

/** Dispatches persisted records without making the Core event bus Feature-aware. */
export class RuntimeFeatureEventRegistry implements RuntimeFeatureEventRegistrar {
  private readonly projections = new Set<FeatureProjectionStore>();

  registerProjection(
    scope: FeatureScope,
    projection: FeatureProjectionStore,
  ): Readonly<{ dispose(): void }> {
    if (projection.featureId !== scope.owner.featureId) {
      throw new Error('Feature projection owner does not match its registration scope.');
    }
    if ([...this.projections].some((current) => current.featureId === projection.featureId)) {
      throw new Error(`Feature projection conflict for ${projection.featureId}.`);
    }
    this.projections.add(projection);
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      this.projections.delete(projection);
    };
    scope.add(dispose);
    return Object.freeze({ dispose });
  }

  async accept(record: SequencedThreadEventRecord): Promise<void> {
    await Promise.all([...this.projections].map(async (projection) => {
      try {
        await projection.accept(record);
      } catch {
        // The durable record already committed. Drop only this Feature cache;
        // its next typed query will replay and fail closed with full metadata.
        projection.invalidate(record.threadId);
        console.error(
          `[feature-projection] ${projection.featureId} invalidated at seq ${record.seq}.`,
        );
      }
    }));
  }
}
