import { defineCapability, type CapabilityToken } from '../capability.js';
import type { SequencedThreadEventRecord } from '../events.js';

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
  read(threadId: string): Promise<Readonly<{ state: TState; throughSeq: number }>>;
  dispose(): Promise<void>;
}

export const threadEventReaderCapability: CapabilityToken<ThreadEventReader> = defineCapability({
  id: 'runtime.thread-event-reader',
  description: 'Read a fixed global sequence range from the Core thread event source',
});

type CacheEntry<TState> = {
  state: TState;
  throughSeq: number;
};

const DEFAULT_PAGE_SIZE = 500;

/** Lazily extends a cached Feature projection to one fixed durable high water. */
export function createFeatureProjectionStore<TState>(input: Readonly<{
  eventReader: ThreadEventReader;
  initialState(): TState;
  reduce(state: TState, record: SequencedThreadEventRecord): TState;
  pageSize?: number;
}>): FeatureProjectionStore<TState> {
  const cache = new Map<string, CacheEntry<TState>>();
  const loads = new Map<string, Promise<Readonly<{ state: TState; throughSeq: number }>>>();
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  let disposed = false;

  const extend = async (threadId: string): Promise<Readonly<{
    state: TState;
    throughSeq: number;
  }>> => {
    const highWater = await input.eventReader.highWater(threadId);
    if (disposed) throw new Error('Feature projection store is disposed.');
    const current = cache.get(threadId);
    if (current?.throughSeq === highWater) return Object.freeze({ ...current });
    if (current && current.throughSeq > highWater) {
      throw new Error(`Feature projection high water moved backwards for ${threadId}.`);
    }

    let state = current?.state ?? input.initialState();
    let throughSeq = current?.throughSeq ?? 0;
    while (throughSeq < highWater) {
      const page = await input.eventReader.readPage(threadId, {
        afterSeq: throughSeq,
        throughSeq: highWater,
        limit: pageSize,
      });
      if (disposed) throw new Error('Feature projection store is disposed.');
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
    const entry = { state, throughSeq };
    cache.set(threadId, entry);
    return Object.freeze({ ...entry });
  };

  const read = async (threadId: string): Promise<Readonly<{ state: TState; throughSeq: number }>> => {
    if (disposed) throw new Error('Feature projection store is disposed.');
    const inFlight = loads.get(threadId);
    if (inFlight) {
      await inFlight;
      // A record may have committed after the shared load fixed its high water.
      return read(threadId);
    }

    const load = extend(threadId);
    loads.set(threadId, load);
    try {
      return await load;
    } finally {
      if (loads.get(threadId) === load) loads.delete(threadId);
    }
  };

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    loads.clear();
    cache.clear();
  };

  return Object.freeze({ read, dispose });
}
