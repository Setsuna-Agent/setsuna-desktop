import type { Clock } from '../../src/ports/clock.js';
import type { IdGenerator } from '../../src/ports/id-generator.js';
import { SqliteThreadStore } from '../../src/adapters/store/sqlite-thread-store.js';
import { onTestFinished } from 'vitest';

const openStores = new Set<SqliteThreadStore>();

/**
 * Uses the production persistence adapter in tests while keeping its lease and database lifecycle
 * scoped to the current test. A zero checkpoint delay keeps projections deterministic without
 * reintroducing the retired JSON store as a test double.
 */
export function createTestThreadStore(dataDir: string, clock: Clock, ids: IdGenerator): SqliteThreadStore {
  const store = new SqliteThreadStore(dataDir, clock, ids, {
    checkpointDelayMs: 0,
    ownershipWaitMs: 0,
  });
  openStores.add(store);
  onTestFinished(async () => {
    openStores.delete(store);
    await store.close();
  });
  return store;
}

/** Close stores before tests remove their temporary roots on Windows. */
export async function closeTestThreadStores(): Promise<void> {
  const stores = [...openStores];
  openStores.clear();
  const outcomes = await Promise.allSettled(stores.map((store) => store.close()));
  const failures = outcomes
    .filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    .map((outcome) => outcome.reason);
  if (failures.length) throw new AggregateError(failures, 'Failed to close test thread stores.');
}
