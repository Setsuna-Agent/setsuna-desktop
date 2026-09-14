import type { RuntimeModelRequestStepSnapshot } from '@setsuna-desktop/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { decodeSqliteJson } from '../../../src/adapters/store/sqlite/json.js';
import { RuntimeEventWriter } from '../../../src/loop/lifecycle/runtime-event-writer.js';
import { systemClock } from '../../../src/ports/clock.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
const directories: string[] = [];
const stores: SqliteThreadStore[] = [];
const createdAt = '2026-09-14T00:00:00.000Z';

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-storage-test-'));
  directories.push(directory);
  return directory;
}

function openStore(directory: string, retention = 4096) {
  const store = new SqliteThreadStore(directory, systemClock, new RandomIdGenerator(), {
    checkpointDelayMs: 60_000, eventRetentionLimit: retention,
  });
  stores.push(store);
  return store;
}

function stepSnapshot(threadId: string): RuntimeModelRequestStepSnapshot {
  return {
    threadId, turnId: 'old_turn', threadLastSeq: 1,
    conversationMessageIds: [], messageIds: Array.from({ length: 600 }, (_, index) => `message_${index}`),
    toolNames: [], selectedSkills: [], mcpServerKeys: [], mcpServerCount: 0,
    permissionProfile: 'workspace-write', featureKeys: [],
    worldState: { threadMessageCount: 1, threadUpdatedAt: createdAt },
  };
}

