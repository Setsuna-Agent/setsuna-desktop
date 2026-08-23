import type { ThreadEventReader } from '@setsuna-desktop/feature-core/runtime';
import type { ThreadStore } from '../../ports/thread-store.js';

/** Fixed-watermark adapter over the append-only Core ThreadStore. */
export class ThreadStoreEventReader implements ThreadEventReader {
  constructor(private readonly store: Pick<ThreadStore, 'getThread' | 'listEvents'>) {}

  async highWater(threadId: string): Promise<number> {
    const thread = await this.store.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread.lastSeq;
  }

  async readPage(
    threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
  ) {
    const records = (await this.store.listEvents(threadId, input.afterSeq))
      .filter((record) => record.seq <= input.throughSeq)
      .slice(0, input.limit);
    return Object.freeze({ records, throughSeq: input.throughSeq });
  }
}
