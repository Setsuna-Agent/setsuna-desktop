import type { RuntimeMessage, RuntimeMessagePage, RuntimeMessagePageQuery, RuntimeThread } from '@setsuna-desktop/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { assertSafeRuntimeId } from '../../../security/runtime-id.js';
import { threadMessagePage, threadMessagePageBounds, threadTranscriptPage } from '../sqlite-thread-projections.js';
import {
  cloneThread, normalizeThreadAfterEventReplay, normalizeThreadSnapshot,
  projectRuntimeThreadSamplingState, projectRuntimeTurnActivity,
} from '../thread-store-state.js';
import { readCheckpointTranscript, readCompleteCheckpointHeader } from './checkpoints.js';
import { decodeSqliteJson } from './json.js';
import { checkpointRecoveryState, isCheckpointRecoveryState } from './recovery-state.js';

/** Read projections share the store's lease and full-thread cache, but never cache partial threads. */
export class SqliteThreadReader {
  constructor(private readonly host: {
    withDatabase<T>(operation: (database: DatabaseSync) => T): Promise<T>;
    cached(threadId: string): RuntimeThread | undefined;
    load(threadId: string): RuntimeThread | null;
    write(operation: () => void): void;
  }) {}

  getThread(threadId: string) {
    return this.read(threadId, () => {
      const thread = this.fullThread(threadId);
      return thread ? cloneThread(thread) : null;
    });
  }

  getSamplingState(threadId: string) {
    return this.read(threadId, (database) => projectRuntimeThreadSamplingState(this.transcript(database, threadId)));
  }

  getActiveTurnIds(threadId: string) {
    return this.read(threadId, (database) => this.recovery(database, threadId).activeTurnIds);
  }

  getGeneratedImageAssetIds(threadId: string) {
    return this.read(threadId, (database) => this.recovery(database, threadId).generatedImageAssetIds);
  }

  getTurnActivity(threadId: string, turnId: string) {
    return this.read(threadId, () => {
      const thread = this.fullThread(threadId);
      return thread ? projectRuntimeTurnActivity(thread, turnId) : null;
    });
  }

  getThreadPage(threadId: string, query: RuntimeMessagePageQuery = {}) {
    return this.read(threadId, () => {
      const thread = this.fullThread(threadId);
      if (!thread) return null;
      const page = threadTranscriptPage(thread.messages, query);
      return cloneThread({ ...thread, messages: page.messages, messagePage: { nextBefore: page.nextBefore, total: page.total } });
    });
  }

  listMessages(threadId: string, query: RuntimeMessagePageQuery = {}): Promise<RuntimeMessagePage> {
    return this.read(threadId, (database) => {
      const cached = this.host.cached(threadId);
      if (cached) return threadMessagePage(cached.messages, query);
      const page = readCheckpointMessagePage(database, threadId, query);
      if (page) return page;
      const thread = this.transcript(database, threadId);
      if (!thread) throw new Error(`Thread not found: ${threadId}`);
      return threadMessagePage(thread.messages, query);
    });
  }

  private async read<T>(threadId: string, operation: (database: DatabaseSync) => T): Promise<T> {
    assertSafeRuntimeId(threadId, 'Thread id');
    return this.host.withDatabase(operation);
  }

  private fullThread(threadId: string) { return this.host.cached(threadId) ?? this.host.load(threadId); }

  private transcript(database: DatabaseSync, threadId: string) {
    return this.host.cached(threadId) ?? readCheckpointTranscript(database, threadId) ?? this.host.load(threadId);
  }

  private recovery(database: DatabaseSync, threadId: string) {
    const cached = this.host.cached(threadId);
    if (cached) return checkpointRecoveryState(cached);
    const checkpoint = readCompleteCheckpointHeader(database, threadId);
    if (isCheckpointRecoveryState(checkpoint?.recovery)) return checkpoint.recovery;
    const thread = this.transcript(database, threadId);
    const recovery = checkpointRecoveryState(thread);
    if (thread) this.host.write(() => {
      // Backfill only this derived summary. Preserve legacy message rows and never advance a stale checkpoint.
      database.prepare(`
        UPDATE threads SET snapshot_json = json_set(snapshot_json, '$.recovery', json(?))
        WHERE id = ? AND snapshot_format = 2 AND snapshot_seq = ? AND last_seq = ?
      `).run(JSON.stringify(recovery), threadId, thread.lastSeq, thread.lastSeq);
    });
    return recovery;
  }
}

function readCheckpointMessagePage(database: DatabaseSync, threadId: string, query: RuntimeMessagePageQuery): RuntimeMessagePage | null {
  const checkpoint = readCompleteCheckpointHeader(database, threadId);
  if (!checkpoint) return null;
  const total = checkpoint.messageCount;
  const { before, start } = threadMessagePageBounds(total, query);
  const messages = database.prepare(`
    SELECT message_json FROM thread_messages
    WHERE thread_id = ? AND message_index >= ? AND message_index < ? ORDER BY message_index
  `).all(threadId, start, before).map((row) => decodeSqliteJson<RuntimeMessage>(row.message_json));
  if (messages.length !== before - start) throw new Error(`Incomplete SQLite message checkpoint: ${threadId}`);
  // Legacy phase inference may need messages outside this page; rejected tools may belong
  // to a cancelled turn. Use the complete transcript for those migrations, never infer locally.
  const pageThread = { ...checkpoint.thread, messages, turns: [] };
  if (messages.some((message) => message.toolRuns?.some((run) => run.status === 'rejected'))
    || normalizeThreadSnapshot(pageThread).changed || normalizeThreadAfterEventReplay(pageThread).changed) return null;
  return { messages, nextBefore: start > 0 ? start : null, total };
}
