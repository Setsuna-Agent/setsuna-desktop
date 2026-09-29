import { describe, expect, it } from 'vitest';
import { ensureSqliteThreadSchema } from '../../../src/adapters/store/sqlite-thread-schema.js';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

describe('SQLite thread schema', () => {
  it('restores workspace bindings from both v5 checkpoint formats without changing history', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        CREATE TABLE threads (id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, snapshot_format INTEGER NOT NULL);
        PRAGMA user_version = 5;
      `);
      const snapshots = [
        { id: 'legacy', format: 1, snapshot: { workspaceId: 'worktree_legacy', messages: [] } },
        { id: 'partitioned', format: 2, snapshot: { thread: { workspaceId: 'worktree_partitioned' }, messageCount: 85 } },
        { id: 'regular', format: 2, snapshot: { thread: { projectId: 'original' }, messageCount: 1 } },
      ];
      for (const { id, format, snapshot } of snapshots) {
        database.prepare('INSERT INTO threads VALUES (?, ?, ?)').run(id, JSON.stringify(snapshot), format);
      }
      ensureSqliteThreadSchema(database);
      ensureSqliteThreadSchema(database);
      for (const { id, snapshot } of snapshots) {
        expect(database.prepare('SELECT workspace_id, snapshot_json FROM threads WHERE id = ?').get(id))
          .toMatchObject({ workspace_id: id === 'regular' ? null : `worktree_${id}`, snapshot_json: JSON.stringify(snapshot) });
      }
    } finally {
      database.close();
    }
  });

  it('upgrades v3 without rewriting thread history and cascades cached projections on deletion', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE threads (id TEXT PRIMARY KEY, snapshot_json TEXT);
        INSERT INTO threads VALUES ('thread_1', '{"messages":[]}');
        CREATE TABLE runtime_events (thread_id TEXT, turn_id TEXT, seq INTEGER, type TEXT);
        CREATE TABLE runtime_event_ids (
          thread_id TEXT, event_id TEXT, seq INTEGER,
          PRIMARY KEY(thread_id, event_id), UNIQUE(thread_id, seq)
        );
        INSERT INTO runtime_event_ids VALUES ('thread_1', 'event_1', 1);
        PRAGMA user_version = 3;
      `);
      ensureSqliteThreadSchema(database);
      ensureSqliteThreadSchema(database);
      expect(database.prepare('SELECT * FROM threads').get()).toMatchObject({
        id: 'thread_1', snapshot_json: '{"messages":[]}',
      });
      expect(database.prepare('SELECT * FROM runtime_event_ids').get()).toMatchObject({ event_id: 'event_1', seq: 1 });
      database.exec(`
        INSERT INTO feature_projection_checkpoints VALUES ('thread_1', 'goal:1', 0, '{"goal":null}');
        DELETE FROM threads WHERE id = 'thread_1';
      `);
      expect(database.prepare('SELECT * FROM feature_projection_checkpoints').all()).toEqual([]);
      expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 6 });
    } finally {
      database.close();
    }
  });

  it('migrates a v1 thread table through the retained-event and side-thread schemas', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        CREATE TABLE threads (id TEXT PRIMARY KEY, snapshot_json TEXT);
        CREATE TABLE runtime_events (
          thread_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          event_id TEXT NOT NULL,
          type TEXT,
          turn_id TEXT
        );
        PRAGMA user_version = 1;
      `);

      ensureSqliteThreadSchema(database);

      expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 6 });
      const columns = database.prepare('PRAGMA table_info(threads)').all()
        .map((row) => (row as { name: string }).name);
      expect(columns).toEqual(expect.arrayContaining([
        'events_archived_through_seq',
        'kind',
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
      expect(database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'feature_projection_checkpoints'
      `).get()).toMatchObject({ name: 'feature_projection_checkpoints' });
    } finally {
      database.close();
    }
  });
});
