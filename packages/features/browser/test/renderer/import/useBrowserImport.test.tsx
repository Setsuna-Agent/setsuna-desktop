// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserDesktopBridge } from '../../../src/contracts/bridge.js';
import type { BrowserImportPreview } from '../../../src/contracts/import.js';
import { BOOKMARK_BAR_ID, emptyBookmarkTree } from '../../../src/contracts/bookmark-tree.js';
import { useBrowserImport } from '../../../src/renderer/import/useBrowserImport.js';
import { BROWSER_BOOKMARKS_STORAGE_KEY, readBrowserBookmarkTree } from '../../../src/renderer/browserBookmarks.js';
import { translateBrowserMessage } from '../../../src/renderer/messages.js';

const t = (key: Parameters<typeof translateBrowserMessage>[1]) => translateBrowserMessage('en-US', key);
const id = 'a'.repeat(32); const secondId = 'b'.repeat(32);
const preview: BrowserImportPreview = { bookmarks: { version: 2, nodes: [...emptyBookmarkTree().nodes,
  { id: 'imported', parentId: BOOKMARK_BAR_ID, type: 'bookmark', title: 'Example', url: 'https://example.test/', dateAdded: 0 },
] }, extensions: [id, secondId].map((value) => ({ id: value, name: value === id ? 'First' : 'Second', enabled: true, compatible: true, installed: false })) };

afterEach(() => { cleanup(); window.localStorage.removeItem(BROWSER_BOOKMARKS_STORAGE_KEY); });

function bridge(overrides = {}) {
  return {
    listBrowserImportProfiles: vi.fn(async () => [{ id: 'chrome:Default', browser: 'chrome', name: 'Personal' }, { id: 'edge:Default', browser: 'edge', name: 'Work' }]),
    previewBrowserImport: vi.fn(async () => preview),
    importBrowserExtensions: vi.fn(async () => ({ imported: [id], skipped: [], failed: [secondId] })),
    chooseBrowserBookmarkFile: vi.fn(async () => null),
    ...overrides,
  } as unknown as BrowserDesktopBridge;
}

it('merges favorites and preserves only failed extensions for retry, without repeating concurrent imports', async () => {
  const native = bridge();
  const { result } = renderHook(() => useBrowserImport(native, t));
  await waitFor(() => expect(result.current.preview).toEqual(preview));
  await act(async () => { await Promise.all([result.current.importSelected(), result.current.importSelected()]); });
  expect(native.importBrowserExtensions).toHaveBeenCalledExactlyOnceWith('chrome:Default', [id, secondId]);
  expect(readBrowserBookmarkTree().nodes.find((node) => node.id === 'imported')).toMatchObject({ title: 'Example' });
  expect(result.current.selected).toEqual([secondId]);
  expect(result.current.preview?.extensions.find((item) => item.id === id)?.installed).toBe(true);
  expect(result.current.notice).toMatchObject({ tone: 'warning', message: expect.stringContaining('Second') });
  vi.mocked(native.importBrowserExtensions).mockRejectedValueOnce(new Error('reply lost'));
  await act(async () => { await result.current.importSelected(); });
  expect(result.current.notice).toMatchObject({ tone: 'warning', message: expect.stringContaining('Extension import did not finish') });
  expect(readBrowserBookmarkTree().nodes.filter((node) => node.type === 'bookmark')).toHaveLength(1);
});

it('does not import extensions or overwrite data when the current favorites store is corrupt', async () => {
  const native = bridge();
  const { result } = renderHook(() => useBrowserImport(native, t));
  await waitFor(() => expect(result.current.preview).toEqual(preview));
  window.localStorage.setItem(BROWSER_BOOKMARKS_STORAGE_KEY, '{broken');
  await act(async () => { await result.current.importSelected(); });
  expect(native.importBrowserExtensions).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(BROWSER_BOOKMARKS_STORAGE_KEY)).toBe('{broken');
  expect(result.current.notice?.tone).toBe('error');
});

it('ignores an old profile response after selection changes and leaves data untouched when file selection is cancelled', async () => {
  let resolveOld!: (data: BrowserImportPreview) => void;
  const old = new Promise<BrowserImportPreview>((resolve) => { resolveOld = resolve; });
  const newer = { ...preview, extensions: [preview.extensions[1]] };
  const native = bridge({ previewBrowserImport: vi.fn((profileId: string) => profileId === 'chrome:Default' ? old : Promise.resolve(newer)) });
  const { result } = renderHook(() => useBrowserImport(native, t));
  await waitFor(() => expect(result.current.profileId).toBe('chrome:Default'));
  act(() => result.current.selectProfile('edge:Default'));
  await waitFor(() => expect(result.current.preview).toEqual(newer));
  await act(async () => { resolveOld(preview); await old; });
  expect(result.current.preview).toEqual(newer);
  expect(result.current.selected).toEqual([secondId]);
  await act(async () => { await result.current.importHtml(); });
  expect(native.chooseBrowserBookmarkFile).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem(BROWSER_BOOKMARKS_STORAGE_KEY)).toBeNull();
  expect(result.current.notice).toBeNull();
});
