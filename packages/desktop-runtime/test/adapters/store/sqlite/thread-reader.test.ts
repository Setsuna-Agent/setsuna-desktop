import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RandomIdGenerator } from '../../../../src/adapters/id/random-id-generator.js';
import { SqliteThreadStore } from '../../../../src/adapters/store/sqlite-thread-store.js';
import { systemClock } from '../../../../src/ports/clock.js';

const directories: string[] = [];
const stores: SqliteThreadStore[] = [];
const createdAt = '2026-10-05T00:00:00.000Z';
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function directory() {
  const value = await mkdtemp(path.join(tmpdir(), 'sqlite-thread-reader-'));
  directories.push(value);
  return value;
}

function open(directory: string) {
  const store = new SqliteThreadStore(directory, systemClock, new RandomIdGenerator());
  stores.push(store);
  return store;
}

async function append(store: SqliteThreadStore, threadId: string, message: Partial<RuntimeMessage> & Pick<RuntimeMessage, 'id' | 'role' | 'content'>) {
  await store.appendEvent(threadId, {
    id: `event_${message.id}`, threadId, type: 'message.created', createdAt,
    payload: { message: { createdAt, status: 'complete', ...message } },
  });
}

describe('SQLite checkpoint read projections', () => {
  it.each([false, true])('persists recovery references across reopen and removes deleted references (backfill=%s)', async (backfill) => {
    const dir = await directory();
    const first = open(dir);
    const thread = await first.createThread();
    await append(first, thread.id, {
      id: 'stream', role: 'assistant', turnId: 'orphan_turn', content: '', status: 'streaming',
      attachments: [
        { id: 'generated', source: 'generated', assetId: 'asset_generated', name: 'image.png', type: 'image/png', size: 68, modelVisible: false },
        { id: 'legacy', localAssetId: 'asset_legacy', url: 'data:image/png;base64,legacy', name: 'legacy.png', type: 'image/png', size: 68 },
      ],
    });
    await first.close();
    if (backfill) {
      const database = new DatabaseSync(first.databasePath);
      database.exec("UPDATE threads SET snapshot_json = json_remove(snapshot_json, '$.recovery')");
      database.close();
      const upgrade = open(dir);
      expect(await upgrade.getGeneratedImageAssetIds(thread.id)).toEqual(['asset_generated', 'asset_legacy']);
      await upgrade.close();
    }

    const reopened = open(dir);
    await reopened.recover();
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
    expect(await reopened.getActiveTurnIds(thread.id)).toEqual(['orphan_turn']);
    const assets = await reopened.getGeneratedImageAssetIds(thread.id);
    expect(assets).toEqual(['asset_generated', 'asset_legacy']);
    // A warm recovery must not decode message, turn or event payloads, regardless of history size.
    expect(prepare.mock.calls.some(([sql]) => /\b(thread_messages|thread_turn_checkpoints|runtime_events)\b/u.test(sql))).toBe(false);
    prepare.mockRestore();
    assets.length = 0;
    expect(await reopened.getGeneratedImageAssetIds(thread.id)).toHaveLength(2);

    await reopened.deleteMessages(thread.id, { messageIds: ['stream'] });
    await reopened.close();
    const cleared = open(dir);
    expect(await cleared.getActiveTurnIds(thread.id)).toEqual([]);
    expect(await cleared.getGeneratedImageAssetIds(thread.id)).toEqual([]);
  });

  it('reads only the requested message rows without decoding an unrelated damaged body', async () => {
    const dir = await directory();
    const first = open(dir);
    const thread = await first.createThread();
    await append(first, thread.id, { id: 'seed', role: 'developer', visibility: 'model', content: 'Private setup seed' });
    await append(first, thread.id, { id: 'prompt', role: 'user', content: 'First prompt' });
    await append(first, thread.id, { id: 'later', role: 'user', content: 'Later body' });
    await first.close();
    const database = new DatabaseSync(first.databasePath);
    database.prepare("UPDATE thread_messages SET message_json = 'invalid json' WHERE message_id = 'later'").run();
    database.close();

    const reopened = open(dir);
    expect(await reopened.listMessages(thread.id, { before: 2, limit: 2 })).toMatchObject({
      messages: [{ id: 'seed', content: 'Private setup seed' }, { id: 'prompt', content: 'First prompt' }],
      nextBefore: null, total: 3,
    });
    await expect(reopened.listMessages(thread.id, { limit: 1 })).rejects.toThrow();
  });

  it('uses the complete transcript when legacy phase inference crosses a page boundary', async () => {
    const dir = await directory();
    const first = open(dir);
    const thread = await first.createThread();
    await append(first, thread.id, { id: 'prompt', role: 'user', content: 'Question' });
    await append(first, thread.id, { id: 'progress', role: 'assistant', content: 'Still working' });
    await append(first, thread.id, { id: 'answer', role: 'assistant', content: 'Final answer' });
    await first.close();
    const reopened = open(dir);
    expect((await reopened.listMessages(thread.id, { before: 2, limit: 1 })).messages)
      .toMatchObject([{ id: 'progress', phase: 'commentary' }]);
    expect((await reopened.listMessages(thread.id, { limit: 1 })).messages)
      .toMatchObject([{ id: 'answer', phase: 'final_answer' }]);
  });
});
