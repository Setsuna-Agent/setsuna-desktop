import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RuntimeEvent,
  RuntimeMessagePage,
  RuntimeMessagePageQuery,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadSummary,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import { applyRuntimeEventToThread, DEFAULT_THREAD_TITLE } from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync, StatementResultingChanges } from 'node:sqlite';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { assertSafeRuntimeId } from '../../security/runtime-id.js';
import { readLegacyJsonThreads } from './legacy-json-thread-reader.js';
import {
  archiveTransientEvents,
  readArchivedEvents,
  readEventArchiveState,
  readRawEvents,
} from './sqlite-thread-event-archive.js';
import {
  insertRuntimeEvent,
  insertThreadProjection,
  listIndexedMessages,
  replaceMessageIndex,
  syncMessageIndex,
  updateThreadProjection,
} from './sqlite-thread-projections.js';
import { ensureSqliteThreadSchema } from './sqlite-thread-schema.js';
import {
  assertThreadSnapshot,
  cloneThread,
  eventCanUseDelayedCheckpoint,
  hydrateMessageCompletionTimesFromEvents,
  normalizeThreadMemoryMode,
  normalizeThreadSnapshot,
  normalizeThreadSummary,
  optionalSafeRuntimeId,
  threadHasAncestor,
  toSummary,
} from './thread-store-state.js';
import {
  normalizedThreadSearch,
  threadSearchResult,
} from './thread-search.js';
import { searchSqliteThreadMessagePreviews } from './sqlite-thread-search.js';

const DEFAULT_CHECKPOINT_DELAY_MS = 250;
const DEFAULT_EVENT_RETENTION_LIMIT = 4_096;
const DEFAULT_LEASE_TTL_MS = 15_000;
const DEFAULT_LEASE_HEARTBEAT_MS = 5_000;
const DEFAULT_OWNERSHIP_WAIT_MS = 20_000;
const LEGACY_IMPORT_KEY = 'legacy_json_import';
type SqliteThreadStoreOptions = {
  checkpointDelayMs?: number;
  eventRetentionLimit?: number;
  leaseHeartbeatMs?: number;
  leaseTtlMs?: number;
  ownershipWaitMs?: number;
  ownerId?: string;
};

type SqliteThreadRow = Record<string, string | number | bigint | Uint8Array | null>;

export class RuntimeStorageInUseError extends Error {
  readonly code = 'runtime_storage_in_use';

  constructor(databasePath: string, readonly leaseExpiresAt: number) {
    super(`Runtime storage is already owned by another process until ${new Date(leaseExpiresAt).toISOString()}: ${databasePath}`);
    this.name = 'RuntimeStorageInUseError';
  }
}

/**
 * SQLite-backed event store. Exact events remain the source of truth; old transient
 * deltas move to compressed archives while snapshots bound the hot replay path.
 * A fenced runtime lease prevents a second process from projecting or executing the same thread concurrently.
 */
export class SqliteThreadStore implements ThreadStore {
  readonly databasePath: string;

  private readonly ownerId: string;
  private readonly checkpointDelayMs: number;
  private readonly eventRetentionLimit: number;
  private readonly leaseHeartbeatMs: number;
  private readonly leaseTtlMs: number;
  private readonly ownershipWaitMs: number;
  private readonly threadWriteQueues = new Map<string, Promise<void>>();
  private readonly threadCache = new Map<string, RuntimeThread>();
  private readonly checkpointTimers = new Map<string, NodeJS.Timeout>();
  private readonly checkpointTasks = new Set<Promise<void>>();

  private database: DatabaseSync | null = null;
  private readyPromise: Promise<void> | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  private fenceToken: number | null = null;
  private checkpointFailure: Error | null = null;
  private ownershipFailure: Error | null = null;
  private closed = false;

