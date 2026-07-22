import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeThread,
  RuntimeThreadMemoryMode,
  RuntimeThreadSummary,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import { applyRuntimeEventToThread, DEFAULT_THREAD_TITLE } from '@setsuna-desktop/contracts';
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { assertSafeRuntimeId, resolveRuntimeStoragePath } from '../../security/runtime-id.js';
import { readJsonFile, writeJsonFile } from './json-file.js';
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

type ThreadIndex = {
  threads: RuntimeThreadSummary[];
};

const STREAM_CHECKPOINT_DELAY_MS = 100;

export class JsonThreadStore implements ThreadStore {
  private readonly threadsDir: string;
  private readonly indexPath: string;
  private readonly threadWriteQueues = new Map<string, Promise<void>>();
  private readonly threadCache = new Map<string, RuntimeThread>();
  private readonly checkpointTimers = new Map<string, NodeJS.Timeout>();
  private readonly checkpointTasks = new Set<Promise<void>>();
  private checkpointFailure: Error | null = null;
  private indexWriteQueue: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {
    this.threadsDir = path.join(dataDir, 'threads');
    this.indexPath = path.join(this.threadsDir, 'index.json');
  }

  async listThreads(query: ThreadQuery = {}): Promise<RuntimeThreadSummary[]> {
    const index = await this.readIndex();
    const search = query.search?.trim().toLowerCase();
    const parentMap = new Map(index.threads.map((thread) => [thread.id, thread.parentThreadId]));
    return index.threads
      .map(normalizeThreadSummary)
      .filter((thread) => query.includeArchived || !thread.archived)
      .filter((thread) => !query.parentThreadId || thread.parentThreadId === query.parentThreadId)
      .filter((thread) => !query.ancestorThreadId || threadHasAncestor(thread.id, query.ancestorThreadId, parentMap))
      .filter((thread) => {
        if (query.projectId) return thread.projectId === query.projectId;
        if (query.scope === 'global') return !thread.projectId;
        if (query.scope === 'project') return Boolean(thread.projectId);
        return true;
      })
      .filter((thread) => !search || thread.title.toLowerCase().includes(search) || thread.lastMessagePreview.toLowerCase().includes(search))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getThread(threadId: string): Promise<RuntimeThread | null> {
    const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
    const cached = this.threadCache.get(safeThreadId);
    if (cached) return cloneThread(cached);
    const recovered = await this.loadAndRecoverThread(safeThreadId, true);
    if (!recovered) return null;
    this.threadCache.set(safeThreadId, recovered);
    return cloneThread(recovered);
  }

  /** 启动时重放尚未建立检查点的事件，并重建摘要索引。 */
  async recover(): Promise<void> {
    await mkdir(this.threadsDir, { recursive: true });
    const entries = await readdir(this.threadsDir, { withFileTypes: true });
    const snapshotIds = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'index.json')
      .map((entry) => entry.name.slice(0, -'.json'.length));
    const eventLogIds = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name.slice(0, -'.jsonl'.length));
    for (const threadId of eventLogIds) {
      assertSafeRuntimeId(threadId, 'Thread id');
      if (!snapshotIds.includes(threadId)) {
        throw new Error(`Thread event log has no seed snapshot: ${threadId}`);
      }
    }

