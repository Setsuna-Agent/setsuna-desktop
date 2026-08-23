import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ThreadStoreEventReader } from '../../../src/features/events/thread-store-event-reader.js';

describe('ThreadStoreEventReader', () => {
  it('delegates fixed-watermark page bounds to the ThreadStore', async () => {
    const records = [{ seq: 6 }] as StoredThreadEvent[];
    const store = {
      getThread: vi.fn(),
      readEventPage: vi.fn().mockResolvedValue(records),
    };
    const reader = new ThreadStoreEventReader(store);

    await expect(reader.readPage('thread-1', {
      afterSeq: 5,
      throughSeq: 12,
      limit: 3,
    })).resolves.toEqual({ records, throughSeq: 12 });
    expect(store.readEventPage).toHaveBeenCalledWith('thread-1', {
      afterSeq: 5,
      throughSeq: 12,
      limit: 3,
    });
  });
});
