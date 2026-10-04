import { describe, expect, it, vi } from 'vitest';
import { managedGeneratedImageAssetIdsFromStore } from '../../src/utils/generated-image-assets.js';

describe('generated image asset reference scanning', () => {
  it('does not read any history when there are no local image candidates', async () => {
    const store = { listThreads: vi.fn(), getThread: vi.fn() };
    await expect(managedGeneratedImageAssetIdsFromStore(store, new Set())).resolves.toEqual(new Set());
    expect(store.listThreads).not.toHaveBeenCalled();
    expect(store.getThread).not.toHaveBeenCalled();
  });

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

  it('uses message projections to retain legacy images and checks all threads for missing candidates', async () => {
    const store = {
      listThreads: vi.fn(async () => [{ id: 'empty' }, { id: 'legacy' }]),
      getThread: vi.fn(),
      getSamplingState: vi.fn(async (threadId: string) => ({
        messages: threadId === 'empty' ? [] : [{
          id: 'legacy_message', role: 'assistant' as const, content: '', createdAt: '2026-07-17T00:00:00.000Z',
          attachments: [{ id: 'legacy_attachment', name: 'legacy.png', type: 'image/png', size: 68,
            url: 'data:image/png;base64,legacy', localAssetId: 'legacy_image' }],
        }],
      })),
    };
    await expect(managedGeneratedImageAssetIdsFromStore(store, new Set(['orphan', 'legacy_image'])))
      .resolves.toEqual(new Set(['legacy_image']));
    expect(store.listThreads).toHaveBeenCalledWith({ includeArchived: true, includeSide: true, includeFeatures: true });
    expect(store.getSamplingState).toHaveBeenCalledTimes(2);
    expect(store.getThread).not.toHaveBeenCalled();
  });

  it('uses checkpoint references without reading messages and preserves the candidate boundary', async () => {
    const store = {
      listThreads: vi.fn(async () => [{ id: 'first' }, { id: 'second' }]),
      getThread: vi.fn(), getSamplingState: vi.fn(),
      getGeneratedImageAssetIds: vi.fn(async () => ['retained', 'unrelated']),
    };
    await expect(managedGeneratedImageAssetIdsFromStore(store, new Set(['retained'])))
      .resolves.toEqual(new Set(['retained']));
    expect(store.getGeneratedImageAssetIds).toHaveBeenCalledTimes(1);
    expect(store.getSamplingState).not.toHaveBeenCalled();
    expect(store.getThread).not.toHaveBeenCalled();
  });
});
