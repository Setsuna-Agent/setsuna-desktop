import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { ThreadEventFilter, ThreadEventPageQuery } from '../../ports/thread-store.js';
import { decodeSqliteJson, encodeSqliteJson } from './sqlite/json.js';
import {
  readArchivedEventPage,
  readArchivedEvents,
  readEventArchiveState,
  readRawEventPage,
  readRawEvents,
  rawEventFromRow,
  TRANSIENT_EVENT_TYPES,
} from './sqlite-thread-event-archive.js';

export function readFilteredThreadEvents(
  database: DatabaseSync,
  threadId: string,
  sinceSeq: number,
  filter: ThreadEventFilter,
): StoredThreadEvent[] {
  if (!filter.types.length) return [];
  const placeholders = filter.types.map(() => '?').join(',');
  const rows = database.prepare(`
    SELECT seq, event_id, event_json FROM runtime_events
    WHERE thread_id = ? AND seq > ? AND type IN (${placeholders}) ${filter.turnId ? 'AND turn_id = ?' : ''}
    ORDER BY seq
  `).all(threadId, sinceSeq, ...filter.types, ...(filter.turnId ? [filter.turnId] : []));
  const events = rows.map((row) => rawEventFromRow(row, threadId));
  if (!filter.types.some((type) => (TRANSIENT_EVENT_TYPES as readonly string[]).includes(type))) return events;
  return [...events, ...readArchivedEvents(database, threadId, sinceSeq).filter((event) => (
    filter.types.includes(event.type) && (!filter.turnId || event.turnId === filter.turnId)
  ))].sort((left, right) => left.seq - right.seq);
}

/** Upgrade large legacy records once when their thread first adopts partitioned checkpoints. */
export function compressLegacyThreadEvents(database: DatabaseSync, threadId: string): void {
  const read = database.prepare(`
    SELECT seq, event_json FROM runtime_events
    WHERE thread_id = ? AND seq > ? AND typeof(event_json) = 'text' AND length(event_json) >= 4096
    ORDER BY seq LIMIT 128
  `);
  const update = database.prepare('UPDATE runtime_events SET event_json = ? WHERE thread_id = ? AND seq = ?');
  let afterSeq = 0;
  for (;;) {
    const rows = read.all(threadId, afterSeq);
    if (!rows.length) return;
    for (const row of rows) {
      afterSeq = Number(row.seq);
      const encoded = encodeSqliteJson(decodeSqliteJson(row.event_json));
      if (encoded instanceof Uint8Array) update.run(encoded, threadId, afterSeq);
    }
  }
}

export function readAllThreadEvents(
  database: DatabaseSync,
  threadId: string,
  sinceSeq: number,
): StoredThreadEvent[] {
  const { lastSeq } = readEventArchiveState(database, threadId);
  const events = [
    ...readArchivedEvents(database, threadId, sinceSeq),
    ...readRawEvents(database, threadId, sinceSeq),
  ].sort((left, right) => left.seq - right.seq);
  assertContinuousEvents(events, threadId, sinceSeq, 'runtime event');
  if (sinceSeq < lastSeq && events.at(-1)?.seq !== lastSeq) {
    throw new Error(`SQLite runtime event tail does not reach last_seq for ${threadId}.`);
  }
  return events;
}

export function readThreadEventPage(
  database: DatabaseSync,
  threadId: string,
  input: ThreadEventPageQuery,
): StoredThreadEvent[] {
  const query = normalizeEventPageQuery(input);
  const { lastSeq } = readEventArchiveState(database, threadId);
  if (query.throughSeq > lastSeq) {
    throw new Error(
      `SQLite runtime event page for ${threadId} exceeds last_seq ${lastSeq}: ${query.throughSeq}`,
    );
  }
  if (query.afterSeq === query.throughSeq) return [];

  // Sequences are contiguous across both sources, so a page cannot extend beyond
  // afterSeq + limit. Bound both reads before decompressing unrelated archive blocks.
  const pageThroughSeq = Math.min(query.throughSeq, query.afterSeq + query.limit);
  const events = [
    ...readArchivedEventPage(database, threadId, query.afterSeq, pageThroughSeq, query.limit),
    ...readRawEventPage(database, threadId, query.afterSeq, pageThroughSeq, query.limit),
  ]
    .sort((left, right) => left.seq - right.seq)
    .slice(0, query.limit);
  assertContinuousEvents(events, threadId, query.afterSeq, 'runtime event');
  if (events.at(-1)?.seq !== pageThroughSeq) {
    throw new Error(`SQLite runtime event page for ${threadId} did not reach expected seq ${pageThroughSeq}.`);
  }
  return events;
}

export function readHotThreadEvents(
  database: DatabaseSync,
  threadId: string,
  sinceSeq: number,
): StoredThreadEvent[] {
  const { lastSeq } = readEventArchiveState(database, threadId);
  const events = readRawEvents(database, threadId, sinceSeq);
  assertContinuousEvents(events, threadId, sinceSeq, 'hot runtime event');
  if (sinceSeq < lastSeq && events.at(-1)?.seq !== lastSeq) {
    throw new Error(`SQLite hot runtime event tail does not reach last_seq for ${threadId}.`);
  }
  return events;
}

function assertContinuousEvents(
  events: readonly StoredThreadEvent[],
  threadId: string,
  sinceSeq: number,
  label: string,
): void {
  let expectedSeq = sinceSeq + 1;
  for (const event of events) {
    if (event.seq !== expectedSeq) {
      throw new Error(`Invalid SQLite ${label} sequence for ${threadId}: expected ${expectedSeq}, got ${event.seq}`);
    }
    expectedSeq += 1;
  }
}

function normalizeEventPageQuery(input: ThreadEventPageQuery): ThreadEventPageQuery {
  const afterSeq = normalizedEventSequence(input.afterSeq, 'afterSeq');
  const throughSeq = normalizedEventSequence(input.throughSeq, 'throughSeq');
  if (throughSeq < afterSeq) throw new Error('Event page throughSeq must not precede afterSeq.');
  const limit = Math.floor(input.limit);
  if (!Number.isFinite(input.limit) || limit < 1) {
    throw new Error('Event page limit must be a positive finite number.');
  }
  return Object.freeze({ afterSeq, throughSeq, limit });
}

function normalizedEventSequence(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`Event page ${label} must be finite.`);
  return Math.max(0, Math.floor(value));
}