describe('incremental SQLite thread storage', () => {
  it('keeps checkpoints small, leaves old rows untouched, and recovers a committed tail after a crash', async () => {
    const directory = await temporaryDirectory();
    const store = openStore(directory);
    const thread = await store.createThread();
    await store.appendEvent(thread.id, {
      id: 'old_message_event', threadId: thread.id, turnId: 'old_turn', type: 'message.created', createdAt,
      payload: { message: { id: 'old_message', turnId: 'old_turn', role: 'assistant', content: 'history '.repeat(20_000), status: 'complete', phase: 'final_answer', completedAt: createdAt, createdAt } },
    });
    for (let index = 0; index < 20; index += 1) {
      await store.appendEvent(thread.id, {
        id: `step_${index}`, threadId: thread.id, turnId: 'old_turn', type: 'turn.step_snapshot', createdAt,
        payload: { snapshot: stepSnapshot(thread.id) },
      });
    }
    await store.flush();
    const database = new DatabaseSync(store.databasePath);
    try {
      const header = database.prepare('SELECT snapshot_json FROM threads WHERE id = ?').get(thread.id)!;
      expect(Buffer.byteLength(String(header.snapshot_json))).toBeLessThan(2048);
      const oldTurn = database.prepare('SELECT turn_json FROM thread_turn_checkpoints').get()!;
      expect(decodeSqliteJson(oldTurn.turn_json)).toMatchObject({ stepCount: 20 });
      expect(decodeSqliteJson<{ turn: object }>(oldTurn.turn_json).turn).not.toHaveProperty('stepSnapshots');
      expect(database.prepare("SELECT typeof(event_json) AS encoding FROM runtime_events WHERE event_id = 'step_0'").get())
        .toMatchObject({ encoding: 'blob' });
      database.exec(`
        CREATE TABLE old_row_writes (kind TEXT);
        CREATE TRIGGER old_message_rewrite AFTER UPDATE ON thread_messages
          WHEN old.message_id = 'old_message' BEGIN INSERT INTO old_row_writes VALUES ('message'); END;
        CREATE TRIGGER old_turn_rewrite AFTER UPDATE ON thread_turn_checkpoints
          WHEN old.turn_id = 'old_turn' BEGIN INSERT INTO old_row_writes VALUES ('turn'); END;
      `);
      await store.appendEvent(thread.id, {
        id: 'new_turn_event', threadId: thread.id, turnId: 'new_turn', type: 'turn.started', createdAt, payload: { input: 'Continue' },
      });
      await store.appendEvent(thread.id, {
        id: 'new_message_event', threadId: thread.id, turnId: 'new_turn', type: 'message.created', createdAt,
        payload: { message: { id: 'new_message', turnId: 'new_turn', role: 'assistant', content: '', status: 'streaming', createdAt } },
      });
      await store.appendEvent(thread.id, {
        id: 'delta', threadId: thread.id, turnId: 'new_turn', type: 'message.delta', createdAt,
        payload: { messageId: 'new_message', text: 'Committed but not checkpointed' },
      });
      expect(database.prepare("SELECT message_json FROM thread_messages WHERE message_id = 'new_message'").get()).toBeUndefined();
      expect((await store.listMessages(thread.id)).messages.at(-1)?.content).toBe('Committed but not checkpointed');
      const expected = await store.getThread(thread.id);

      // Copy SQLite's committed view before close() flushes pending projections. This models
      // process loss without manufacturing an inconsistent mix of checkpoint rows.
      const crashDirectory = await temporaryDirectory();
      database.exec(`VACUUM INTO '${path.join(crashDirectory, 'threads.sqlite').replaceAll("'", "''")}'`);
      const crashed = new DatabaseSync(path.join(crashDirectory, 'threads.sqlite'));
      crashed.exec('DELETE FROM runtime_owner');
      crashed.close();
      const recovered = openStore(crashDirectory);
      expect(await recovered.getThread(thread.id)).toEqual(expected);
      await recovered.close();
      const reopened = openStore(crashDirectory);
      expect(await reopened.getThread(thread.id)).toEqual(expected);

      await store.flush();
      expect(database.prepare('SELECT * FROM old_row_writes').all()).toEqual([]);
    } finally { database.close(); }
  });

  it('queries turn outcomes without reading or decompressing unrelated archived events', async () => {
    const store = openStore(await temporaryDirectory(), 1);
    const thread = await store.createThread();
    await store.appendEvent(thread.id, {
      id: 'delta', threadId: thread.id, turnId: 'turn', type: 'message.delta', createdAt,
      payload: { messageId: 'message', text: 'archived output' },
    });
    await store.appendEvent(thread.id, {
      id: 'completed', threadId: thread.id, turnId: 'turn', type: 'turn.completed', createdAt, payload: {},
    });
    await store.flush();
    const database = new DatabaseSync(store.databasePath);
    database.prepare('UPDATE runtime_event_archives SET events_gzip = ?').run(Buffer.from('unreadable'));
    database.close();
    await expect(store.listEvents(thread.id, 0, { turnId: 'turn', types: ['turn.completed', 'turn.cancelled'] }))
      .resolves.toMatchObject([{ id: 'completed', seq: 3 }]);
    await expect(store.listEvents(thread.id)).rejects.toThrow('Invalid SQLite runtime event archive');
  });

  it('commits a streaming batch atomically before publishing any of its events', async () => {
    const store = openStore(await temporaryDirectory());
    const thread = await store.createThread();
    const initialEvent = (await store.listEvents(thread.id))[0]!;
    const bus = new InMemoryEventBus();
    const published: unknown[] = [];
    bus.subscribe(thread.id, (event) => published.push(event));
    const writer = new RuntimeEventWriter(store, bus, 60_000);
    await writer.append(thread.id, {
      id: 'first_delta', threadId: thread.id, type: 'message.delta', createdAt,
      payload: { messageId: 'message', text: 'a' },
    });
    await writer.append(thread.id, {
      id: initialEvent.id, threadId: thread.id, type: 'item.delta', createdAt,
      payload: { itemId: 'item', delta: 'b' },
    });
    await expect(writer.flushThread(thread.id)).rejects.toThrow();
    expect(published).toEqual([]);
    expect(await store.getThreadLastSeq(thread.id)).toBe(1);
    expect(await store.listEvents(thread.id)).toEqual([initialEvent]);
  });
});
