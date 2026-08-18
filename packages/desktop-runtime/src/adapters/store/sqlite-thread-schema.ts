import type { DatabaseSync } from 'node:sqlite';

export const SQLITE_THREAD_SCHEMA_VERSION = 3;

export function ensureSqliteThreadSchema(database: DatabaseSync): void {
  let version = schemaVersion(database);
  if (version > SQLITE_THREAD_SCHEMA_VERSION) {
    throw new Error(
      `SQLite thread store schema ${version} is newer than supported schema ${SQLITE_THREAD_SCHEMA_VERSION}.`,
    );
  }
  if (version === SQLITE_THREAD_SCHEMA_VERSION) return;
  if (version === 1) {
    withTransaction(database, () => database.exec(`
      ALTER TABLE threads
      ADD COLUMN events_archived_through_seq INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE threads
      ADD COLUMN message_index_seq INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE thread_messages (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        message_index INTEGER NOT NULL CHECK (message_index >= 0),
        message_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        message_json TEXT NOT NULL,
        PRIMARY KEY (thread_id, message_index),
        UNIQUE (thread_id, message_id)
      ) WITHOUT ROWID;

      CREATE INDEX thread_messages_created_idx
      ON thread_messages(thread_id, created_at, message_index);

      CREATE TABLE runtime_event_ids (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        PRIMARY KEY (thread_id, event_id),
        UNIQUE (thread_id, seq)
      ) WITHOUT ROWID;

      INSERT INTO runtime_event_ids(thread_id, event_id, seq)
      SELECT thread_id, event_id, seq FROM runtime_events;

      CREATE TABLE runtime_event_archives (
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        start_seq INTEGER NOT NULL CHECK (start_seq > 0),
        end_seq INTEGER NOT NULL CHECK (end_seq >= start_seq),
        events_gzip BLOB NOT NULL,
        PRIMARY KEY (thread_id, start_seq),
        UNIQUE (thread_id, end_seq)
      ) WITHOUT ROWID;
      PRAGMA user_version = 2;
    `));
    version = 2;
  }
  if (version === 2) {
    withTransaction(database, () => database.exec(`
      ALTER TABLE threads
      ADD COLUMN kind TEXT NOT NULL DEFAULT 'regular'
        CHECK (kind IN ('regular', 'side'));
      PRAGMA user_version = 3;
    `));
    return;
  }
  if (version !== 0) throw new Error(`Unsupported SQLite thread store schema: ${version}`);

  withTransaction(database, () => database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'side')),
      active_turn_id TEXT,
      forked_from_id TEXT,
      parent_thread_id TEXT,
      project_id TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
      memory_mode TEXT NOT NULL CHECK (memory_mode IN ('enabled', 'disabled', 'polluted')),
      git_info_json TEXT,
      goal_json TEXT,
      message_count INTEGER NOT NULL,
      last_message_preview TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      snapshot_seq INTEGER NOT NULL CHECK (snapshot_seq >= 0),
      last_seq INTEGER NOT NULL CHECK (last_seq >= snapshot_seq),
      events_archived_through_seq INTEGER NOT NULL DEFAULT 0,
      message_index_seq INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE runtime_events (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL CHECK (seq > 0),
      event_id TEXT NOT NULL,
      type TEXT NOT NULL,
      turn_id TEXT,
      created_at TEXT NOT NULL,
      event_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, seq),
      UNIQUE (thread_id, event_id)
    ) WITHOUT ROWID;

    CREATE INDEX runtime_events_turn_idx ON runtime_events(thread_id, turn_id, seq);
    CREATE INDEX threads_updated_idx ON threads(updated_at DESC);
    CREATE INDEX threads_project_idx ON threads(project_id, archived, updated_at DESC);

    CREATE TABLE runtime_event_ids (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (thread_id, event_id),
      UNIQUE (thread_id, seq)
    ) WITHOUT ROWID;

    CREATE TABLE runtime_event_archives (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      start_seq INTEGER NOT NULL CHECK (start_seq > 0),
      end_seq INTEGER NOT NULL CHECK (end_seq >= start_seq),
      events_gzip BLOB NOT NULL,
      PRIMARY KEY (thread_id, start_seq),
      UNIQUE (thread_id, end_seq)
    ) WITHOUT ROWID;

    CREATE TABLE thread_messages (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      message_index INTEGER NOT NULL CHECK (message_index >= 0),
      message_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      message_json TEXT NOT NULL,
      PRIMARY KEY (thread_id, message_index),
      UNIQUE (thread_id, message_id)
    ) WITHOUT ROWID;

    CREATE INDEX thread_messages_created_idx
    ON thread_messages(thread_id, created_at, message_index);

    CREATE TABLE store_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) WITHOUT ROWID;

    CREATE TABLE runtime_owner (
      slot INTEGER PRIMARY KEY CHECK (slot = 1),
      owner_id TEXT NOT NULL,
      fence_token INTEGER NOT NULL CHECK (fence_token > 0),
      lease_expires_at INTEGER NOT NULL
    );

    PRAGMA user_version = 3;
  `));
}

function schemaVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined;
  const value = row?.user_version;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Invalid SQLite user_version.');
  }
  return value;
}

function withTransaction(database: DatabaseSync, operation: () => void): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    operation();
    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the schema migration failure.
    }
    throw error;
  }
}