    const threads: RuntimeThread[] = [];
    for (const threadId of snapshotIds) {
      const safeThreadId = assertSafeRuntimeId(threadId, 'Thread id');
      const thread = await this.loadAndRecoverThread(safeThreadId, false);
      if (!thread) continue;
      this.threadCache.set(safeThreadId, thread);
      threads.push(thread);
    }
    await this.enqueueIndexWrite(() => writeJsonFile(this.indexPath, {
      threads: threads.map(toSummary).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    }));
  }

  /** runtime 关闭或测试检查磁盘状态前，刷新延迟写入的流式检查点。 */
  async flush(): Promise<void> {
    const pendingThreadIds = [...this.checkpointTimers.keys()];
    for (const timer of this.checkpointTimers.values()) clearTimeout(timer);
    this.checkpointTimers.clear();
    const flushes = pendingThreadIds.map((threadId) =>
      this.enqueueThreadWrite(threadId, () => this.persistCachedThreadUnlocked(threadId)),
    );
    await Promise.all([...this.checkpointTasks, ...flushes]);
    if (this.checkpointFailure) throw this.checkpointFailure;
  }

  async createThread(input: CreateThreadInput = {}): Promise<RuntimeThread> {
    await mkdir(this.threadsDir, { recursive: true });
    const now = this.clock.now().toISOString();
    const threadId = assertSafeRuntimeId(this.ids.id('thread'), 'Thread id');
    const forkedFromId = optionalSafeRuntimeId(input.forkedFromId, 'Forked thread id');
    const parentThreadId = optionalSafeRuntimeId(input.parentThreadId, 'Parent thread id');
    const thread: RuntimeThread = {
      id: threadId,
      forkedFromId,
      parentThreadId,
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
    await writeJsonFile(this.snapshotPath(thread.id), thread);
    await this.writeIndexWithThread(thread);
    this.threadCache.set(thread.id, thread);
    await this.appendEvent(thread.id, {
      id: this.ids.id('event'),
      threadId: thread.id,
      type: 'thread.created',
      createdAt: now,
      payload: { title: thread.title },
    });
    return (await this.getThread(thread.id)) ?? thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    assertSafeRuntimeId(threadId, 'Thread id');
    return this.enqueueThreadWrite(threadId, async () => {
      this.cancelCheckpoint(threadId);
      if (!await this.getThread(threadId)) throw new Error(`Thread not found: ${threadId}`);
      await this.removeThreadFromIndex(threadId);
      await rm(this.snapshotPath(threadId), { force: true });
      await rm(this.eventsPath(threadId), { force: true });
      this.threadCache.delete(threadId);
    });
  }

  async updateThread(threadId: string, patch: ThreadPatch): Promise<RuntimeThread> {
    return this.enqueueThreadWrite(threadId, async () => {
      await this.appendEventUnlocked(threadId, {
        id: this.ids.id('event'),
        threadId,
        type: 'thread.updated',
        createdAt: this.clock.now().toISOString(),
        payload: {
          title: patch.title?.trim() || undefined,
          archived: patch.archived,
        },
      });
      const next = await this.getThread(threadId);
      if (!next) throw new Error(`Thread not found: ${threadId}`);
      return next;
    });
  }

  async updateThreadMemoryMode(threadId: string, mode: RuntimeThreadMemoryMode, reason?: string): Promise<RuntimeThread> {
    return this.enqueueThreadWrite(threadId, async () => {
      await this.appendEventUnlocked(threadId, {
        id: this.ids.id('event'),
        threadId,
        type: 'thread.memory_mode_updated',
        createdAt: this.clock.now().toISOString(),
        payload: {
          mode: normalizeThreadMemoryMode(mode),
          reason: reason?.trim() || undefined,
        },
      });
      const next = await this.getThread(threadId);
      if (!next) throw new Error(`Thread not found: ${threadId}`);
      return next;
    });
  }

  async updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    const message = thread.messages.find((item) => item.id === messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    if (message.role !== 'user' || message.contextCompaction) throw new Error('Only user messages can be edited.');
    const content = patch.content.trim();
    if (!content) throw new Error('Message content is required.');
    await this.appendEvent(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'message.updated',
      createdAt: this.clock.now().toISOString(),
      payload: { messageId, content },
    });
    return (await this.getThread(threadId)) ?? thread;
  }

  async deleteMessages(threadId: string, input: MessageDeleteInput): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    const messageIds = [...new Set(input.messageIds.map((id) => id.trim()).filter(Boolean))];
    if (!messageIds.length) throw new Error('At least one message id is required.');
    const existingIds = new Set(thread.messages.map((message) => message.id));
    const deletableIds = messageIds.filter((id) => existingIds.has(id));
    if (!deletableIds.length) return thread;
    await this.appendEvent(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'messages.deleted',
      createdAt: this.clock.now().toISOString(),
      payload: { messageIds: deletableIds },
    });
    return (await this.getThread(threadId)) ?? thread;
  }

  async truncateMessagesAfter(threadId: string, messageId: string, includeSelf = false): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    const index = thread.messages.findIndex((message) => message.id === messageId);
    if (index < 0) throw new Error(`Message not found: ${messageId}`);
    const removed = thread.messages.slice(includeSelf ? index : index + 1);
    if (!removed.length) return thread;
    await this.appendEvent(threadId, {
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
    return (await this.getThread(threadId)) ?? thread;
  }

  async clearThreadMessages(threadId: string): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    await this.appendEvent(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'thread.context_cleared',
      createdAt: this.clock.now().toISOString(),
      payload: {
        clearedMessageCount: thread.messages.length,
      },
    });
    return (await this.getThread(threadId)) ?? { ...thread, messages: [], messageCount: 0, lastMessagePreview: '' };
  }

  async appendEvent(threadId: string, eventWithoutSeq: Omit<RuntimeEvent, 'seq'>): Promise<RuntimeEvent> {
    assertSafeRuntimeId(threadId, 'Thread id');
    if (eventWithoutSeq.threadId !== threadId) throw new Error('Runtime event thread id does not match its storage thread.');
    return this.enqueueThreadWrite(threadId, () => this.appendEventUnlocked(threadId, eventWithoutSeq));
  }

  private async appendEventUnlocked(threadId: string, eventWithoutSeq: Omit<RuntimeEvent, 'seq'>): Promise<RuntimeEvent> {
    if (this.checkpointFailure) throw this.checkpointFailure;
    const thread = await this.requireThread(threadId);
    const event = {
      ...eventWithoutSeq,
      seq: thread.lastSeq + 1,
    } as RuntimeEvent;
    await mkdir(this.threadsDir, { recursive: true });
    await appendFile(this.eventsPath(threadId), `${JSON.stringify(event)}\n`, 'utf8');
    const nextThread = applyRuntimeEventToThread(thread, event);
    this.threadCache.set(threadId, nextThread);
    if (eventCanUseDelayedCheckpoint(event)) {
      this.scheduleCheckpoint(threadId);
    } else {
      this.cancelCheckpoint(threadId);
      await this.persistCachedThreadUnlocked(threadId);
    }
    return event;
  }

  private scheduleCheckpoint(threadId: string): void {
    if (this.checkpointTimers.has(threadId)) return;
    const timer = setTimeout(() => {
      this.checkpointTimers.delete(threadId);
      const task = this.enqueueThreadWrite(threadId, () => this.persistCachedThreadUnlocked(threadId));
      this.checkpointTasks.add(task);
      void task.then(
        () => this.checkpointTasks.delete(task),
        (error) => {
          this.checkpointTasks.delete(task);
          this.checkpointFailure = error instanceof Error ? error : new Error(String(error));
        },
      );
    }, STREAM_CHECKPOINT_DELAY_MS);
    timer.unref();
    this.checkpointTimers.set(threadId, timer);
  }

  private cancelCheckpoint(threadId: string): void {
    const timer = this.checkpointTimers.get(threadId);
    if (timer) clearTimeout(timer);
    this.checkpointTimers.delete(threadId);
  }

  private async persistCachedThreadUnlocked(threadId: string): Promise<void> {
    const thread = this.threadCache.get(threadId);
    if (!thread) return;
    await writeJsonFile(this.snapshotPath(threadId), thread);
    await this.writeIndexWithThread(thread);
  }

  private async enqueueThreadWrite<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.threadWriteQueues.get(threadId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const queue = run.then(() => undefined, () => undefined);
    this.threadWriteQueues.set(threadId, queue);
    try {
      return await run;
    } finally {
      if (this.threadWriteQueues.get(threadId) === queue) {
        this.threadWriteQueues.delete(threadId);
      }
    }
  }

  async listEvents(threadId: string, sinceSeq = 0): Promise<RuntimeEvent[]> {
    assertSafeRuntimeId(threadId, 'Thread id');
    return (await this.readEventLog(threadId, false)).filter((event) => event.seq > sinceSeq);
  }

  private async requireThread(threadId: string): Promise<RuntimeThread> {
    const thread = await this.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  }

  private async readIndex(): Promise<ThreadIndex> {
    return readJsonFile<ThreadIndex>(this.indexPath, { threads: [] });
  }

  private async writeIndexWithThread(thread: RuntimeThread): Promise<void> {
    await this.enqueueIndexWrite(async () => {
      const index = await this.readIndex();
      const summary = toSummary(thread);
      const threads = [summary, ...index.threads.filter((item) => item.id !== thread.id)];
      await writeJsonFile(this.indexPath, { threads });
    });
  }

  private async removeThreadFromIndex(threadId: string): Promise<void> {
    await this.enqueueIndexWrite(async () => {
      const index = await this.readIndex();
      await writeJsonFile(this.indexPath, { threads: index.threads.filter((thread) => thread.id !== threadId) });
    });
  }

  private async enqueueIndexWrite<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.indexWriteQueue;
    const run = previous.catch(() => undefined).then(task);
    this.indexWriteQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private snapshotPath(threadId: string): string {
    return resolveRuntimeStoragePath(this.threadsDir, `${assertSafeRuntimeId(threadId, 'Thread id')}.json`);
  }

  private eventsPath(threadId: string): string {
    return resolveRuntimeStoragePath(this.threadsDir, `${assertSafeRuntimeId(threadId, 'Thread id')}.jsonl`);
  }

  private async loadAndRecoverThread(threadId: string, updateIndex: boolean): Promise<RuntimeThread | null> {
    const snapshot = await readJsonFile<RuntimeThread | null>(this.snapshotPath(threadId), null);
    const events = await this.readEventLog(threadId, true);
    if (!snapshot) {
      if (events.length) throw new Error(`Thread event log has no seed snapshot: ${threadId}`);
      return null;
    }
    assertThreadSnapshot(snapshot, threadId);
    const normalized = normalizeThreadSnapshot(snapshot);
    let thread = normalized.thread;
    const highestSeq = events.at(-1)?.seq ?? 0;
    if (thread.lastSeq > highestSeq) {
      throw new Error(`Thread snapshot is ahead of its event log: ${threadId}`);
    }
    let recovered = normalized.changed;
    for (const event of events) {
      if (event.seq <= thread.lastSeq) continue;
      thread = applyRuntimeEventToThread(thread, event);
      recovered = true;
    }
    const hydrated = hydrateMessageCompletionTimesFromEvents(thread, events);
    if (hydrated !== thread) recovered = true;
    thread = hydrated;
    if (recovered) {
      await writeJsonFile(this.snapshotPath(threadId), thread);
      if (updateIndex) await this.writeIndexWithThread(thread);
    }
    return thread;
  }

  private async readEventLog(threadId: string, repairIncompleteTail: boolean): Promise<RuntimeEvent[]> {
    let text: string;
    try {
      text = await readFile(this.eventsPath(threadId), 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw error;
    }
    const lines = text.split('\n');
    const events: RuntimeEvent[] = [];
    const eventIds = new Set<string>();
    let incompleteTail = false;
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: RuntimeEvent;
      try {
        event = JSON.parse(trimmed) as RuntimeEvent;
      } catch (error) {
        if (index === lines.length - 1 && !text.endsWith('\n')) {
          incompleteTail = true;
          break;
        }
        throw new Error(`Invalid runtime event JSON at ${this.eventsPath(threadId)}:${index + 1}`, { cause: error });
      }
      const expectedSeq = events.length + 1;
      if (!event || event.threadId !== threadId || event.seq !== expectedSeq || !event.id || eventIds.has(event.id)) {
        throw new Error(`Invalid runtime event sequence at ${this.eventsPath(threadId)}:${index + 1}`);
      }
      eventIds.add(event.id);
      events.push(event);
    }
    if (repairIncompleteTail && (incompleteTail || (text && !text.endsWith('\n')))) {
      await writeFile(this.eventsPath(threadId), events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''), 'utf8');
    }
    return events;
  }

}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function createMessage(input: Omit<RuntimeMessage, 'createdAt'> & { createdAt?: string }): RuntimeMessage {
  return {
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
