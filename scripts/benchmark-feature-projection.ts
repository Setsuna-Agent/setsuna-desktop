import type {
  PendingStoredThreadEvent,
  StoredThreadEvent,
} from '@setsuna-desktop/contracts';
import { isFeatureEventEnvelope } from '@setsuna-desktop/feature-core/events';
import { defineFeature } from '@setsuna-desktop/feature-core/definition';
import {
  createFeatureProjectionStore,
  type ThreadEventReader,
} from '@setsuna-desktop/feature-core/runtime';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

type BenchmarkThreadStore = Readonly<{
  recover(): Promise<void>;
  createThread(input: Readonly<{ title: string }>): Promise<Readonly<{ id: string; lastSeq: number }>>;
  appendEvents(threadId: string, events: readonly PendingStoredThreadEvent[]): Promise<readonly StoredThreadEvent[]>;
  getThread(threadId: string): Promise<Readonly<{ lastSeq: number }> | null>;
  readEventPage(
    threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
  ): Promise<readonly StoredThreadEvent[]>;
  close(): Promise<void>;
}>;

type BenchmarkThreadStoreConstructor = new (
  dataDir: string,
  clock: Readonly<{ now(): Date }>,
  ids: Readonly<{ id(prefix: string): string }>,
) => BenchmarkThreadStore;
type ThreadStoreEventReaderConstructor = new (
  store: Pick<BenchmarkThreadStore, 'getThread' | 'readEventPage'>,
) => ThreadEventReader;

// This diagnostic intentionally exercises the concrete adapters without adding runtime internals
// to the Electron TypeScript project. The variable import remains runtime-resolved by tsx.
const sqliteStoreModulePath = '../packages/desktop-runtime/src/adapters/store/sqlite-thread-store.js';
const eventReaderModulePath = '../packages/desktop-runtime/src/features/events/thread-store-event-reader.js';
const { SqliteThreadStore } = await import(sqliteStoreModulePath) as Readonly<{
  SqliteThreadStore: BenchmarkThreadStoreConstructor;
}>;
const { ThreadStoreEventReader } = await import(eventReaderModulePath) as Readonly<{
  ThreadStoreEventReader: ThreadStoreEventReaderConstructor;
}>;
const systemClock = Object.freeze({ now: () => new Date() });

const firstFeature = defineFeature('benchmark-first').id;
const secondFeature = defineFeature('benchmark-second').id;
const eventCounts = integerListArgument('--events', [10_000, 50_000, 100_000]);
const runs = integerArgument('--runs', 3);
const batchSize = integerArgument('--batch-size', 5_000);

type BenchmarkRow = Readonly<{
  events: number;
  projections: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  medianPages: number;
  medianRecords: number;
}>;

async function main(): Promise<void> {
  const rows: BenchmarkRow[] = [];
  for (const eventCount of eventCounts) {
    rows.push(...await benchmarkEventCount(eventCount));
  }

  console.table(rows);
  console.log('Diagnostic only: process-cold projection stores over a real SQLite reader; OS cache is not cleared and no threshold is enforced.');
}

async function benchmarkEventCount(eventCount: number): Promise<readonly BenchmarkRow[]> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-feature-projection-benchmark-'));
  try {
    const ids = deterministicIds();
    const writer = new SqliteThreadStore(dataDir, systemClock, ids);
    await writer.recover();
    const thread = await writer.createThread({ title: `Projection benchmark ${eventCount}` });
    const generatedCount = eventCount - 1;
    for (let offset = 0; offset < generatedCount; offset += batchSize) {
      const count = Math.min(batchSize, generatedCount - offset);
      await writer.appendEvents(thread.id, Array.from({ length: count }, (_, index) => (
        benchmarkEvent(thread.id, offset + index + 2)
      )));
    }
    await writer.close();

    const readerStore = new SqliteThreadStore(dataDir, systemClock, deterministicIds());
    await readerStore.recover();
    try {
      return [
        await runScenario(readerStore, thread.id, eventCount, 1),
        await runScenario(readerStore, thread.id, eventCount, 2),
      ];
    } finally {
      await readerStore.close();
    }
  } finally {
    await rm(dataDir, { force: true, recursive: true });
  }
}

async function runScenario(
  store: BenchmarkThreadStore,
  threadId: string,
  eventCount: number,
  projectionCount: 1 | 2,
): Promise<BenchmarkRow> {
  const durations: number[] = [];
  const pageCounts: number[] = [];
  const recordCounts: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const reader = new CountingThreadEventReader(new ThreadStoreEventReader(store));
    const featureIds = projectionCount === 1 ? [firstFeature] : [firstFeature, secondFeature];
    const projections = featureIds.map((featureId) => createFeatureProjectionStore<number>({
      eventReader: reader,
      initialState: () => 0,
      reduce: (state, record) => (
        isFeatureEventEnvelope(record) && record.featureId === featureId ? state + 1 : state
      ),
    }));
    const startedAt = performance.now();
    const snapshots = await Promise.all(projections.map((projection) => projection.read(threadId)));
    durations.push(performance.now() - startedAt);
    pageCounts.push(reader.pages);
    recordCounts.push(reader.records);
    for (const snapshot of snapshots) {
      if (snapshot.throughSeq !== eventCount) {
        throw new Error(`Projection stopped at ${snapshot.throughSeq}; expected ${eventCount}.`);
      }
    }
    await Promise.all(projections.map((projection) => projection.dispose()));
  }
  return Object.freeze({
    events: eventCount,
    projections: projectionCount,
    medianMs: rounded(median(durations)),
    minMs: rounded(Math.min(...durations)),
    maxMs: rounded(Math.max(...durations)),
    medianPages: median(pageCounts),
    medianRecords: median(recordCounts),
  });
}

class CountingThreadEventReader implements ThreadEventReader {
  pages = 0;
  records = 0;

  constructor(private readonly reader: ThreadEventReader) {}

  highWater(threadId: string): Promise<number> {
    return this.reader.highWater(threadId);
  }

  async readPage(
    threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
  ) {
    const page = await this.reader.readPage(threadId, input);
    this.pages += 1;
    this.records += page.records.length;
    return page;
  }
}

function benchmarkEvent(threadId: string, index: number): PendingStoredThreadEvent {
  const base = {
    id: `event_projection_benchmark_${index}`,
    threadId,
    createdAt: '2026-08-24T00:00:00.000Z',
  };
  if (index % 20 !== 0) {
    return { ...base, type: 'thread.updated', payload: {} };
  }
  return {
    ...base,
    type: 'feature.event',
    featureId: index % 40 === 0 ? secondFeature : firstFeature,
    eventType: 'benchmark.state-changed',
    schemaVersion: 1,
    payload: { value: index },
  };
}

function deterministicIds() {
  let sequence = 0;
  return Object.freeze({
    id: (prefix: string) => `${prefix}_benchmark_${sequence += 1}`,
  });
}

function integerListArgument(name: string, fallback: readonly number[]): readonly number[] {
  const raw = argumentValue(name);
  if (!raw) return fallback;
  const values = raw.split(',').map((value) => positiveInteger(value, name));
  return Object.freeze([...new Set(values)]);
}

function integerArgument(name: string, fallback: number): number {
  const raw = argumentValue(name);
  return raw ? positiveInteger(raw, name) : fallback;
}

function argumentValue(name: string): string | null {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must contain positive integers.`);
  }
  return parsed;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

await main();
