import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';

type SqliteRow = Record<string, string | number | bigint | Uint8Array | null>;

const ARCHIVE_BLOCK_EVENT_LIMIT = 512;
const TRANSIENT_EVENT_TYPES = [
  'message.delta',
  'item.delta',
  'reasoning.summary_delta',
  'reasoning.raw_delta',
  'plan.delta',
  'tool.preview',
  'tool.output_delta',
] as const satisfies readonly RuntimeEvent['type'][];

/** Moves checkpointed deltas out of the hot replay table without losing event-source history. */
export function archiveTransientEvents(
  database: DatabaseSync,
  threadId: string,
  lastSeq: number,
  retentionLimit: number,
): void {
  const cutoff = lastSeq - retentionLimit;
  if (cutoff <= 0) return;
  const placeholders = TRANSIENT_EVENT_TYPES.map(() => '?').join(', ');
  let archivedThroughSeq = numberColumn(database.prepare(`
    SELECT events_archived_through_seq FROM threads WHERE id = ?
  `).get(threadId), 'events_archived_through_seq');

  while (archivedThroughSeq < cutoff) {
    const rows = database.prepare(`
      SELECT seq, event_json
      FROM runtime_events
      WHERE thread_id = ? AND seq > ? AND seq <= ? AND type IN (${placeholders})
      ORDER BY seq ASC
      LIMIT ?
    `).all(
      threadId,
      archivedThroughSeq,
      cutoff,
      ...TRANSIENT_EVENT_TYPES,
      ARCHIVE_BLOCK_EVENT_LIMIT,
    );
    if (!rows.length) return;
    const startSeq = numberColumn(rows[0], 'seq');
    const endSeq = numberColumn(rows.at(-1), 'seq');
    const payload = `[${rows.map((row) => stringColumn(row, 'event_json')).join(',')}]`;
    database.prepare(`
      INSERT INTO runtime_event_archives(thread_id, start_seq, end_seq, events_gzip)
      VALUES (?, ?, ?, ?)
    `).run(threadId, startSeq, endSeq, gzipSync(payload));
    database.prepare(`
      DELETE FROM runtime_events
      WHERE thread_id = ? AND seq > ? AND seq <= ? AND type IN (${placeholders})
    `).run(threadId, archivedThroughSeq, endSeq, ...TRANSIENT_EVENT_TYPES);
    database.prepare(`
      UPDATE threads SET events_archived_through_seq = ? WHERE id = ?
    `).run(endSeq, threadId);
    archivedThroughSeq = endSeq;
  }
}

export function readArchivedEvents(
  database: DatabaseSync,
  threadId: string,
  sinceSeq: number,
): RuntimeEvent[] {
  const rows = database.prepare(`
    SELECT start_seq, end_seq, events_gzip
    FROM runtime_event_archives
    WHERE thread_id = ? AND end_seq > ?
    ORDER BY start_seq ASC
  `).all(threadId, sinceSeq);
  return rows.flatMap((row) => {
    const startSeq = numberColumn(row, 'start_seq');
    const endSeq = numberColumn(row, 'end_seq');
    let events: RuntimeEvent[];
    try {
      const parsed = JSON.parse(gunzipSync(blobColumn(row, 'events_gzip')).toString('utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Archive payload is not an array.');
      events = parsed as RuntimeEvent[];
    } catch (error) {
      throw new Error(`Invalid SQLite runtime event archive for ${threadId}:${startSeq}-${endSeq}`, {
        cause: error,
      });
    }
    if (
      !events.length
      || events[0]?.seq !== startSeq
      || events.at(-1)?.seq !== endSeq
      || events.some((event) => event.threadId !== threadId)
    ) {
      throw new Error(`Invalid SQLite runtime event archive range for ${threadId}:${startSeq}-${endSeq}`);
    }
    return events.filter((event) => event.seq > sinceSeq);
  });
}

export function readRawEvents(
  database: DatabaseSync,
  threadId: string,
  sinceSeq: number,
): RuntimeEvent[] {
  const rows = database.prepare(`
    SELECT seq, event_id, event_json
    FROM runtime_events
    WHERE thread_id = ? AND seq > ?
    ORDER BY seq ASC
  `).all(threadId, sinceSeq);
  return rows.map((row) => {
    const seq = numberColumn(row, 'seq');
    let event: RuntimeEvent;
    try {
      event = JSON.parse(stringColumn(row, 'event_json')) as RuntimeEvent;
    } catch (error) {
      throw new Error(`Invalid SQLite runtime event JSON for ${threadId}:${seq}`, { cause: error });
    }
    if (
      !event
      || event.threadId !== threadId
      || event.seq !== seq
      || event.id !== stringColumn(row, 'event_id')
    ) {
      throw new Error(`Invalid SQLite runtime event record for ${threadId}:${seq}`);
    }
    return event;
  });
}

export function readEventArchiveState(
  database: DatabaseSync,
  threadId: string,
): { archivedThroughSeq: number; lastSeq: number } {
  const row = database.prepare(`
    SELECT last_seq, events_archived_through_seq FROM threads WHERE id = ?
  `).get(threadId);
  if (!row) throw new Error(`Thread not found: ${threadId}`);
  return {
    archivedThroughSeq: numberColumn(row, 'events_archived_through_seq'),
    lastSeq: numberColumn(row, 'last_seq'),
  };
}

function blobColumn(row: SqliteRow | undefined, column: string): Uint8Array {
  const value = row?.[column];
  if (!(value instanceof Uint8Array)) throw new Error(`Invalid SQLite blob column: ${column}`);
  return value;
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
