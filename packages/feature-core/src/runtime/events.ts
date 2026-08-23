import { defineCapability, type CapabilityToken } from '../capability.js';
import type { FeatureId } from '../definition.js';
import type { SequencedThreadEventRecord } from '../events.js';
import type { FeatureScope } from '../scope.js';

export type ThreadEventReadPage = Readonly<{
  records: readonly SequencedThreadEventRecord[];
  throughSeq: number;
}>;

export interface ThreadEventReader {
  highWater(threadId: string): Promise<number>;
  readPage(
    threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
  ): Promise<ThreadEventReadPage>;
}

export interface FeatureProjectionStore<TState = unknown> {
  readonly featureId: FeatureId;
  read(threadId: string): Promise<Readonly<{ state: TState; throughSeq: number }>>;
  accept(record: SequencedThreadEventRecord): Promise<void>;
  invalidate(threadId: string): void;
  dispose(): Promise<void>;
}

export interface RuntimeFeatureEventRegistrar {
  registerProjection(
    scope: FeatureScope,
    projection: FeatureProjectionStore,
  ): Readonly<{ dispose(): void }>;
}

export const threadEventReaderCapability: CapabilityToken<ThreadEventReader> = defineCapability({
  id: 'runtime.thread-event-reader',
  major: 1,
  description: 'Read a fixed global sequence range from the Core thread event source',
});

export const runtimeFeatureEventRegistrarCapability: CapabilityToken<RuntimeFeatureEventRegistrar> = defineCapability({
  id: 'runtime.feature-events',
  major: 1,
  description: 'Deliver persisted sequenced thread records to active Feature projections',
});

type CacheEntry<TState> = {
  state: TState;
  throughSeq: number;
};

type LoadEntry = {
  buffer: Map<number, SequencedThreadEventRecord>;
  invalidated: boolean;
  promise: Promise<Readonly<{ state: unknown; throughSeq: number }>>;
};

const DEFAULT_PAGE_SIZE = 500;

/**
 * In-memory projection cache whose watermark always follows the global thread
 * sequence, including Core and other Feature records.
 */
export function createFeatureProjectionStore<TState>(input: Readonly<{
  featureId: FeatureId;
  eventReader: ThreadEventReader;
  initialState(): TState;
  reduce(state: TState, record: SequencedThreadEventRecord): TState;
  pageSize?: number;
}>): FeatureProjectionStore<TState> {
  const cache = new Map<string, CacheEntry<TState>>();
  const loads = new Map<string, LoadEntry>();
  const tails = new Map<string, Promise<void>>();
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  let disposed = false;

  const invalidate = (threadId: string) => {
    cache.delete(threadId);
    const loading = loads.get(threadId);
    if (loading) loading.invalidated = true;
  };

  const replay = async (threadId: string, load: LoadEntry): Promise<Readonly<{
    state: TState;
    throughSeq: number;
  }>> => {
    for (;;) {
      if (disposed) throw new Error('Feature projection store is disposed.');
      load.invalidated = false;
      load.buffer.clear();
      const highWater = await input.eventReader.highWater(threadId);
      let state = input.initialState();
      let throughSeq = 0;
      while (throughSeq < highWater) {
        const page = await input.eventReader.readPage(threadId, {
          afterSeq: throughSeq,
          throughSeq: highWater,
          limit: pageSize,
        });
        if (page.throughSeq !== highWater || !page.records.length) {
          throw new Error(`Feature replay did not reach fixed high water ${highWater} for ${threadId}.`);
        }
        for (const record of page.records) {
          if (record.seq !== throughSeq + 1 || record.seq > highWater) {
            throw new Error(`Feature replay sequence gap for ${threadId}: expected ${throughSeq + 1}, got ${record.seq}.`);
          }
          state = input.reduce(state, record);
          throughSeq = record.seq;
        }
      }

      // No await after reading the buffer: accept() cannot interleave between
      // the final continuity check and publishing the cache entry.
      const buffered = [...load.buffer.values()]
        .filter((record) => record.seq > throughSeq)
        .sort((left, right) => left.seq - right.seq);
      let gap = load.invalidated;
      for (const record of buffered) {
        if (record.seq <= throughSeq) continue;
        if (record.seq !== throughSeq + 1) {
          gap = true;
          break;
        }
        state = input.reduce(state, record);
        throughSeq = record.seq;
      }
      if (gap) continue;
      const entry = { state, throughSeq };
      cache.set(threadId, entry);
      return Object.freeze({ ...entry });
    }
  };

  const read = async (threadId: string): Promise<Readonly<{ state: TState; throughSeq: number }>> => {
    if (disposed) throw new Error('Feature projection store is disposed.');
    const current = cache.get(threadId);
    if (current) return Object.freeze({ ...current });
    const inFlight = loads.get(threadId);
    if (inFlight) return inFlight.promise as Promise<Readonly<{ state: TState; throughSeq: number }>>;

    const load: LoadEntry = {
      buffer: new Map<number, SequencedThreadEventRecord>(),
      invalidated: false,
      promise: Promise.resolve({ state: undefined as unknown, throughSeq: 0 }),
    };
    load.promise = replay(threadId, load).finally(() => {
      if (loads.get(threadId) === load) loads.delete(threadId);
    });
    loads.set(threadId, load);
    return load.promise as Promise<Readonly<{ state: TState; throughSeq: number }>>;
  };

  const accept = (record: SequencedThreadEventRecord): Promise<void> => {
    if (disposed) return Promise.resolve();
    const loading = loads.get(record.threadId);
    if (loading) {
      loading.buffer.set(record.seq, record);
      return Promise.resolve();
    }
    if (!cache.has(record.threadId)) return Promise.resolve();

    const previous = tails.get(record.threadId) ?? Promise.resolve();
    const run = previous.then(() => {
      if (disposed) return;
      const current = cache.get(record.threadId);
      if (!current || record.seq <= current.throughSeq) return;
      if (record.seq !== current.throughSeq + 1) {
        invalidate(record.threadId);
        return;
      }
      cache.set(record.threadId, {
        state: input.reduce(current.state, record),
        throughSeq: record.seq,
      });
    });
    const tail = run.then(() => undefined, () => undefined);
    tails.set(record.threadId, tail);
    return run.finally(() => {
      if (tails.get(record.threadId) === tail) tails.delete(record.threadId);
    });
  };

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await Promise.allSettled([
      ...[...loads.values()].map((load) => load.promise),
      ...tails.values(),
    ]);
    loads.clear();
    tails.clear();
    cache.clear();
  };

  return Object.freeze({ featureId: input.featureId, read, accept, invalidate, dispose });
}
