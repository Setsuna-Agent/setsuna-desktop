import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeThread,
  RuntimeThreadSummary,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import { applyRuntimeEventToThread } from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { parseJsonLine, readJsonFile, writeJsonFile } from './json-file.js';

type ThreadIndex = {
  threads: RuntimeThreadSummary[];
};

export class JsonThreadStore implements ThreadStore {
  private readonly threadsDir: string;
  private readonly indexPath: string;
  private readonly threadWriteQueues = new Map<string, Promise<void>>();

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
    return index.threads
      .filter((thread) => query.includeArchived || !thread.archived)
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
    const snapshot = await readJsonFile<RuntimeThread | null>(this.snapshotPath(threadId), null);
    if (!snapshot) return null;
    return this.hydrateMessageCompletionTimes(threadId, snapshot);
  }

  async createThread(input: CreateThreadInput = {}): Promise<RuntimeThread> {
    await mkdir(this.threadsDir, { recursive: true });
    const now = this.clock.now().toISOString();
    const thread: RuntimeThread = {
      id: this.ids.id('thread'),
      projectId: input.projectId?.trim() || undefined,
      title: input.title?.trim() || 'New thread',
      createdAt: now,
      updatedAt: now,
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      messages: [],
      lastSeq: 0,
    };
    await writeJsonFile(this.snapshotPath(thread.id), thread);
    await this.writeIndexWithThread(thread);
    await this.appendEvent(thread.id, {
      id: this.ids.id('event'),
      threadId: thread.id,
      type: 'thread.created',
      createdAt: now,
      payload: { title: thread.title },
    });
    return (await this.getThread(thread.id)) ?? thread;
  }

  async updateThread(threadId: string, patch: ThreadPatch): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    const next: RuntimeThread = {
      ...thread,
      title: patch.title?.trim() || thread.title,
      archived: patch.archived ?? thread.archived,
      updatedAt: this.clock.now().toISOString(),
    };
    await writeJsonFile(this.snapshotPath(threadId), next);
    await this.writeIndexWithThread(next);
    await this.appendEvent(threadId, {
      id: this.ids.id('event'),
      threadId,
      type: 'thread.updated',
      createdAt: next.updatedAt,
      payload: {
        title: patch.title,
        archived: patch.archived,
      },
    });
    return (await this.getThread(threadId)) ?? next;
  }

  async updateMessage(threadId: string, messageId: string, patch: MessagePatch): Promise<RuntimeThread> {
    const thread = await this.requireThread(threadId);
    const message = thread.messages.find((item) => item.id === messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);
    if (message.role !== 'user') throw new Error('Only user messages can be edited.');
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
    return this.enqueueThreadWrite(threadId, () => this.appendEventUnlocked(threadId, eventWithoutSeq));
  }

  private async appendEventUnlocked(threadId: string, eventWithoutSeq: Omit<RuntimeEvent, 'seq'>): Promise<RuntimeEvent> {
    const thread = await this.requireThread(threadId);
    const event = {
      ...eventWithoutSeq,
      seq: thread.lastSeq + 1,
    } as RuntimeEvent;
    await mkdir(this.threadsDir, { recursive: true });
    await appendFile(this.eventsPath(threadId), `${JSON.stringify(event)}\n`, 'utf8');
    const nextThread = applyRuntimeEventToThread(thread, event);
    await writeJsonFile(this.snapshotPath(threadId), nextThread);
    await this.writeIndexWithThread(nextThread);
    return event;
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
    try {
      const text = await readFile(this.eventsPath(threadId), 'utf8');
      return text
        .split('\n')
        .map((line) => parseJsonLine<RuntimeEvent>(line))
        .filter((event): event is RuntimeEvent => Boolean(event && event.seq > sinceSeq));
    } catch {
      return [];
    }
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
    const index = await this.readIndex();
    const summary = toSummary(thread);
    const threads = [summary, ...index.threads.filter((item) => item.id !== thread.id)];
    await writeJsonFile(this.indexPath, { threads });
  }

  private snapshotPath(threadId: string): string {
    return path.join(this.threadsDir, `${threadId}.json`);
  }

  private eventsPath(threadId: string): string {
    return path.join(this.threadsDir, `${threadId}.jsonl`);
  }

  private async hydrateMessageCompletionTimes(threadId: string, thread: RuntimeThread): Promise<RuntimeThread> {
    if (thread.messages.every((message) => message.completedAt || message.status !== 'complete')) return thread;
    const completedAtByMessageId = new Map<string, string>();
    for (const event of await this.listEvents(threadId)) {
      if (event.type === 'message.completed') {
        completedAtByMessageId.set(event.payload.messageId, event.createdAt);
      }
    }
    let changed = false;
    const messages = thread.messages.map((message) => {
      if (message.completedAt || message.status !== 'complete') return message;
      const completedAt = completedAtByMessageId.get(message.id);
      if (!completedAt) return message;
      changed = true;
      return { ...message, completedAt };
    });
    return changed ? { ...thread, messages } : thread;
  }
}

function toSummary(thread: RuntimeThread): RuntimeThreadSummary {
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archived: thread.archived,
    messageCount: thread.messageCount,
    lastMessagePreview: thread.lastMessagePreview,
  };
}

export function createMessage(input: Omit<RuntimeMessage, 'createdAt'> & { createdAt?: string }): RuntimeMessage {
  return {
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
