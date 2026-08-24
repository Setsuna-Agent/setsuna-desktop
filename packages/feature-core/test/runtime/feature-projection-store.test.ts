import { describe, expect, it } from 'vitest';
import { isFeatureEventEnvelope, type SequencedThreadEventRecord } from '../../src/events.js';
import { defineFeature } from '../../src/definition.js';
import {
  createFeatureProjectionStore,
  type ThreadEventReader,
} from '../../src/runtime/events.js';

const featureId = defineFeature('fixture-state').id;

describe('FeatureProjectionStore', () => {
  it('extends its cached projection only when the durable high water advances', async () => {
    const reader = new MemoryEventReader([
      coreEvent(1),
      featureEvent(2, 2),
      coreEvent(3),
    ]);
    const store = projection(reader);

    await expect(store.read('thread_1')).resolves.toEqual({ state: 2, throughSeq: 3 });
    await expect(store.read('thread_1')).resolves.toEqual({ state: 2, throughSeq: 3 });
    reader.records.push(featureEvent(4, 3));

    await expect(store.read('thread_1')).resolves.toEqual({ state: 5, throughSeq: 4 });
    expect(reader.pageReads).toBe(3);
  });

  it('rechecks high water after sharing an in-flight load', async () => {
    const highWater = deferred<number>();
    let highWaterReads = 0;
    const records = [coreEvent(1)];
    const reader = new MemoryEventReader(records, (): Promise<number> => {
      highWaterReads += 1;
      return highWaterReads === 1
        ? highWater.promise
        : Promise.resolve(records.at(-1)?.seq ?? 0);
    });
    const store = projection(reader);

    const first = store.read('thread_1');
    const second = store.read('thread_1');
    records.push(featureEvent(2, 4));
    highWater.resolve(1);

    await expect(first).resolves.toEqual({ state: 0, throughSeq: 1 });
    await expect(second).resolves.toEqual({ state: 4, throughSeq: 2 });
    expect(reader.highWaterReads).toBe(2);
  });

  it('rejects a durable sequence gap without corrupting the last valid cache', async () => {
    const reader = new MemoryEventReader([coreEvent(1)]);
    const store = projection(reader);
    await expect(store.read('thread_1')).resolves.toEqual({ state: 0, throughSeq: 1 });

    reader.records.push(featureEvent(3, 5));
    await expect(store.read('thread_1')).rejects.toThrow('expected 2, got 3');

    reader.records.splice(1, 0, featureEvent(2, 2));
    await expect(store.read('thread_1')).resolves.toEqual({ state: 7, throughSeq: 3 });
  });

  it('drops its cache on dispose without touching the durable records', async () => {
    const reader = new MemoryEventReader([featureEvent(1, 2)]);
    const store = projection(reader);
    await store.read('thread_1');

    await store.dispose();

    await expect(store.read('thread_1')).rejects.toThrow('disposed');
    expect(reader.records).toHaveLength(1);
  });
});

function projection(reader: ThreadEventReader) {
  return createFeatureProjectionStore<number>({
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
  pageReads = 0;

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
    this.pageReads += 1;
    return {
      records: [...this.records]
        .filter((record) => record.seq > input.afterSeq && record.seq <= input.throughSeq)
        .sort((left, right) => left.seq - right.seq)
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
