import { describe, expect, it } from 'vitest';
import { ensureSqliteThreadSchema } from '../../../src/adapters/store/sqlite-thread-schema.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

describe('SQLite thread schema', () => {
  it('migrates a v1 thread table to the retained-event and message-index schema', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        CREATE TABLE threads (id TEXT PRIMARY KEY);
        CREATE TABLE runtime_events (
          thread_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          event_id TEXT NOT NULL
        );
        PRAGMA user_version = 1;
      `);

      ensureSqliteThreadSchema(database);

      expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 });
      const columns = database.prepare('PRAGMA table_info(threads)').all()
        .map((row) => (row as { name: string }).name);
      expect(columns).toEqual(expect.arrayContaining([
        'events_archived_through_seq',
        'message_index_seq',
      ]));
      expect(database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_messages'
      `).get()).toMatchObject({ name: 'thread_messages' });
      expect(database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_event_archives'
      `).get()).toMatchObject({ name: 'runtime_event_archives' });
      expect(database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_event_ids'
      `).get()).toMatchObject({ name: 'runtime_event_ids' });
    } finally {
      database.close();
    }
  });
});
