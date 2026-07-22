import { describe, expect, it, vi } from 'vitest';
import { managedGeneratedImageAssetIdsFromStore } from '../../src/utils/generated-image-assets.js';

describe('generated image asset reference scanning', () => {
  it('stops loading thread snapshots once every candidate asset is found', async () => {
    const getThread = vi.fn(async (threadId: string) => ({
      messages: threadId === 'thread_first'
        ? [{
            id: 'msg_1',
            role: 'assistant' as const,
            content: '',
            createdAt: '2026-07-17T00:00:00.000Z',
            attachments: [{
              id: 'attachment_1',
              source: 'generated' as const,
              assetId: 'generated_candidate',
              name: 'generated.png',
              type: 'image/png',
              size: 68,
              modelVisible: false as const,
            }],
          }]
        : [],
    }));
    const store = {
      listThreads: vi.fn(async () => [{ id: 'thread_first' }, { id: 'thread_large_history' }]),
      getThread,
    };

    await expect(managedGeneratedImageAssetIdsFromStore(
      store,
      new Set(['generated_candidate']),
    )).resolves.toEqual(new Set(['generated_candidate']));
    expect(getThread).toHaveBeenCalledTimes(1);
    expect(getThread).toHaveBeenCalledWith('thread_first');
  });
});
