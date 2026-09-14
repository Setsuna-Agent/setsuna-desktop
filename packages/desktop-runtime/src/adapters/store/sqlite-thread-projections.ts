import type {
  StoredThreadEvent,
  RuntimeMessage,
  RuntimeMessagePage,
  RuntimeMessagePageQuery,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite';
import { normalizeThreadKind, normalizeThreadMemoryMode, toSummary } from './thread-store-state.js';
import { encodeSqliteJson } from './sqlite/json.js';
import { threadCheckpointHeader } from './sqlite/checkpoints.js';

/** Keep a prompt and all of its work together, even after repeated compactions. */
export function threadTranscriptPage(
  messages: RuntimeMessage[],
  query: RuntimeMessagePageQuery,
): RuntimeMessagePage {
  const total = messages.length;
  const before = normalizedMessageBefore(query.before, total);
  const targetStart = Math.max(0, before - normalizedMessageLimit(query.limit));
  const seenTurns = new Set<string>();
  let firstPromptSeen = false;
  let start = 0;
  for (let index = 0; index <= targetStart && index < before; index += 1) {
    const message = messages[index]!;
    if (message.visibility === 'model' || message.contextCompaction) continue;
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const continuesTurn = message.turnId ? seenTurns.has(message.turnId) : false;
    if (message.turnId) seenTurns.add(message.turnId);
    if (message.role !== 'user' || continuesTurn) continue;
    // Initial system/model records belong to the first page, not a separate
    // clickable history page. Later prompts are the only pagination boundaries.
    if (firstPromptSeen) start = index;
    firstPromptSeen = true;
  }
  return {
    messages: messages.slice(start, before),
    nextBefore: start > 0 ? start : null,
    total,
  };
}

export function threadMessagePage(
  messages: RuntimeMessage[],
  query: RuntimeMessagePageQuery,
): RuntimeMessagePage {
  // The cache includes the committed event tail that has not reached the checkpoint yet.
  const total = messages.length;
  const before = normalizedMessageBefore(query.before, total);
  const start = Math.max(0, before - normalizedMessageLimit(query.limit));
  return { messages: structuredClone(messages.slice(start, before)), nextBefore: start > 0 ? start : null, total };
}

export function insertThreadProjection(
  database: DatabaseSync,
  thread: RuntimeThread,
  snapshotSeq: number,
): void {
  const summary = toSummary(thread);
  database.prepare(`
    INSERT INTO threads(
      id, kind, active_turn_id, forked_from_id, parent_thread_id, project_id, title,
      created_at, updated_at, archived, memory_mode, git_info_json, goal_json,
      message_count, last_message_preview, snapshot_json, snapshot_seq, last_seq,
      events_archived_through_seq, message_index_seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    thread.id,
    normalizeThreadKind(summary.kind),
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
    null,
    summary.messageCount,
    summary.lastMessagePreview,
    JSON.stringify(thread),
    snapshotSeq,
    thread.lastSeq,
    thread.lastSeq,
  );
  replaceMessageIndex(database, thread);
}

export function insertRuntimeEvent(database: DatabaseSync, event: StoredThreadEvent): void {
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
    encodeSqliteJson(event),
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
    normalizeThreadKind(summary.kind),
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
    null,
    summary.messageCount,
    summary.lastMessagePreview,
  ] as const;
  const result = snapshotSeq === null
    ? database.prepare(`
        UPDATE threads SET
          kind = ?, active_turn_id = ?, forked_from_id = ?, parent_thread_id = ?, project_id = ?, title = ?,
          created_at = ?, updated_at = ?, archived = ?, memory_mode = ?, git_info_json = ?, goal_json = ?,
          message_count = ?, last_message_preview = ?, last_seq = ?
        WHERE id = ? AND last_seq = ?
      `).run(...common, thread.lastSeq, thread.id, expectedLastSeq)
    : database.prepare(`
        UPDATE threads SET
          kind = ?, active_turn_id = ?, forked_from_id = ?, parent_thread_id = ?, project_id = ?, title = ?,
          created_at = ?, updated_at = ?, archived = ?, memory_mode = ?, git_info_json = ?, goal_json = ?,
          message_count = ?, last_message_preview = ?, snapshot_json = ?, snapshot_seq = ?, last_seq = ?, snapshot_format = 2
        WHERE id = ? AND last_seq = ?
      `).run(...common, threadCheckpointHeader(thread), snapshotSeq, thread.lastSeq, thread.id, expectedLastSeq);
  if (changedRows(result) !== 1) {
    throw new Error(`Concurrent SQLite thread update rejected: ${thread.id}`);
  }
}

export function syncMessageIndex(
  database: DatabaseSync,
  previous: RuntimeThread,
  next: RuntimeThread,
): void {
  const samePrefix = previous.messages.length <= next.messages.length
    && previous.messages.every((message, index) => message.id === next.messages[index]?.id);
  if (!samePrefix) {
    replaceMessageIndex(database, next);
  } else {
    const update = database.prepare(`
      INSERT INTO thread_messages(thread_id, message_index, message_id, created_at, message_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(thread_id, message_index) DO UPDATE
      SET created_at = excluded.created_at, message_json = excluded.message_json
    `);
    for (const [index, message] of next.messages.entries()) {
      // The event reducer preserves unchanged message references, so streamed deltas update one row.
      if (message === previous.messages[index]) continue;
      update.run(
        next.id,
        index,
        message.id,
        message.createdAt,
        JSON.stringify(message),
      );
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

function changedRows(result: StatementResultingChanges): number {
  return typeof result.changes === 'bigint' ? Number(result.changes) : result.changes;
}

function optionalJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}
