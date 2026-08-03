import type {
  RuntimeEvent,
  RuntimeMessagePage,
  RuntimeMessagePageQuery,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite';
import { normalizeThreadMemoryMode, toSummary } from './thread-store-state.js';

type SqliteRow = Record<string, string | number | bigint | Uint8Array | null>;

export function listIndexedMessages(
  database: DatabaseSync,
  threadId: string,
  query: RuntimeMessagePageQuery,
): RuntimeMessagePage {
  const total = numberColumn(database.prepare(`
    SELECT message_count FROM threads WHERE id = ?
  `).get(threadId), 'message_count');
  const before = normalizedMessageBefore(query.before, total);
  const rows = database.prepare(`
    SELECT message_index, message_json
    FROM thread_messages
    WHERE thread_id = ? AND message_index < ?
    ORDER BY message_index DESC
    LIMIT ?
  `).all(threadId, before, normalizedMessageLimit(query.limit));
  const messages = rows.reverse().map((row) => {
    try {
      return JSON.parse(stringColumn(row, 'message_json')) as RuntimeThread['messages'][number];
    } catch (error) {
      throw new Error(`Invalid SQLite message JSON for ${threadId}`, { cause: error });
    }
  });
  const firstIndex = rows.length ? numberColumn(rows[0], 'message_index') : before;
  return { messages, nextBefore: firstIndex > 0 ? firstIndex : null, total };
}

export function insertThreadProjection(
  database: DatabaseSync,
  thread: RuntimeThread,
  snapshotSeq: number,
): void {
  const summary = toSummary(thread);
  database.prepare(`
    INSERT INTO threads(
      id, active_turn_id, forked_from_id, parent_thread_id, project_id, title,
      created_at, updated_at, archived, memory_mode, git_info_json, goal_json,
      message_count, last_message_preview, snapshot_json, snapshot_seq, last_seq,
      events_archived_through_seq, message_index_seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    thread.id,
    summary.activeTurnId ?? null,
    summary.forkedFromId ?? null,
    summary.parentThreadId ?? null,
    summary.projectId ?? null,
    summary.title,
    summary.createdAt,
    summary.updatedAt,
    summary.archived ? 1 : 0,
    normalizeThreadMemoryMode(summary.memoryMode),
    optionalJson(summary.gitInfo),
    optionalJson(summary.goal),
    summary.messageCount,
    summary.lastMessagePreview,
    JSON.stringify(thread),
    snapshotSeq,
    thread.lastSeq,
    thread.lastSeq,
  );
  replaceMessageIndex(database, thread);
}

export function insertRuntimeEvent(database: DatabaseSync, event: RuntimeEvent): void {
  database.prepare(`
    INSERT INTO runtime_event_ids(thread_id, event_id, seq)
    VALUES (?, ?, ?)
  `).run(event.threadId, event.id, event.seq);
  database.prepare(`
    INSERT INTO runtime_events(thread_id, seq, event_id, type, turn_id, created_at, event_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.threadId,
    event.seq,
    event.id,
    event.type,
    event.turnId ?? null,
    event.createdAt,
    JSON.stringify(event),
  );
}

export function updateThreadProjection(
  database: DatabaseSync,
  thread: RuntimeThread,
  snapshotSeq: number | null,
  expectedLastSeq: number,
): void {
  const summary = toSummary(thread);
  const common = [
    summary.activeTurnId ?? null,
    summary.forkedFromId ?? null,
    summary.parentThreadId ?? null,
    summary.projectId ?? null,
    summary.title,
    summary.createdAt,
    summary.updatedAt,
    summary.archived ? 1 : 0,
    normalizeThreadMemoryMode(summary.memoryMode),
    optionalJson(summary.gitInfo),
    optionalJson(summary.goal),
    summary.messageCount,
    summary.lastMessagePreview,
  ] as const;
  const result = snapshotSeq === null
    ? database.prepare(`
        UPDATE threads SET
          active_turn_id = ?, forked_from_id = ?, parent_thread_id = ?, project_id = ?, title = ?,
          created_at = ?, updated_at = ?, archived = ?, memory_mode = ?, git_info_json = ?, goal_json = ?,
          message_count = ?, last_message_preview = ?, last_seq = ?
        WHERE id = ? AND last_seq = ?
      `).run(...common, thread.lastSeq, thread.id, expectedLastSeq)
    : database.prepare(`
        UPDATE threads SET
          active_turn_id = ?, forked_from_id = ?, parent_thread_id = ?, project_id = ?, title = ?,
          created_at = ?, updated_at = ?, archived = ?, memory_mode = ?, git_info_json = ?, goal_json = ?,
          message_count = ?, last_message_preview = ?, snapshot_json = ?, snapshot_seq = ?, last_seq = ?
        WHERE id = ? AND last_seq = ?
      `).run(...common, JSON.stringify(thread), snapshotSeq, thread.lastSeq, thread.id, expectedLastSeq);
  if (changedRows(result) !== 1) {
    throw new Error(`Concurrent SQLite thread update rejected: ${thread.id}`);
  }
}

export function syncMessageIndex(
  database: DatabaseSync,
  previous: RuntimeThread,
  next: RuntimeThread,
): void {
  const sameOrder = previous.messages.length === next.messages.length
    && previous.messages.every((message, index) => message.id === next.messages[index]?.id);
  const appended = next.messages.length === previous.messages.length + 1
    && previous.messages.every((message, index) => message.id === next.messages[index]?.id);
  if (appended) {
    const message = next.messages.at(-1);
    if (!message) throw new Error(`Unable to index appended message for ${next.id}.`);
    database.prepare(`
      INSERT INTO thread_messages(thread_id, message_index, message_id, created_at, message_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      next.id,
      previous.messages.length,
      message.id,
      message.createdAt,
      JSON.stringify(message),
    );
  } else if (!sameOrder) {
    replaceMessageIndex(database, next);
  } else {
    const update = database.prepare(`
      UPDATE thread_messages
      SET created_at = ?, message_json = ?
      WHERE thread_id = ? AND message_index = ? AND message_id = ?
    `);
    for (const [index, message] of next.messages.entries()) {
      // The event reducer preserves unchanged message references, so streamed deltas update one row.
      if (message === previous.messages[index]) continue;
      const result = update.run(
        message.createdAt,
        JSON.stringify(message),
        next.id,
        index,
        message.id,
      );
      if (changedRows(result) !== 1) {
        replaceMessageIndex(database, next);
        break;
      }
    }
  }
  database.prepare('UPDATE threads SET message_index_seq = ? WHERE id = ?')
    .run(next.lastSeq, next.id);
}

export function replaceMessageIndex(database: DatabaseSync, thread: RuntimeThread): void {
  database.prepare('DELETE FROM thread_messages WHERE thread_id = ?').run(thread.id);
  const insert = database.prepare(`
    INSERT INTO thread_messages(thread_id, message_index, message_id, created_at, message_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  thread.messages.forEach((message, index) => {
    insert.run(thread.id, index, message.id, message.createdAt, JSON.stringify(message));
  });
}

function normalizedMessageLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 100;
  return Math.min(200, Math.max(1, Math.floor(value)));
}

function normalizedMessageBefore(value: number | undefined, total: number): number {
  if (value === undefined || !Number.isFinite(value)) return total;
  return Math.min(total, Math.max(0, Math.floor(value)));
}

function stringColumn(row: SqliteRow | undefined, column: string): string {
  const value = row?.[column];
  if (typeof value !== 'string') throw new Error(`Invalid SQLite text column: ${column}`);
  return value;
}

function numberColumn(row: SqliteRow | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid SQLite number column: ${column}`);
  }
  return value;
}

function changedRows(result: StatementResultingChanges): number {
  return typeof result.changes === 'bigint' ? Number(result.changes) : result.changes;
}

function optionalJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}
