import {
  type CreateThreadInput,
  type MessageDeleteInput,
  type MessagePatch,
  type RuntimeEvent,
  type RuntimeThreadMemoryMode,
  type ThreadPatch,
  type ThreadQuery,
} from '@setsuna-desktop/contracts';
import { RuntimeEventWriter } from '../loop/lifecycle/runtime-event-writer.js';
import type { GeneratedImageStore } from '../ports/generated-image-store.js';
import type { ThreadStore } from '../ports/thread-store.js';
import {
  managedGeneratedImageAssetIds,
  managedGeneratedImageAssetIdsFromStore,
} from '../utils/generated-image-assets.js';

export type RecoverableThreadStore = ThreadStore & {
  recover(): Promise<void>;
  flush(): Promise<void>;
  close?(): Promise<void>;
};

/**
 * 协调直接线程修改与事件写入器的短增量批处理窗口。这样既能让 seq 按调用顺序分配，
 * 又不会让持久化适配器与事件总线耦合。
 */
export class EventCoordinatedThreadStore implements ThreadStore {
  constructor(
    private readonly inner: RecoverableThreadStore,
    private readonly eventWriter: RuntimeEventWriter,
    private readonly generatedImageStore?: GeneratedImageStore,
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
    return this.afterPendingEventsWithImageCleanup(threadId, () => this.inner.deleteThread(threadId));
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
    return this.afterPendingEventsWithImageCleanup(threadId, () => this.inner.deleteMessages(threadId, input));
  }

  truncateMessagesAfter(threadId: string, messageId: string, includeSelf?: boolean) {
    return this.afterPendingEventsWithImageCleanup(
      threadId,
      () => this.inner.truncateMessagesAfter(threadId, messageId, includeSelf),
    );
  }

  clearThreadMessages(threadId: string) {
    return this.afterPendingEventsWithImageCleanup(threadId, () => this.inner.clearThreadMessages(threadId));
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

  async close(): Promise<void> {
    try {
      await this.eventWriter.flushAll();
    } finally {
      if (this.inner.close) {
        await this.inner.close();
      } else {
        await this.inner.flush();
      }
    }
  }

  private async afterPendingEvents<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    await this.eventWriter.flushThread(threadId);
    return operation();
  }

  private async afterPendingEventsWithImageCleanup<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    await this.eventWriter.flushThread(threadId);
    const generatedImageStore = this.generatedImageStore;
    if (!generatedImageStore) return operation();

    const before = await this.inner.getThread(threadId).catch(() => null);
    const result = await operation();
    try {
      const after = await this.inner.getThread(threadId);
      const remainingAssetIds = managedGeneratedImageAssetIds(after);
      const removedAssetIds = [...managedGeneratedImageAssetIds(before)]
        .filter((assetId) => !remainingAssetIds.has(assetId));
      if (!removedAssetIds.length) return result;

      const referencedAssetIds = await managedGeneratedImageAssetIdsFromStore(
        this.inner,
        new Set(removedAssetIds),
      );
      const unreferencedAssetIds = removedAssetIds.filter((assetId) => !referencedAssetIds.has(assetId));

      // The thread mutation has already committed. Cleanup is best-effort so callers never retry a
      // destructive mutation that actually succeeded. Startup recovery sweeps anything retained here.
      await Promise.allSettled(unreferencedAssetIds.map((assetId) => generatedImageStore.delete(assetId)));
    } catch {
      // Keep assets when reference scanning fails; deleting a still-referenced image is worse than an orphan.
    }
    return result;
  }
}
