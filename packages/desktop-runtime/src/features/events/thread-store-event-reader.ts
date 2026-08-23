import type { ThreadEventReader } from '@setsuna-desktop/feature-core/runtime';
import type { ThreadStore } from '../../ports/thread-store.js';

/** Fixed-watermark adapter over the append-only Core ThreadStore. */
export class ThreadStoreEventReader implements ThreadEventReader {
  constructor(private readonly store: Pick<ThreadStore, 'getThread' | 'readEventPage'>) {}

  async highWater(threadId: string): Promise<number> {
    const thread = await this.store.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread.lastSeq;
  }

  async readPage(
    threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
  ) {
    const records = await this.store.readEventPage(threadId, input);
    return Object.freeze({ records, throughSeq: input.throughSeq });
  }
}
