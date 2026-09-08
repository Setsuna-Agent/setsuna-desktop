import { createFeatureProjectionStore } from '@setsuna-desktop/feature-core/runtime';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { ThreadStoreEventReader } from '../../../src/features/events/thread-store-event-reader.js';
import { systemClock } from '../../../src/ports/clock.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
const directories: string[] = [];
const stores: SqliteThreadStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function openStore(directory: string) {
  const store = new SqliteThreadStore(directory, systemClock, new RandomIdGenerator(), { eventRetentionLimit: 4 });
  stores.push(store);
  return store;
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-projection-checkpoints-'));
  directories.push(directory);
  const store = openStore(directory);
  const thread = await store.createThread({ title: 'Projection recovery' });
  await store.appendEvent(thread.id, {
    id: 'message_created', threadId: thread.id, createdAt: systemClock.now().toISOString(),
    type: 'message.created', payload: { message: {
      id: 'message_1', role: 'assistant', content: '', status: 'streaming',
      createdAt: systemClock.now().toISOString(),
    } },
  });
  await store.appendEvents(thread.id, Array.from({ length: 20 }, (_, index) => ({
    id: `delta_${index}`, threadId: thread.id, createdAt: systemClock.now().toISOString(),
    type: 'message.delta' as const, payload: { messageId: 'message_1', text: 'hello' },
  })));
  await store.flush();
  return { directory, store, threadId: thread.id };
}

function projection(store: SqliteThreadStore, key = 'fixture:1') {
  return createFeatureProjectionStore({
    eventReader: new ThreadStoreEventReader(store),
    checkpoint: { key, codec: { parse(value: unknown) {
      if (typeof value !== 'number') throw new Error('Invalid fixture state');
      return value;
    } } },
    initialState: () => 0,
    reduce: (count) => count + 1,
    pageSize: 5,
  });
}

describe('SQLite Feature projection checkpoints', () => {
  it('reopens from a checkpoint without loading message history or replaying archives, then reads only the new tail', async () => {
    const { store, threadId, directory } = await fixture();
    const first = projection(store);
    const expected = await first.read(threadId);
    expect(expected.state).toBe(22);
    await first.dispose();
    await store.close();

    const reopened = openStore(directory);
    const fullThreadRead = vi.spyOn(reopened, 'getThread');
    const pages = vi.spyOn(reopened, 'readEventPage');
    const second = projection(reopened);
    await expect(second.read(threadId)).resolves.toEqual(expected);
    expect(pages).not.toHaveBeenCalled();
    expect(fullThreadRead).not.toHaveBeenCalled();

    await reopened.updateThread(threadId, { title: 'Tail' });
    await expect(second.read(threadId)).resolves.toEqual({ state: 23, throughSeq: 23 });
    expect(pages).toHaveBeenCalledExactlyOnceWith(threadId, { afterSeq: 22, throughSeq: 23, limit: 5 });
    await second.dispose();
  });

  it.each(['invalid-json', 'invalid-state', 'ahead', 'version'])('rebuilds a %s checkpoint from the event source', async (failure) => {
    const { store, threadId, directory } = await fixture();
    const first = projection(store);
    const expected = await first.read(threadId);
    await first.dispose();
    await store.close();

    const database = new DatabaseSync(path.join(directory, 'threads.sqlite'));
    try {
      if (failure === 'invalid-json') database.exec("UPDATE feature_projection_checkpoints SET state_json = '{'");
      if (failure === 'invalid-state') database.exec("UPDATE feature_projection_checkpoints SET state_json = 'null'");
      if (failure === 'ahead') database.exec('UPDATE feature_projection_checkpoints SET through_seq = 999');
    } finally {
      database.close();
    }
    const reopened = openStore(directory);
    const pages = vi.spyOn(reopened, 'readEventPage');
    const second = projection(reopened, failure === 'version' ? 'fixture:2' : 'fixture:1');
    await expect(second.read(threadId)).resolves.toEqual(expected);
    expect(pages).toHaveBeenCalledWith(threadId, { afterSeq: 0, throughSeq: 22, limit: 5 });
    await second.dispose();

    pages.mockClear();
    const third = projection(reopened, failure === 'version' ? 'fixture:2' : 'fixture:1');
    await expect(third.read(threadId)).resolves.toEqual(expected);
    expect(pages).not.toHaveBeenCalled();
    await third.dispose();
  });

  it('does not save partial replay and removes checkpoints with their thread', async () => {
    const { store, threadId } = await fixture();
    const first = projection(store);
    const expected = await first.read(threadId);
    await first.dispose();
    await store.updateThread(threadId, { title: 'New event' });
    const failed = createFeatureProjectionStore({
      eventReader: new ThreadStoreEventReader(store),
      checkpoint: { key: 'fixture:1', codec: { parse: (value: unknown) => Number(value) } },
      initialState: () => 0,
      reduce: (): number => { throw new Error('Replay failed'); },
    });
    await expect(failed.read(threadId)).rejects.toThrow('Replay failed');
    await expect(store.projectionCheckpoints.read(threadId, 'fixture:1')).resolves.toEqual(expected);
    await failed.dispose();
    await store.deleteThread(threadId);
    await expect(store.projectionCheckpoints.read(threadId, 'fixture:1')).resolves.toBeNull();
    await store.projectionCheckpoints.write(threadId, 'fixture:1', expected);
    await expect(store.projectionCheckpoints.read(threadId, 'fixture:1')).resolves.toBeNull();
    await expect(store.getThreadLastSeq(threadId)).rejects.toThrow('Thread not found');
  });
});
