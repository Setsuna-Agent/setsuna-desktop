import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { RuntimeStorageInUseError, SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { systemClock } from '../../../src/ports/clock.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-sqlite-ownership-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('SQLite runtime ownership', () => {
  it('releases the runtime lease and checkpoints WAL before migration shutdown completes', async () => {
    const dataDir = await temporaryDirectory();
    const store = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await store.recover();
    await store.createThread({ title: 'Checkpoint before migration' });

    await store.close();

    const databasePath = path.join(dataDir, 'threads.sqlite');
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const owner = database.prepare('SELECT COUNT(*) AS count FROM runtime_owner').get() as {
        count: number;
      };
      expect(Number(owner.count)).toBe(0);
      expect(database.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' });
    } finally {
      database.close();
    }
    const wal = await stat(`${databasePath}-wal`).catch(() => null);
    expect(wal?.size ?? 0).toBe(0);
  });

  it('rejects a second runtime owner before it can recover or append stale-turn events', async () => {
    const dataDir = await temporaryDirectory();
    const first = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator(), { ownerId: 'owner_first' });
    const second = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator(), {
      ownerId: 'owner_second',
      ownershipWaitMs: 0,
    });
    await first.recover();

    await expect(second.recover()).rejects.toBeInstanceOf(RuntimeStorageInUseError);
    await first.close();

    const next = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator(), { ownerId: 'owner_next' });
    await expect(next.recover()).resolves.toBeUndefined();
    await next.close();
  });

  it('waits for an uncleanly released runtime lease to expire during restart', async () => {
    const dataDir = await temporaryDirectory();
    const initialized = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await initialized.recover();
    await initialized.close();

    let leaseNow = Date.parse('2026-01-01T00:00:00.000Z');
    const leaseExpiresAt = leaseNow + 75;
    let signalLeaseAttempt!: () => void;
    const waitingForLease = new Promise<void>((resolve) => { signalLeaseAttempt = resolve; });
    const clock = { now: () => {
      signalLeaseAttempt();
      return new Date(leaseNow);
    } };
    const database = new DatabaseSync(path.join(dataDir, 'threads.sqlite'));
    database.prepare(`
      INSERT OR REPLACE INTO runtime_owner(slot, owner_id, fence_token, lease_expires_at)
      VALUES (1, ?, ?, ?)
    `).run('owner_unclean_exit', 7, leaseExpiresAt);
    database.close();

    const restarted = new SqliteThreadStore(dataDir, clock, new RandomIdGenerator(), {
      ownerId: 'owner_restarted',
      ownershipWaitMs: 1_000,
    });
    let recovered = false;
    const recovery = restarted.recover().then(() => { recovered = true; });
    try {
      await waitingForLease;
      expect(recovered).toBe(false);
      // Inspect durable ownership before moving time forward; a slow runner cannot let the lease expire.
      const ownership = new DatabaseSync(path.join(dataDir, 'threads.sqlite'), { readOnly: true });
      try {
        expect(ownership.prepare('SELECT owner_id, fence_token FROM runtime_owner').get())
          .toMatchObject({ owner_id: 'owner_unclean_exit', fence_token: 7 });
        leaseNow = leaseExpiresAt;
        await recovery;
        expect(ownership.prepare('SELECT owner_id, fence_token FROM runtime_owner').get())
          .toMatchObject({ owner_id: 'owner_restarted', fence_token: 8 });
      } finally {
        ownership.close();
      }
    } finally {
      leaseNow = leaseExpiresAt;
      await restarted.close();
    }
  });
});
