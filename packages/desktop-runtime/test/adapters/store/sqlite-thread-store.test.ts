import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { RuntimeStorageInUseError, SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { systemClock } from '../../../src/ports/clock.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('sqlite thread store', () => {
  it('persists events, snapshots, summaries, and message mutations across reopen', async () => {
    const dataDir = await temporaryDirectory();
    const first = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await first.recover();
    const thread = await first.createThread({ title: 'SQLite chat', projectId: 'project_1' });
    await first.appendEvent(thread.id, messageCreatedEvent(thread.id, 'msg_1', 'hello sqlite'));
    const updated = await first.updateMessage(thread.id, 'msg_1', { content: 'edited sqlite' });
    expect(updated).toMatchObject({ lastMessagePreview: 'edited sqlite', messageCount: 1 });
    await first.close();

    const reopened = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await reopened.recover();
    await expect(reopened.getThread(thread.id)).resolves.toMatchObject({
      id: thread.id,
      projectId: 'project_1',
      messages: [expect.objectContaining({ id: 'msg_1', content: 'edited sqlite' })],
    });
    await expect(reopened.listThreads({ projectId: 'project_1' })).resolves.toMatchObject([
      { id: thread.id, lastMessagePreview: 'edited sqlite' },
    ]);
    await expect(reopened.listEvents(thread.id, 1)).resolves.toHaveLength(2);
    await reopened.close();
  });

  it('serializes concurrent appends and allocates a contiguous database sequence', async () => {
    const dataDir = await temporaryDirectory();
    const store = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await store.recover();
    const thread = await store.createThread({ title: 'Concurrent SQLite chat' });

    await Promise.all(Array.from({ length: 24 }, (_, index) =>
      store.appendEvent(thread.id, messageCreatedEvent(thread.id, `msg_${index}`, `message ${index}`)),
    ));

    const events = await store.listEvents(thread.id);
    expect(events.map((event) => event.seq)).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    await store.close();
  });

  it('rejects a gap in persisted SQLite events instead of returning a partial history', async () => {
    const dataDir = await temporaryDirectory();
    const first = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await first.recover();
    const thread = await first.createThread({ title: 'SQLite event gap' });
    await first.appendEvent(thread.id, messageCreatedEvent(thread.id, 'msg_1', 'first'));
    await first.appendEvent(thread.id, messageCreatedEvent(thread.id, 'msg_2', 'second'));
    await first.close();

    const database = new DatabaseSync(path.join(dataDir, 'threads.sqlite'));
    database.prepare('DELETE FROM runtime_events WHERE thread_id = ? AND seq = 2').run(thread.id);
    database.close();

    const reopened = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await reopened.recover();
    await expect(reopened.listEvents(thread.id)).rejects.toThrow(
      `Invalid SQLite runtime event sequence for ${thread.id}: expected 2, got 3`,
    );
    await reopened.close();
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

    const database = new DatabaseSync(path.join(dataDir, 'threads.sqlite'));
    database.prepare(`
      INSERT OR REPLACE INTO runtime_owner(slot, owner_id, fence_token, lease_expires_at)
      VALUES (1, ?, ?, ?)
    `).run('owner_unclean_exit', 7, Date.now() + 75);
    database.close();

    const restarted = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator(), {
      ownerId: 'owner_restarted',
      ownershipWaitMs: 1_000,
    });
    await expect(restarted.recover()).resolves.toBeUndefined();
    await restarted.close();
  });

  it('replays a committed event tail that was not included in the last snapshot checkpoint', async () => {
    const dataDir = await temporaryDirectory();
    const first = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await first.recover();
    const thread = await first.createThread({ title: 'Tail recovery' });
    await first.close();

    const event = { ...messageCreatedEvent(thread.id, 'msg_tail', 'replayed tail'), seq: 2 } as RuntimeEvent;
    const database = new DatabaseSync(path.join(dataDir, 'threads.sqlite'));
    database.exec('PRAGMA foreign_keys = ON');
    database.prepare(`
      INSERT INTO runtime_events(thread_id, seq, event_id, type, turn_id, created_at, event_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(event.threadId, event.seq, event.id, event.type, null, event.createdAt, JSON.stringify(event));
    database.prepare(`
      UPDATE threads
      SET last_seq = 2, updated_at = ?, message_count = 1, last_message_preview = ?
      WHERE id = ?
    `).run(event.createdAt, 'replayed tail', thread.id);
    database.close();

    const recovered = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await recovered.recover();
    await expect(recovered.getThread(thread.id)).resolves.toMatchObject({
      lastSeq: 2,
      messages: [expect.objectContaining({ id: 'msg_tail', content: 'replayed tail' })],
    });
    await recovered.close();

    const inspected = new DatabaseSync(path.join(dataDir, 'threads.sqlite'), { readOnly: true });
    expect(inspected.prepare('SELECT snapshot_seq FROM threads WHERE id = ?').get(thread.id)).toMatchObject({ snapshot_seq: 2 });
    inspected.close();
  });

  it('imports a valid legacy JSON store once without modifying the source files', async () => {
    const dataDir = await temporaryDirectory();
    const legacy = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await legacy.createThread({ title: 'Legacy import', parentThreadId: 'thread_parent' });
    await legacy.appendEvent(thread.id, messageCreatedEvent(thread.id, 'msg_legacy', 'preserve me'));
    await legacy.flush();
    const snapshotPath = path.join(dataDir, 'threads', `${thread.id}.json`);
    const eventsPath = path.join(dataDir, 'threads', `${thread.id}.jsonl`);
    const beforeSnapshot = await readFile(snapshotPath, 'utf8');
    const beforeEvents = await readFile(eventsPath, 'utf8');

    const sqlite = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await sqlite.recover();
    await expect(sqlite.getThread(thread.id)).resolves.toMatchObject({
      parentThreadId: 'thread_parent',
      messages: [expect.objectContaining({ id: 'msg_legacy', content: 'preserve me' })],
    });
    expect(await readFile(snapshotPath, 'utf8')).toBe(beforeSnapshot);
    expect(await readFile(eventsPath, 'utf8')).toBe(beforeEvents);
    await sqlite.close();

    const reopened = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await expect(reopened.recover()).resolves.toBeUndefined();
    await expect(reopened.listThreads({ includeArchived: true })).resolves.toHaveLength(1);
    await reopened.close();
  });

  it('recovers an interior duplicate sequence when a later snapshot proves the last writer continued', async () => {
    const dataDir = await temporaryDirectory();
    const legacy = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await legacy.createThread({ title: 'Duplicate sequence recovery' });
    await legacy.appendEvent(thread.id, messageCreatedEvent(thread.id, 'msg_1', 'first'));
    await legacy.appendEvent(thread.id, messageCreatedEvent(thread.id, 'msg_2', 'second'));
    await legacy.flush();

    const eventsPath = path.join(dataDir, 'threads', `${thread.id}.jsonl`);
    const originalLines = (await readFile(eventsPath, 'utf8')).trimEnd().split('\n');
    const duplicate = {
      ...JSON.parse(originalLines[1]) as RuntimeEvent,
      id: 'event_last_writer_seq_2',
    };
    originalLines.splice(2, 0, JSON.stringify(duplicate));
    const sourceWithConflict = `${originalLines.join('\n')}\n`;
    await writeFile(eventsPath, sourceWithConflict, 'utf8');

    const sqlite = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await expect(sqlite.recover()).resolves.toBeUndefined();
    await expect(sqlite.listEvents(thread.id)).resolves.toMatchObject([
      { seq: 1 },
      { id: 'event_last_writer_seq_2', seq: 2 },
      { seq: 3 },
    ]);
    expect(await readFile(eventsPath, 'utf8')).toBe(sourceWithConflict);
    await sqlite.close();

    const inspected = new DatabaseSync(path.join(dataDir, 'threads.sqlite'), { readOnly: true });
    const metadata = inspected.prepare('SELECT value FROM store_metadata WHERE key = ?').get('legacy_json_import') as {
      value: string;
    };
    expect(JSON.parse(metadata.value)).toMatchObject({
      duplicateSequenceRecoveries: [{
        discardedEventId: JSON.parse(originalLines[1]).id,
        discardedLine: 2,
        keptEventId: 'event_last_writer_seq_2',
        keptLine: 3,
        seq: 2,
        threadId: thread.id,
      }],
    });
    inspected.close();
  });

  it('rejects corrupt legacy sequences without silently truncating or partially importing them', async () => {
    const dataDir = await temporaryDirectory();
    const legacy = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await legacy.createThread({ title: 'Corrupt legacy import' });
    await legacy.flush();
    const eventsPath = path.join(dataDir, 'threads', `${thread.id}.jsonl`);
    const original = await readFile(eventsPath, 'utf8');
    const firstEvent = JSON.parse(original.trim()) as RuntimeEvent;
    await appendFile(eventsPath, `${JSON.stringify({ ...firstEvent, id: 'event_duplicate_seq' })}\n`, 'utf8');

    const sqlite = new SqliteThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await expect(sqlite.recover()).rejects.toThrow('Invalid runtime event sequence');
    expect(await readFile(eventsPath, 'utf8')).toBe(`${original}${JSON.stringify({ ...firstEvent, id: 'event_duplicate_seq' })}\n`);

    const inspected = new DatabaseSync(path.join(dataDir, 'threads.sqlite'), { readOnly: true });
    expect(inspected.prepare('SELECT COUNT(*) AS count FROM threads').get()).toMatchObject({ count: 0 });
    inspected.close();
  });
});

function messageCreatedEvent(
  threadId: string,
  messageId: string,
  content: string,
): Omit<Extract<RuntimeEvent, { type: 'message.created' }>, 'seq'> {
  const createdAt = systemClock.now().toISOString();
  return {
    id: `event_${messageId}`,
    threadId,
    type: 'message.created',
    createdAt,
    payload: {
      message: {
        id: messageId,
        role: 'user',
        content,
        createdAt,
        status: 'complete',
      },
    },
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-sqlite-thread-store-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
