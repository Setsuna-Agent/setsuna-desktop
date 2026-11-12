// @vitest-environment happy-dom
import { DESKTOP_STORAGE_CATEGORY_IDS, type DesktopStorageUsage, type RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStorageUsageCache } from '../../../../../src/features/settings/storage/storageUsageCache.js';
import { useStorageManagement } from '../../../../../src/features/settings/storage/useStorageManagement.js';

const { getStorageUsage, listThreads, deleteThread } = vi.hoisted(() => ({
  getStorageUsage: vi.fn<() => Promise<DesktopStorageUsage>>(),
  listThreads: vi.fn<() => Promise<{ threads: RuntimeThreadSummary[] }>>(),
  deleteThread: vi.fn<() => Promise<void>>(),
}));
vi.mock('../../../../../src/services/runtime-client/client.js', () => ({
  createDesktopRuntimeClient: () => ({ listThreads, deleteThread }),
}));

function usage(totalBytes: number): DesktopStorageUsage {
  return { totalBytes, incomplete: false,
    categories: DESKTOP_STORAGE_CATEGORY_IDS.map((id) => ({ id, totalBytes: id === 'cache' ? totalBytes : 0 })) };
}
function thread(id: string): RuntimeThreadSummary {
  return { id, title: id, createdAt: '2026-01-01', updatedAt: '2026-01-01', archived: false,
    messageCount: 1, lastMessagePreview: '' };
}

const pending: Array<{ finish(): void; promise: Promise<unknown> }> = [];
function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  pending.push({ finish: () => resolve(fallback), promise });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getStorageUsage.mockResolvedValue(usage(500));
  listThreads.mockResolvedValue({ threads: [thread('first'), thread('keep')] });
  deleteThread.mockResolvedValue(undefined);
  vi.stubGlobal('setsunaDesktop', { dataRoot: { getStorageUsage } });
});
afterEach(async () => {
  cleanup();
  pending.forEach((request) => request.finish());
  await Promise.allSettled(pending.map((request) => request.promise));
  pending.length = 0;
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('storage page loading', () => {
  it.each(['usage', 'threads'] as const)('publishes %s without waiting for the other operation', async (first) => {
    const scan = deferred(usage(500));
    const inventory = deferred({ threads: [thread('first')] });
    getStorageUsage.mockReturnValueOnce(scan.promise);
    listThreads.mockReturnValueOnce(inventory.promise);
    const { result } = renderHook(() => useStorageManagement('/data/current'));
    expect(getStorageUsage).toHaveBeenCalledOnce();
    expect(listThreads).toHaveBeenCalledOnce();

    if (first === 'usage') {
      await act(async () => scan.resolve(usage(500)));
      expect(result.current).toMatchObject({ usage: usage(500), loading: false, threadsReady: false });
    } else {
      await act(async () => inventory.resolve({ threads: [thread('first')] }));
      expect(result.current).toMatchObject({ threads: [thread('first')], threadsReady: true, usage: null, loading: true });
    }
    await act(async () => { scan.resolve(usage(500)); inventory.resolve({ threads: [thread('first')] }); });
    expect(result.current).toMatchObject({ loading: false, threadsReady: true });
  });

  it('keeps a scan completed after leaving, and retains it across a failed refresh until retry succeeds', async () => {
    const scan = deferred(usage(500));
    getStorageUsage.mockReturnValueOnce(scan.promise);
    const first = renderHook(() => useStorageManagement('/data/current'));
    expect(getStorageUsage).toHaveBeenCalledOnce();
    first.unmount();
    await act(async () => scan.resolve(usage(500)));

    const refresh = deferred(usage(800));
    getStorageUsage.mockReturnValueOnce(refresh.promise);
    const next = renderHook(() => useStorageManagement('/data/current'));
    expect(next.result.current).toMatchObject({ usage: usage(500), loading: true });
    await act(async () => refresh.reject(new Error('Disk unavailable')));
    expect(next.result.current).toMatchObject({ usage: usage(500), loading: false, error: 'Disk unavailable' });

    getStorageUsage.mockResolvedValueOnce(usage(800));
    await act(async () => next.result.current.refresh());
    expect(next.result.current).toMatchObject({ usage: usage(800), loading: false, error: null });
    expect(readStorageUsageCache('/data/current')).toEqual(usage(800));
  });

  it('isolates roots and prevents an older scan from replacing the new root snapshot', async () => {
    const oldScan = deferred(usage(100));
    getStorageUsage.mockReturnValueOnce(oldScan.promise);
    const old = renderHook(() => useStorageManagement('/data/old'));
    expect(getStorageUsage).toHaveBeenCalledOnce();
    old.unmount();

    const next = renderHook(() => useStorageManagement('/data/new'));
    await waitFor(() => expect(next.result.current).toMatchObject({ usage: usage(500), loading: false }));
    await act(async () => oldScan.resolve(usage(100)));
    expect(next.result.current.usage).toEqual(usage(500));
    expect(readStorageUsageCache('/data/new')).toEqual(usage(500));
    expect(readStorageUsageCache('/data/old')).toBeNull();
  });

  it('finishes deletion and removes deleted selections while the background recount is blocked', async () => {
    const { result } = renderHook(() => useStorageManagement('/data/current'));
    await waitFor(() => expect(result.current).toMatchObject({ loading: false, threadsReady: true }));
    const recount = deferred(usage(200));
    const inventory = deferred({ threads: [thread('keep')] });
    getStorageUsage.mockReturnValueOnce(recount.promise);
    // Cleanup checks fresh running state before deleting, then refreshes the inventory separately.
    listThreads.mockResolvedValueOnce({ threads: [thread('first'), thread('keep')] })
      .mockReturnValueOnce(inventory.promise);
    await act(async () => {
      const outcome = await result.current.cleanup({ threadIds: ['first'], categories: [] });
      expect(outcome?.deletedThreadIds).toEqual(['first']);
    });
    expect(getStorageUsage).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ working: false, loading: true, usage: usage(500), threads: [thread('keep')] });

    await act(async () => { recount.resolve(usage(200)); inventory.resolve({ threads: [thread('keep')] }); });
    expect(result.current).toMatchObject({ working: false, loading: false, usage: usage(200), threads: [thread('keep')] });
  });
});
