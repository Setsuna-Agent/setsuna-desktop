import type { RuntimeCodec } from '../codec.js';

export type FeatureProjectionCheckpoint = Readonly<{
  state: unknown;
  throughSeq: number;
}>;

/** Disposable acceleration data; the append-only event source remains authoritative. */
export interface FeatureProjectionCheckpoints {
  read(threadId: string, key: string): Promise<FeatureProjectionCheckpoint | null>;
  write(threadId: string, key: string, checkpoint: FeatureProjectionCheckpoint): Promise<void>;
}

export type FeatureProjectionCheckpointDefinition<TState> = Readonly<{
  /** Feature-owned identity and reducer version. Bump when replay semantics change. */
  key: string;
  codec: RuntimeCodec<TState>;
}>;

export async function restoreFeatureProjectionCheckpoint<TState>(
  storage: FeatureProjectionCheckpoints | undefined,
  definition: FeatureProjectionCheckpointDefinition<TState> | undefined,
  threadId: string,
  highWater: number,
): Promise<Readonly<{ state: TState; throughSeq: number }> | undefined> {
  if (!storage || !definition) return undefined;
  const checkpoint = await storage.read(threadId, definition.key);
  if (!checkpoint || !Number.isSafeInteger(checkpoint.throughSeq)
    || checkpoint.throughSeq < 0 || checkpoint.throughSeq > highWater) return undefined;
  try {
    return { state: definition.codec.parse(checkpoint.state), throughSeq: checkpoint.throughSeq };
  } catch {
    // Invalid or obsolete cached state is rebuilt by the same validated event reducers.
    return undefined;
  }
}