  constructor(
    private readonly dataDir: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    options: SqliteThreadStoreOptions = {},
  ) {
    this.databasePath = path.join(dataDir, 'threads.sqlite');
    this.ownerId = options.ownerId ?? randomUUID();
    this.checkpointDelayMs = Math.max(0, options.checkpointDelayMs ?? DEFAULT_CHECKPOINT_DELAY_MS);
    this.eventRetentionLimit = Math.max(
      1,
      Math.floor(options.eventRetentionLimit ?? DEFAULT_EVENT_RETENTION_LIMIT),
    );
    this.leaseTtlMs = Math.max(1_000, options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS);
    this.leaseHeartbeatMs = Math.max(
      250,
      Math.min(options.leaseHeartbeatMs ?? DEFAULT_LEASE_HEARTBEAT_MS, Math.floor(this.leaseTtlMs / 2)),
    );
    this.ownershipWaitMs = Math.max(0, options.ownershipWaitMs ?? DEFAULT_OWNERSHIP_WAIT_MS);
  }

  async recover(): Promise<void> {
    if (this.closed) throw new Error('SQLite thread store is closed.');
    this.readyPromise ??= this.initialize();
    await this.readyPromise;
  }

  async flush(): Promise<void> {
    await this.ensureReady();
    await this.flushCheckpoints();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.stopLeaseHeartbeat();
    let failure: Error | null = null;
    try {
      if (this.readyPromise) {
        await this.readyPromise;
        await this.flushCheckpoints();
      }
    } catch (error) {
      failure = toError(error);
    } finally {
      // initialize() may have acquired the lease while close() was awaiting readyPromise.
      this.stopLeaseHeartbeat();
      this.releaseOwnership();
      try {
        this.database?.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (error) {
        failure ??= toError(error);
      }
      try {
        this.database?.close();
      } catch (error) {
        failure ??= toError(error);
      }
      this.database = null;
      this.threadCache.clear();
      this.closed = true;
    }
    if (failure) throw failure;
  }

  async listThreads(query: ThreadQuery = {}): Promise<RuntimeThreadSummary[]> {
    await this.ensureReady();
    this.assertOwnership();
    const rows = this.requireDatabase().prepare(`
      SELECT id, active_turn_id, forked_from_id, parent_thread_id, project_id, title,
             created_at, updated_at, archived, memory_mode, git_info_json, goal_json,
             message_count, last_message_preview
      FROM threads
    `).all();
    const summaries = rows.map((row) => normalizeThreadSummary(summaryFromRow(row)));
    const search = normalizedThreadSearch(query.search);
    const messagePreviews = search
      ? searchSqliteThreadMessagePreviews(this.requireDatabase(), search)
      : new Map<string, string>();
    const parentMap = new Map(summaries.map((thread) => [thread.id, thread.parentThreadId]));
    return summaries
      .filter((thread) => query.includeArchived || !thread.archived)
      .filter((thread) => !query.parentThreadId || thread.parentThreadId === query.parentThreadId)
      .filter((thread) => !query.ancestorThreadId || threadHasAncestor(thread.id, query.ancestorThreadId, parentMap))
      .filter((thread) => {
        if (query.projectId) return thread.projectId === query.projectId;
        if (query.scope === 'global') return !thread.projectId;
        if (query.scope === 'project') return Boolean(thread.projectId);
        return true;
      })
      .flatMap((thread) => threadSearchResult(thread, search, messagePreviews.get(thread.id)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getThread(threadId: string): Promise<RuntimeThread | null> {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    await this.ensureReady();
    this.assertOwnership();
    const cached = this.threadCache.get(safeThreadId);
    if (cached) return cloneThread(cached);
    const loaded = this.loadThread(safeThreadId);
    return loaded ? cloneThread(loaded) : null;
  }

  async listMessages(
    threadId: string,
    query: RuntimeMessagePageQuery = {},
  ): Promise<RuntimeMessagePage> {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    await this.ensureReady();
    this.assertOwnership();
    // Loading once also repairs a v1 database whose message index has not been backfilled yet.
    if (!this.threadCache.get(safeThreadId) && !this.loadThread(safeThreadId)) {
      throw new Error(`Thread not found: ${safeThreadId}`);
    }
    return listIndexedMessages(this.requireDatabase(), safeThreadId, query);
  }

  async getThreadPage(
    threadId: string,
    query: RuntimeMessagePageQuery = {},
  ): Promise<RuntimeThread | null> {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    await this.ensureReady();
    this.assertOwnership();
    const thread = this.threadCache.get(safeThreadId) ?? this.loadThread(safeThreadId);
    if (!thread) return null;
    const page = listIndexedMessages(this.requireDatabase(), safeThreadId, query);
    // Overwrite the full message array before cloning so REST pagination also bounds clone cost.
    return cloneThread({
      ...thread,
      messages: page.messages,
      messagePage: { nextBefore: page.nextBefore, total: page.total },
    });
  }

  async createThread(input: CreateThreadInput = {}): Promise<RuntimeThread> {
    await this.ensureReady();
    const now = this.clock.now().toISOString();
    const threadId = assertSafeRuntimeId(this.ids.id('thread'), 'Thread id');
    const initial: RuntimeThread = {
      id: threadId,
      forkedFromId: optionalSafeRuntimeId(input.forkedFromId, 'Forked thread id'),
      parentThreadId: optionalSafeRuntimeId(input.parentThreadId, 'Parent thread id'),
      projectId: input.projectId?.trim() || undefined,
      title: input.title?.trim() || DEFAULT_THREAD_TITLE,
      createdAt: now,
      updatedAt: now,
      archived: false,
      memoryMode: normalizeThreadMemoryMode(input.memoryMode),
      messageCount: 0,
      lastMessagePreview: '',
      messages: [],
      lastSeq: 0,
    };
    const event = {
      id: this.ids.id('event'),
      threadId,
      type: 'thread.created',
      createdAt: now,
      payload: { title: initial.title },
      seq: 1,
    } satisfies RuntimeEvent;
    const thread = applyRuntimeEventToThread(initial, event);

    this.withWriteTransaction(() => {
      insertThreadProjection(this.requireDatabase(), thread, thread.lastSeq);
      insertRuntimeEvent(this.requireDatabase(), event);
    });
    this.threadCache.set(threadId, thread);
    return cloneThread(thread);
  }

  async deleteThread(threadId: string): Promise<void> {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    await this.ensureReady();
    return this.enqueueThreadWrite(safeThreadId, async () => {
      this.cancelCheckpoint(safeThreadId);
      if (!await this.getThread(safeThreadId)) throw new Error(`Thread not found: ${safeThreadId}`);
      this.withWriteTransaction(() => {
        const result = this.requireDatabase().prepare('DELETE FROM threads WHERE id = ?').run(safeThreadId);
        if (changedRows(result) !== 1) throw new Error(`Thread not found: ${safeThreadId}`);
      });
      this.threadCache.delete(safeThreadId);
    });
  }

  async updateThread(threadId: string, patch: ThreadPatch): Promise<RuntimeThread> {
    return this.enqueueThreadMutation(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'thread.updated',
      createdAt: this.clock.now().toISOString(),
      payload: {
        title: patch.title?.trim() || undefined,
        archived: patch.archived,
      },
    });
  }

  async updateThreadMemoryMode(
    threadId: string,
    mode: RuntimeThreadMemoryMode,
    reason?: string,
  ): Promise<RuntimeThread> {
    return this.enqueueThreadMutation(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'thread.memory_mode_updated',
      createdAt: this.clock.now().toISOString(),
      payload: {
        mode: normalizeThreadMemoryMode(mode),
        reason: reason?.trim() || undefined,
      },
    });
  }

  async updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    const message = thread.messages.find((item) => item.id === messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    if (message.role !== 'user' || message.contextCompaction) throw new Error('Only user messages can be edited.');
    const content = patch.content.trim();
    if (!content) throw new Error('Message content is required.');
    return this.enqueueThreadMutation(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'message.updated',
      createdAt: this.clock.now().toISOString(),
      payload: { messageId, content },
    });
  }

  async deleteMessages(threadId: string, input: MessageDeleteInput): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    const messageIds = [...new Set(input.messageIds.map((id) => id.trim()).filter(Boolean))];
    if (!messageIds.length) throw new Error('At least one message id is required.');
    const existingIds = new Set(thread.messages.map((message) => message.id));
    const deletableIds = messageIds.filter((id) => existingIds.has(id));
    if (!deletableIds.length) return thread;
    return this.enqueueThreadMutation(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'messages.deleted',
      createdAt: this.clock.now().toISOString(),
      payload: { messageIds: deletableIds },
    });
  }

  async truncateMessagesAfter(threadId: string, messageId: string, includeSelf = false): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    const index = thread.messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error(`Message not found: ${messageId}`);
    const removed = thread.messages.slice(includeSelf ? index : index + 1);
    if (!removed.length) return thread;
    return this.enqueueThreadMutation(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'messages.truncated',
      createdAt: this.clock.now().toISOString(),
      payload: {
        messageId,
        includeSelf,
        removedMessageIds: removed.map((message) => message.id),
      },
    });
  }

  async clearThreadMessages(threadId: string): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    return this.enqueueThreadMutation(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'thread.context_cleared',
      createdAt: this.clock.now().toISOString(),
      payload: { clearedMessageCount: thread.messages.length },
    });
  }

  async appendEvent(threadId: string, eventWithoutSeq: Omit<RuntimeEvent, 'seq'>): Promise<RuntimeEvent> {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    if (eventWithoutSeq.threadId !== safeThreadId) {
      throw new Error('Runtime event thread id does not match its storage thread.');
    }
    await this.ensureReady();
    return this.enqueueThreadWrite(safeThreadId, () => this.appendEventUnlocked(safeThreadId, eventWithoutSeq));
  }

  async listEvents(threadId: string, sinceSeq = 0): Promise<RuntimeEvent[]> {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    await this.ensureReady();
    this.assertOwnership();
    return this.readEvents(safeThreadId, Math.max(0, Math.floor(sinceSeq)));
  }

  async replayEvents(threadId: string, sinceSeq = 0) {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    await this.ensureReady();
    this.assertOwnership();
    const requestedSinceSeq = Math.max(0, Math.floor(sinceSeq));
    const state = readEventArchiveState(this.requireDatabase(), safeThreadId);
    const retainedFromSeq = state.archivedThroughSeq + 1;
    const requiresResync = requestedSinceSeq < retainedFromSeq - 1;
    return {
      events: this.readHotEvents(
        safeThreadId,
        requiresResync ? retainedFromSeq - 1 : requestedSinceSeq,
      ),
      latestSeq: state.lastSeq,
      retainedFromSeq,
      requiresResync,
    };
  }

  private async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    // Vite 5 predates node:sqlite. Resolve it from Node itself so both Vitest and the bundled CJS
    // runtime avoid treating the builtin as an npm package named "sqlite".
    const { DatabaseSync: SqliteDatabase } = loadNodeSqlite();
    const database = new SqliteDatabase(this.databasePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    });
    this.database = database;
    try {
      database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;
        PRAGMA temp_store = MEMORY;
      `);
      ensureSqliteThreadSchema(database);
      await this.acquireOwnership();
      this.startLeaseHeartbeat();
      await this.importLegacyJsonStore();
    } catch (error) {
      this.stopLeaseHeartbeat();
      this.releaseOwnership();
      database.close();
      this.database = null;
      throw error;
    }
  }

  private async importLegacyJsonStore(): Promise<void> {
    const database = this.requireDatabase();
    const imported = database.prepare('SELECT value FROM store_metadata WHERE key = ?').get(LEGACY_IMPORT_KEY);
    if (imported) return;
    const count = numberColumn(database.prepare('SELECT COUNT(*) AS count FROM threads').get(), 'count');
    if (count !== 0) {
      throw new Error('SQLite thread store contains data but has no completed legacy import marker.');
    }

    // Read and validate everything before the transaction so a malformed legacy thread cannot create a partial database.
    const records = await readLegacyJsonThreads(this.dataDir);
    const duplicateSequenceRecoveries = records.flatMap((record) =>
      record.duplicateSequenceRecoveries.map((recovery) => ({ threadId: record.thread.id, ...recovery })),
    );
    this.withWriteTransaction(() => {
      for (const record of records) {
        insertThreadProjection(this.requireDatabase(), record.thread, record.thread.lastSeq);
        for (const event of record.events) insertRuntimeEvent(this.requireDatabase(), event);
      }
      database.prepare('INSERT INTO store_metadata(key, value) VALUES (?, ?)').run(
        LEGACY_IMPORT_KEY,
        JSON.stringify({
          completedAt: this.clock.now().toISOString(),
          duplicateSequenceRecoveries,
          threadCount: records.length,
        }),
      );
    });
    if (duplicateSequenceRecoveries.length) {
      console.warn(
        `[runtime storage] Recovered ${duplicateSequenceRecoveries.length} duplicate legacy event sequence(s) `
        + 'using the last writer confirmed by a later checkpoint; source JSONL files were preserved.',
      );
    }
  }

  private async enqueueThreadMutation(
    threadId: string,
    event: Omit<RuntimeEvent, 'seq'>,
  ): Promise<RuntimeThread> {
    await this.appendEvent(threadId, event);
    const thread = await this.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  }

  private async appendEventUnlocked(
    threadId: string,
    eventWithoutSeq: Omit<RuntimeEvent, 'seq'>,
  ): Promise<RuntimeEvent> {
    this.throwIfFailed();
    const current = await this.requireThread(threadId);
    const delayedCheckpoint = eventCanUseDelayedCheckpoint(eventWithoutSeq as RuntimeEvent);
    let event: RuntimeEvent | null = null;
    let nextThread: RuntimeThread | null = null;

    this.withWriteTransaction(() => {
      const row = this.requireDatabase().prepare('SELECT last_seq FROM threads WHERE id = ?').get(threadId);
      if (!row) throw new Error(`Thread not found: ${threadId}`);
      const persistedLastSeq = numberColumn(row, 'last_seq');
      if (persistedLastSeq !== current.lastSeq) {
        throw new Error(`Thread cache is stale for ${threadId}: cached ${current.lastSeq}, persisted ${persistedLastSeq}.`);
      }
      event = { ...eventWithoutSeq, seq: persistedLastSeq + 1 } as RuntimeEvent;
      nextThread = applyRuntimeEventToThread(current, event);
      insertRuntimeEvent(this.requireDatabase(), event);
      updateThreadProjection(
        this.requireDatabase(),
        nextThread,
        delayedCheckpoint ? null : nextThread.lastSeq,
        persistedLastSeq,
      );
      syncMessageIndex(this.requireDatabase(), current, nextThread);
    });

    if (!event || !nextThread) throw new Error(`Unable to persist runtime event for thread: ${threadId}`);
    this.threadCache.set(threadId, nextThread);
    if (!delayedCheckpoint) this.cancelCheckpoint(threadId);
    // Archiving is maintenance, not part of the event commit. Keeping it on the
    // checkpoint queue prevents compression work from delaying lifecycle publication.
    this.scheduleCheckpoint(threadId);
    return event;
  }

  private loadThread(threadId: string): RuntimeThread | null {
    const row = this.requireDatabase().prepare(`
      SELECT snapshot_json, snapshot_seq, last_seq, message_index_seq
      FROM threads
      WHERE id = ?
    `).get(threadId);
    if (!row) return null;

    const snapshotSeq = numberColumn(row, 'snapshot_seq');
    const lastSeq = numberColumn(row, 'last_seq');
    let snapshot: RuntimeThread;
    try {
      snapshot = JSON.parse(stringColumn(row, 'snapshot_json')) as RuntimeThread;
    } catch (error) {
      throw new Error(`Invalid SQLite thread snapshot JSON: ${threadId}`, { cause: error });
    }
    assertThreadSnapshot(snapshot, threadId);
    if (snapshot.lastSeq !== snapshotSeq || snapshotSeq > lastSeq) {
      throw new Error(`Invalid SQLite thread checkpoint sequence: ${threadId}`);
    }

    const normalized = normalizeThreadSnapshot(snapshot);
    let thread = normalized.thread;
    const events = this.readEvents(threadId, snapshotSeq);
    let expectedSeq = snapshotSeq + 1;
    for (const event of events) {
      if (event.seq !== expectedSeq) throw new Error(`Invalid SQLite runtime event sequence for ${threadId}: ${event.seq}`);
      thread = applyRuntimeEventToThread(thread, event);
      expectedSeq += 1;
    }
    if (thread.lastSeq !== lastSeq) {
      throw new Error(`SQLite thread snapshot/event tail does not reach last_seq for ${threadId}.`);
    }
    thread = hydrateMessageCompletionTimesFromEvents(thread, events);
    this.threadCache.set(threadId, thread);
    const indexedMessageCount = numberColumn(this.requireDatabase().prepare(`
      SELECT COUNT(*) AS count FROM thread_messages WHERE thread_id = ?
    `).get(threadId), 'count');
    const messageIndexStale = numberColumn(row, 'message_index_seq') !== lastSeq
      || indexedMessageCount !== thread.messages.length;
    if (normalized.changed || events.length || messageIndexStale) {
      this.repairLoadedThread(thread, messageIndexStale);
    }
    return thread;
  }

  private readEvents(threadId: string, sinceSeq: number): RuntimeEvent[] {
    const { lastSeq } = readEventArchiveState(this.requireDatabase(), threadId);
    const events = [
      ...readArchivedEvents(this.requireDatabase(), threadId, sinceSeq),
      ...readRawEvents(this.requireDatabase(), threadId, sinceSeq),
    ].sort((left, right) => left.seq - right.seq);
    let expectedSeq = sinceSeq + 1;
    for (const event of events) {
      if (event.seq !== expectedSeq) {
        throw new Error(`Invalid SQLite runtime event sequence for ${threadId}: expected ${expectedSeq}, got ${event.seq}`);
      }
      expectedSeq += 1;
    }
    if (sinceSeq < lastSeq && events.at(-1)?.seq !== lastSeq) {
      throw new Error(`SQLite runtime event tail does not reach last_seq for ${threadId}.`);
    }
    return events;
  }

  private readHotEvents(threadId: string, sinceSeq: number): RuntimeEvent[] {
    const { lastSeq } = readEventArchiveState(this.requireDatabase(), threadId);
    const events = readRawEvents(this.requireDatabase(), threadId, sinceSeq);
    let expectedSeq = sinceSeq + 1;
    for (const event of events) {
      if (event.seq !== expectedSeq) {
        throw new Error(`Invalid SQLite hot runtime event sequence for ${threadId}: expected ${expectedSeq}, got ${event.seq}`);
      }
      expectedSeq += 1;
    }
    if (sinceSeq < lastSeq && events.at(-1)?.seq !== lastSeq) {
      throw new Error(`SQLite hot runtime event tail does not reach last_seq for ${threadId}.`);
    }
    return events;
  }

  private repairLoadedThread(thread: RuntimeThread, rebuildMessageIndex: boolean): void {
    this.withWriteTransaction(() => {
      const summary = toSummary(thread);
      const result = this.requireDatabase().prepare(`
        UPDATE threads SET
          active_turn_id = ?, forked_from_id = ?, parent_thread_id = ?, project_id = ?, title = ?,
          created_at = ?, updated_at = ?, archived = ?, memory_mode = ?, git_info_json = ?, goal_json = ?,
          message_count = ?, last_message_preview = ?, snapshot_json = ?, snapshot_seq = ?,
          message_index_seq = ?
        WHERE id = ? AND last_seq = ?
      `).run(
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
        thread.lastSeq,
        thread.lastSeq,
        thread.id,
        thread.lastSeq,
      );
      if (changedRows(result) !== 1) throw new Error(`Unable to repair SQLite thread: ${thread.id}`);
      if (rebuildMessageIndex) replaceMessageIndex(this.requireDatabase(), thread);
      this.archiveTransientEvents(thread);
    });
  }

  private archiveTransientEvents(thread: RuntimeThread): void {
    archiveTransientEvents(
      this.requireDatabase(),
      thread.id,
      thread.lastSeq,
      this.eventRetentionLimit,
    );
  }

  private persistCachedThreadUnlocked(threadId: string): void {
    const thread = this.threadCache.get(threadId);
    if (!thread) return;
    this.withWriteTransaction(() => {
      const summary = toSummary(thread);
      const result = this.requireDatabase().prepare(`
        UPDATE threads SET
          active_turn_id = ?, forked_from_id = ?, parent_thread_id = ?, project_id = ?, title = ?,
          created_at = ?, updated_at = ?, archived = ?, memory_mode = ?, git_info_json = ?, goal_json = ?,
          message_count = ?, last_message_preview = ?, snapshot_json = ?, snapshot_seq = ?
        WHERE id = ? AND last_seq = ? AND snapshot_seq <= ?
      `).run(
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
        thread.lastSeq,
        thread.id,
        thread.lastSeq,
        thread.lastSeq,
      );
      if (changedRows(result) !== 1) throw new Error(`Unable to checkpoint SQLite thread: ${thread.id}`);
      this.archiveTransientEvents(thread);
    });
  }

  private scheduleCheckpoint(threadId: string): void {
    if (this.checkpointTimers.has(threadId)) return;
    const timer = setTimeout(() => {
      this.checkpointTimers.delete(threadId);
      const task = this.enqueueThreadWrite(threadId, async () => this.persistCachedThreadUnlocked(threadId));
      this.checkpointTasks.add(task);
      void task.then(
        () => this.checkpointTasks.delete(task),
        (error) => {
          this.checkpointTasks.delete(task);
          this.checkpointFailure = toError(error);
        },
      );
    }, this.checkpointDelayMs);
    timer.unref();
    this.checkpointTimers.set(threadId, timer);
  }

  private cancelCheckpoint(threadId: string): void {
    const timer = this.checkpointTimers.get(threadId);
    if (timer) clearTimeout(timer);
    this.checkpointTimers.delete(threadId);
  }

  private async flushCheckpoints(): Promise<void> {
    const pendingThreadIds = [...this.checkpointTimers.keys()];
    for (const timer of this.checkpointTimers.values()) clearTimeout(timer);
    this.checkpointTimers.clear();
    const flushes = pendingThreadIds.map((threadId) =>
      this.enqueueThreadWrite(threadId, async () => this.persistCachedThreadUnlocked(threadId)),
    );
    await Promise.all([...this.checkpointTasks, ...flushes]);
    this.throwIfFailed();
  }

  private async requireThread(threadId: string): Promise<RuntimeThread> {
    const thread = await this.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  }

  private async enqueueThreadWrite<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.threadWriteQueues.get(threadId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const queue = run.then(() => undefined, () => undefined);
    this.threadWriteQueues.set(threadId, queue);
    try {
      return await run;
    } finally {
      if (this.threadWriteQueues.get(threadId) === queue) this.threadWriteQueues.delete(threadId);
    }
  }

  private async acquireOwnership(): Promise<void> {
    const waitDeadline = Date.now() + this.ownershipWaitMs;
    for (;;) {
      try {
        this.acquireOwnershipOnce();
        return;
      } catch (error) {
        if (!(error instanceof RuntimeStorageInUseError) || this.ownershipWaitMs === 0) throw error;

        const remainingWaitMs = waitDeadline - Date.now();
        if (remainingWaitMs <= 0) throw error;
        const remainingLeaseMs = error.leaseExpiresAt - this.clock.now().getTime();
        await delay(Math.min(remainingWaitMs, Math.max(25, remainingLeaseMs + 25)));
      }
    }
  }

  private acquireOwnershipOnce(): void {
    const database = this.requireDatabase();
    const now = this.clock.now().getTime();
    let acquiredFenceToken = 1;
    withTransaction(database, () => {
      const row = database.prepare(`
        SELECT owner_id, fence_token, lease_expires_at
        FROM runtime_owner
        WHERE slot = 1
      `).get();
      if (!row) {
        database.prepare(`
          INSERT INTO runtime_owner(slot, owner_id, fence_token, lease_expires_at)
          VALUES (1, ?, 1, ?)
        `).run(this.ownerId, now + this.leaseTtlMs);
        return;
      }
      const leaseExpiresAt = numberColumn(row, 'lease_expires_at');
      if (leaseExpiresAt > now) throw new RuntimeStorageInUseError(this.databasePath, leaseExpiresAt);
      acquiredFenceToken = numberColumn(row, 'fence_token') + 1;
      database.prepare(`
        UPDATE runtime_owner
        SET owner_id = ?, fence_token = ?, lease_expires_at = ?
        WHERE slot = 1
      `).run(this.ownerId, acquiredFenceToken, now + this.leaseTtlMs);
    });
    this.fenceToken = acquiredFenceToken;
  }

  private startLeaseHeartbeat(): void {
    const timer = setInterval(() => {
      try {
        this.withWriteTransaction(() => undefined);
      } catch (error) {
        this.ownershipFailure = toError(error);
        this.stopLeaseHeartbeat();
      }
    }, this.leaseHeartbeatMs);
    timer.unref();
    this.leaseTimer = timer;
  }

  private stopLeaseHeartbeat(): void {
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    this.leaseTimer = null;
  }

  private releaseOwnership(): void {
    const database = this.database;
    const fenceToken = this.fenceToken;
    if (!database || fenceToken === null) return;
    try {
      withTransaction(database, () => {
        database.prepare(`
          DELETE FROM runtime_owner
          WHERE slot = 1 AND owner_id = ? AND fence_token = ?
        `).run(this.ownerId, fenceToken);
      });
    } catch {
      // Expiry still allows a new owner to fence this process after an unclean close.
    } finally {
      this.fenceToken = null;
    }
  }

  private assertOwnership(): void {
    this.throwIfFailed();
    const fenceToken = this.fenceToken;
    if (fenceToken === null) throw new Error('Runtime storage ownership has not been acquired.');
    const row = this.requireDatabase().prepare(`
      SELECT owner_id, fence_token
      FROM runtime_owner
      WHERE slot = 1
    `).get();
    if (!row || stringColumn(row, 'owner_id') !== this.ownerId || numberColumn(row, 'fence_token') !== fenceToken) {
      const error = new Error('Runtime storage ownership was lost to another process.');
      this.ownershipFailure = error;
      throw error;
    }
  }

  private withWriteTransaction<T>(operation: () => T): T {
    this.throwIfFailed();
    const database = this.requireDatabase();
    const fenceToken = this.fenceToken;
    if (fenceToken === null) throw new Error('Runtime storage ownership has not been acquired.');
    return withTransaction(database, () => {
      const refreshed = database.prepare(`
        UPDATE runtime_owner
        SET lease_expires_at = ?
        WHERE slot = 1 AND owner_id = ? AND fence_token = ?
      `).run(this.clock.now().getTime() + this.leaseTtlMs, this.ownerId, fenceToken);
      if (changedRows(refreshed) !== 1) {
        const error = new Error('Runtime storage ownership was lost to another process.');
        this.ownershipFailure = error;
        throw error;
      }
      return operation();
    });
  }

  private async ensureReady(): Promise<void> {
    await this.recover();
    this.throwIfFailed();
  }

  private throwIfFailed(): void {
    if (this.closed) throw new Error('SQLite thread store is closed.');
    if (this.ownershipFailure) throw this.ownershipFailure;
    if (this.checkpointFailure) throw this.checkpointFailure;
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error('SQLite thread store is not initialized.');
    return this.database;
  }
}

function withTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the original transaction failure.
    }
    throw error;
  }
}

function summaryFromRow(row: SqliteThreadRow): RuntimeThreadSummary {
  return {
    id: stringColumn(row, 'id'),
    activeTurnId: nullableStringColumn(row, 'active_turn_id'),
    forkedFromId: nullableStringColumn(row, 'forked_from_id'),
    parentThreadId: nullableStringColumn(row, 'parent_thread_id'),
    projectId: nullableStringColumn(row, 'project_id'),
    title: stringColumn(row, 'title'),
    createdAt: stringColumn(row, 'created_at'),
    updatedAt: stringColumn(row, 'updated_at'),
    archived: numberColumn(row, 'archived') === 1,
    memoryMode: normalizeThreadMemoryMode(stringColumn(row, 'memory_mode')),
    gitInfo: parseOptionalJson(row, 'git_info_json'),
    goal: parseOptionalJson(row, 'goal_json'),
    messageCount: numberColumn(row, 'message_count'),
    lastMessagePreview: stringColumn(row, 'last_message_preview'),
  } as RuntimeThreadSummary;
}

function parseOptionalJson(row: SqliteThreadRow, column: string): unknown {
  const value = nullableStringColumn(row, column);
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`Invalid SQLite JSON column: ${column}`, { cause: error });
  }
}

function optionalJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function stringColumn(row: SqliteThreadRow | undefined, column: string): string {
  const value = row?.[column];
  if (typeof value !== 'string') throw new Error(`Invalid SQLite text column: ${column}`);
  return value;
}

function nullableStringColumn(row: SqliteThreadRow, column: string): string | undefined {
  const value = row[column];
  if (value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid SQLite nullable text column: ${column}`);
  return value;
}

function numberColumn(row: SqliteThreadRow | undefined, column: string): number {
  const value = row?.[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid SQLite number column: ${column}`);
  return value;
}

function changedRows(result: StatementResultingChanges): number {
  return typeof result.changes === 'bigint' ? Number(result.changes) : result.changes;
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function loadNodeSqlite(): typeof import('node:sqlite') {
  const sqlite = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite') | undefined;
  if (!sqlite) throw new Error('This runtime does not provide the required node:sqlite module.');
  return sqlite;
}
