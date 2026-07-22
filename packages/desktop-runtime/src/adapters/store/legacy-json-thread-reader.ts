import type { RuntimeEvent, RuntimeThread } from '@setsuna-desktop/contracts';
import { applyRuntimeEventToThread } from '@setsuna-desktop/contracts';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeRuntimeId, resolveRuntimeStoragePath } from '../../security/runtime-id.js';
import {
  assertThreadSnapshot,
  hydrateMessageCompletionTimesFromEvents,
  normalizeThreadSnapshot,
} from './thread-store-state.js';

export type LegacyJsonThreadRecord = {
  duplicateSequenceRecoveries: LegacyJsonDuplicateSequenceRecovery[];
  events: RuntimeEvent[];
  thread: RuntimeThread;
};

export type LegacyJsonDuplicateSequenceRecovery = {
  discardedEventId: string;
  discardedLine: number;
  keptEventId: string;
  keptLine: number;
  seq: number;
};

type LegacyJsonEventLog = {
  duplicateSequenceRecoveries: LegacyJsonDuplicateSequenceRecovery[];
  events: RuntimeEvent[];
};

/** Reads the legacy snapshot/JSONL store without mutating it. */
export async function readLegacyJsonThreads(dataDir: string): Promise<LegacyJsonThreadRecord[]> {
  const threadsDir = path.join(dataDir, 'threads');
  let entries;
  try {
    entries = await readdir(threadsDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }

  const snapshotIds = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json')
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort();
  const snapshotIdSet = new Set(snapshotIds);
  const eventLogIds = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name.slice(0, -'.jsonl'.length));

  for (const threadId of eventLogIds) {
    assertSafeRuntimeId(threadId, 'Thread id');
    if (!snapshotIdSet.has(threadId)) {
      throw new Error(`Thread event log has no seed snapshot: ${threadId}`);
    }
  }

  const records: LegacyJsonThreadRecord[] = [];
  for (const threadId of snapshotIds) {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    const snapshotPath = resolveRuntimeStoragePath(threadsDir, `${safeThreadId}.json`);
    const eventsPath = resolveRuntimeStoragePath(threadsDir, `${safeThreadId}.jsonl`);
    const snapshot = await readLegacySnapshot(snapshotPath, safeThreadId);
    const eventLog = await readLegacyEventLog(eventsPath, safeThreadId);
    const { events } = eventLog;
    const highestSeq = events.at(-1)?.seq ?? 0;
    if (snapshot.lastSeq > highestSeq) {
      throw new Error(`Thread snapshot is ahead of its event log: ${safeThreadId}`);
    }
    if (eventLog.duplicateSequenceRecoveries.length) {
      const unresolved = eventLog.duplicateSequenceRecoveries.find((recovery) => recovery.seq >= highestSeq);
      if (unresolved || snapshot.lastSeq !== highestSeq) {
        const recovery = unresolved ?? eventLog.duplicateSequenceRecoveries[0];
        throw new Error(
          `Invalid runtime event sequence at ${eventsPath}:${recovery.keptLine}; `
          + 'duplicate sequence has no later persisted checkpoint proving the last writer won.',
        );
      }
    }

    let thread = normalizeThreadSnapshot(snapshot).thread;
    for (const event of events) {
      if (event.seq > thread.lastSeq) thread = applyRuntimeEventToThread(thread, event);
    }
    thread = hydrateMessageCompletionTimesFromEvents(thread, events);
    records.push({
      duplicateSequenceRecoveries: eventLog.duplicateSequenceRecoveries,
      events,
      thread,
    });
  }
  return records;
}

async function readLegacySnapshot(filePath: string, threadId: string): Promise<RuntimeThread> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read thread snapshot: ${threadId}`, { cause: error });
  }
  let snapshot: RuntimeThread;
  try {
    snapshot = JSON.parse(text) as RuntimeThread;
  } catch (error) {
    throw new Error(`Invalid thread snapshot JSON: ${filePath}`, { cause: error });
  }
  assertThreadSnapshot(snapshot, threadId);
  return snapshot;
}

async function readLegacyEventLog(filePath: string, threadId: string): Promise<LegacyJsonEventLog> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return { duplicateSequenceRecoveries: [], events: [] };
    }
    throw error;
  }

  const lines = text.split('\n');
  const events: RuntimeEvent[] = [];
  const eventLines: number[] = [];
  const eventIds = new Set<string>();
  const duplicateSequenceRecoveries: LegacyJsonDuplicateSequenceRecovery[] = [];
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: RuntimeEvent;
    try {
      event = JSON.parse(trimmed) as RuntimeEvent;
    } catch (error) {
      if (index === lines.length - 1 && !text.endsWith('\n')) break;
      throw new Error(`Invalid runtime event JSON at ${filePath}:${index + 1}`, { cause: error });
    }
    if (
      !event
      || event.threadId !== threadId
      || !Number.isInteger(event.seq)
      || event.seq < 1
      || !event.id
      || eventIds.has(event.id)
    ) {
      throw new Error(`Invalid runtime event sequence at ${filePath}:${index + 1}`);
    }
    eventIds.add(event.id);
    const expectedSeq = events.length + 1;
    if (event.seq === expectedSeq) {
      events.push(event);
      eventLines.push(index + 1);
      continue;
    }
    if (events.length && event.seq === expectedSeq - 1) {
      const replacedIndex = events.length - 1;
      const replaced = events[replacedIndex];
      duplicateSequenceRecoveries.push({
        discardedEventId: replaced.id,
        discardedLine: eventLines[replacedIndex],
        keptEventId: event.id,
        keptLine: index + 1,
        seq: event.seq,
      });
      // A later checkpoint can prove which cross-process writer continued. Keep the latest
      // candidate for now; the caller rejects this recovery unless that proof exists.
      events[replacedIndex] = event;
      eventLines[replacedIndex] = index + 1;
      continue;
    }
    throw new Error(`Invalid runtime event sequence at ${filePath}:${index + 1}`);
  }
  return { duplicateSequenceRecoveries, events };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
