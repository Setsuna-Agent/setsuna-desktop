import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { cleanStorageSelection } from '../../../../../src/features/settings/storage/storageCleanup.js';
import { RuntimeClientError } from '../../../../../src/services/runtime-client/runtimeClientErrors.js';

function thread(id: string, patch: Partial<RuntimeThreadSummary> = {}): RuntimeThreadSummary {
  return { id, title: id, createdAt: '2026-01-01', updatedAt: '2026-01-01', archived: false,
    messageCount: 1, lastMessagePreview: '', ...patch };
}

function fixture(threads: RuntimeThreadSummary[]) {
  return {
    client: {
      listThreads: vi.fn(async () => ({ threads })),
      deleteThread: vi.fn(async (_id: string): Promise<void> => undefined),
    },
    storage: { clearStorage: vi.fn(async () => ({ failedCategories: [] as ('cache' | 'logs')[] })) },
  };
}

describe('storage cleanup selection', () => {
  it('deletes only explicitly selected primary conversations after checking fresh running state', async () => {
    const { client, storage } = fixture([
      thread('selected'), thread('keep'), thread('running', { activeTurnId: 'turn' }),
      thread('child', { parentThreadId: 'keep' }), thread('feature', { featureId: 'automation' }),
    ]);
    const result = await cleanStorageSelection(client, storage, {
      threadIds: ['selected', 'selected', 'running', 'child', 'feature'], categories: [],
    });
    expect(client.listThreads).toHaveBeenCalledWith({ includeArchived: true });
    expect(client.deleteThread).toHaveBeenCalledExactlyOnceWith('selected');
    expect(result.failedThreadIds).toEqual(['running', 'child', 'feature']);
    expect(result.deletedThreadIds).toEqual(['selected']);
    expect(storage.clearStorage).not.toHaveBeenCalled();
  });

  it('stops the entire batch when the normal cross-window deletion guard is cancelled', async () => {
    const { client, storage } = fixture([thread('first'), thread('cancel'), thread('later')]);
    client.deleteThread.mockImplementation(async (id) => {
      if (id === 'cancel') throw new RuntimeClientError('thread_deletion_cancelled', 'Cancelled');
    });
    const result = await cleanStorageSelection(client, storage, {
      threadIds: ['first', 'cancel', 'later'], categories: ['cache'],
    });
    expect(client.deleteThread.mock.calls).toEqual([['first'], ['cancel']]);
    expect(result).toMatchObject({ cancelled: true, deletedThreadIds: ['first'], remainingCategories: ['cache'] });
    expect(storage.clearStorage).not.toHaveBeenCalled();
  });

  it('retains only unfinished work after partial deletion and cache failures', async () => {
    const { client, storage } = fixture([thread('failed'), thread('success')]);
    client.deleteThread.mockRejectedValueOnce(new Error('busy'));
    storage.clearStorage.mockRejectedValueOnce(new Error('disconnected'));
    const result = await cleanStorageSelection(client, storage, {
      threadIds: ['gone', 'failed', 'success'], categories: ['logs'],
    });
    expect(client.deleteThread.mock.calls).toEqual([['failed'], ['success']]);
    expect(result).toEqual({ deletedThreadIds: ['gone', 'success'], failedThreadIds: ['failed'],
      remainingCategories: ['logs'], cancelled: false });
  });

  it('clears caches without depending on a conversation inventory', async () => {
    const { client, storage } = fixture([]);
    client.listThreads.mockRejectedValueOnce(new Error('runtime unavailable'));
    await cleanStorageSelection(client, storage, { threadIds: [], categories: ['cache', 'logs'] });
    expect(client.listThreads).not.toHaveBeenCalled();
    expect(storage.clearStorage).toHaveBeenCalledExactlyOnceWith(['cache', 'logs']);
  });
});
