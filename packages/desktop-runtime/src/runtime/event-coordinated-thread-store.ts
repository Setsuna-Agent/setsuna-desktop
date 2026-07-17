import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RuntimeEvent,
  RuntimeThreadMemoryMode,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import type { ThreadStore } from '../ports/thread-store.js';
import { RuntimeEventWriter } from '../loop/runtime-event-writer.js';

export type RecoverableThreadStore = ThreadStore & {
  recover(): Promise<void>;
  flush(): Promise<void>;
};

/**
 * 协调直接线程修改与事件写入器的短增量批处理窗口。这样既能让 seq 按调用顺序分配，
 * 又不会让持久化适配器与事件总线耦合。
 */
export class EventCoordinatedThreadStore implements ThreadStore {
  constructor(
    private readonly inner: RecoverableThreadStore,
    private readonly eventWriter: RuntimeEventWriter,
  ) {}

  listThreads(query?: ThreadQuery) {
    return this.inner.listThreads(query);
  }

  getThread(threadId: string) {
    return this.inner.getThread(threadId);
  }

  createThread(input?: CreateThreadInput) {
    return this.inner.createThread(input);
  }

  deleteThread(threadId: string) {
    return this.afterPendingEvents(threadId, () => this.inner.deleteThread(threadId));
  }

  updateThread(threadId: string, patch: ThreadPatch) {
    return this.afterPendingEvents(threadId, () => this.inner.updateThread(threadId, patch));
  }

  updateThreadMemoryMode(threadId: string, mode: RuntimeThreadMemoryMode, reason?: string) {
    return this.afterPendingEvents(threadId, () => this.inner.updateThreadMemoryMode(threadId, mode, reason));
  }

  updateMessage(threadId: string, messageId: string, patch: MessagePatch) {
    return this.afterPendingEvents(threadId, () => this.inner.updateMessage(threadId, messageId, patch));
  }

  deleteMessages(threadId: string, input: MessageDeleteInput) {
    return this.afterPendingEvents(threadId, () => this.inner.deleteMessages(threadId, input));
  }

  truncateMessagesAfter(threadId: string, messageId: string, includeSelf?: boolean) {
    return this.afterPendingEvents(threadId, () => this.inner.truncateMessagesAfter(threadId, messageId, includeSelf));
  }

  clearThreadMessages(threadId: string) {
    return this.afterPendingEvents(threadId, () => this.inner.clearThreadMessages(threadId));
  }

  appendEvent(threadId: string, event: Omit<RuntimeEvent, 'seq'>) {
    return this.afterPendingEvents(threadId, () => this.inner.appendEvent(threadId, event));
  }

  listEvents(threadId: string, sinceSeq?: number) {
    return this.inner.listEvents(threadId, sinceSeq);
  }

  recover(): Promise<void> {
    return this.inner.recover();
  }

  async flush(): Promise<void> {
    await this.eventWriter.flushAll();
    await this.inner.flush();
  }

  private async afterPendingEvents<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    await this.eventWriter.flushThread(threadId);
    return operation();
  }
}
