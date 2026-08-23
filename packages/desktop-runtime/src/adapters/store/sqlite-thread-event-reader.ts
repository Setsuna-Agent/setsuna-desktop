import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { ThreadEventPageQuery } from '../../ports/thread-store.js';
import {
  readArchivedEventPage,
  readArchivedEvents,
  readEventArchiveState,
  readRawEventPage,
  readRawEvents,
} from './sqlite-thread-event-archive.js';

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

  // Archive blocks contain transient events while durable events remain in the
  // hot table. At most one page from each source is enough before merging.
  const events = [
    ...readArchivedEventPage(database, threadId, query.afterSeq, query.throughSeq, query.limit),
    ...readRawEventPage(database, threadId, query.afterSeq, query.throughSeq, query.limit),
  ]
    .sort((left, right) => left.seq - right.seq)
    .slice(0, query.limit);
  assertContinuousEvents(events, threadId, query.afterSeq, 'runtime event');
  const expectedEndSeq = Math.min(query.throughSeq, query.afterSeq + query.limit);
  if (events.at(-1)?.seq !== expectedEndSeq) {
    throw new Error(`SQLite runtime event page for ${threadId} did not reach expected seq ${expectedEndSeq}.`);
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
