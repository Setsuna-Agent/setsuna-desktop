import type { FeatureProjectionCheckpoints, ThreadEventReader } from '@setsuna-desktop/feature-core/runtime';
import type { ThreadStore } from '../../ports/thread-store.js';

/** Fixed-watermark adapter over the append-only Core ThreadStore. */
export class ThreadStoreEventReader implements ThreadEventReader {
  constructor(private readonly store: Pick<ThreadStore, 'readEventPage'> & {
    getThreadLastSeq(threadId: string): Promise<number>;
    readonly projectionCheckpoints?: FeatureProjectionCheckpoints;
  }) {}

  get checkpoints(): FeatureProjectionCheckpoints | undefined {
    return this.store.projectionCheckpoints;
  }

  async highWater(threadId: string): Promise<number> {
    return this.store.getThreadLastSeq(threadId);
  }

  async readPage(
    threadId: string,
    input: Readonly<{ afterSeq: number; throughSeq: number; limit: number }>,
  ) {
    const records = await this.store.readEventPage(threadId, input);
    return Object.freeze({ records, throughSeq: input.throughSeq });
  }
}
