import { describe, expect, it } from 'vitest';
import { isFeatureEventEnvelope, type SequencedThreadEventRecord } from '../../src/events.js';
import { defineFeatureDefinition } from '../../src/definition.js';
import {
  createFeatureProjectionStore,
  type ThreadEventReader,
} from '../../src/runtime/events.js';

const featureId = defineFeatureDefinition({ id: 'fixture-state', version: '1.0.0' }).id;

describe('FeatureProjectionStore', () => {
  it('uses one reducer for replay and live records while advancing over unrelated seqs', async () => {
    const reader = new MemoryEventReader([
      coreEvent(1),
      featureEvent(2, 2),
      coreEvent(3),
    ]);
    const store = projection(reader);

    await expect(store.read('thread_1')).resolves.toEqual({ state: 2, throughSeq: 3 });
    await store.accept(coreEvent(3));
    await store.accept(featureEvent(4, 3));

    await expect(store.read('thread_1')).resolves.toEqual({ state: 5, throughSeq: 4 });
  });

  it('shares a lazy replay and drains live records above its fixed high water', async () => {
    const highWater = deferred<number>();
    const reader = new MemoryEventReader([coreEvent(1)], () => highWater.promise);
    const store = projection(reader);

    const first = store.read('thread_1');
    const second = store.read('thread_1');
    await store.accept(featureEvent(2, 4));
    highWater.resolve(1);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { state: 4, throughSeq: 2 },
      { state: 4, throughSeq: 2 },
    ]);
    expect(reader.highWaterReads).toBe(1);
  });

  it('invalidates a live gap and rebuilds from the durable event source', async () => {
    const reader = new MemoryEventReader([coreEvent(1)]);
    const store = projection(reader);
    await store.read('thread_1');

    reader.records.push(featureEvent(2, 2), featureEvent(3, 5));
    await store.accept(reader.records[2]!);

    await expect(store.read('thread_1')).resolves.toEqual({ state: 7, throughSeq: 3 });
    expect(reader.highWaterReads).toBe(2);
  });

  it('drops its cache on dispose without touching the durable records', async () => {
    const reader = new MemoryEventReader([featureEvent(1, 2)]);
    const store = projection(reader);
    await store.read('thread_1');

    await store.dispose();
    await store.accept(featureEvent(2, 4));

    await expect(store.read('thread_1')).rejects.toThrow('disposed');
    expect(reader.records).toHaveLength(1);
  });
});

function projection(reader: ThreadEventReader) {
  return createFeatureProjectionStore<number>({
    featureId,
    eventReader: reader,
    initialState: () => 0,
    reduce: (state, record) => (
      isFeatureEventEnvelope(record) && record.featureId === featureId
        ? state + Number((record.payload as { amount: number }).amount)
        : state
    ),
    pageSize: 2,
  });
}

class MemoryEventReader implements ThreadEventReader {
  highWaterReads = 0;

  constructor(
    readonly records: SequencedThreadEventRecord[],
    private readonly readHighWater: () => Promise<number> = async () => (
      this.records.at(-1)?.seq ?? 0
    ),
  ) {}

  async highWater(): Promise<number> {
    this.highWaterReads += 1;
    return this.readHighWater();
  }

  async readPage(
    _threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
  ) {
    return {
      records: this.records
        .filter((record) => record.seq > input.afterSeq && record.seq <= input.throughSeq)
        .slice(0, input.limit),
      throughSeq: input.throughSeq,
    };
  }
}

function coreEvent(seq: number): SequencedThreadEventRecord {
  return {
    id: `core_${seq}`,
    seq,
    threadId: 'thread_1',
    type: 'thread.updated',
    createdAt: '2026-08-22T00:00:00.000Z',
    payload: {},
  };
}

function featureEvent(seq: number, amount: number): SequencedThreadEventRecord {
  return {
    id: `feature_${seq}`,
    seq,
    threadId: 'thread_1',
    type: 'feature.event',
    createdAt: '2026-08-22T00:00:00.000Z',
    featureId,
    eventType: 'fixture.changed',
    schemaVersion: 1,
    payload: { amount },
  } as SequencedThreadEventRecord;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
