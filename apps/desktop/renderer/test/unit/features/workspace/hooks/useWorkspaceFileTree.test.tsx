// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspaceFileTree } from '../../../../../src/features/workspace/hooks/useWorkspaceFileTree.js';

afterEach(cleanup);

it('coalesces changes during a background refresh and keeps the last tree visible on failure', async () => {
  const response = (paths: string[]): WorkspaceEntrySearchResponse => ({
    entries: paths.map((path) => ({ kind: 'file', name: path, path, parent: '' })),
    query: '', scanned: paths.length, truncated: false, workspaceRoot: '/repo',
  });
  let finishRefresh!: (value: WorkspaceEntrySearchResponse) => void;
  const pendingRefresh = new Promise<WorkspaceEntrySearchResponse>((resolve) => { finishRefresh = resolve; });
  const searchEntries = vi.fn().mockResolvedValueOnce(response(['keep.ts']))
    .mockReturnValueOnce(pendingRefresh).mockResolvedValueOnce(response(['keep.ts', 'README.md']))
    .mockRejectedValueOnce(new Error('temporarily unavailable'));
  let changed!: () => void;
  const unsubscribe = vi.fn();
  const watchEntries = vi.fn((_paths: string[], callback: () => void) => { changed = callback; return unsubscribe; });
  const view = renderHook(() => useWorkspaceFileTree({ workspaceKey: '/repo', enabled: true, searchEntries, watchEntries }));
  await waitFor(() => expect(watchEntries).toHaveBeenCalledOnce());
  act(() => { changed(); changed(); changed(); });
  expect(searchEntries).toHaveBeenCalledTimes(2);
  expect(view.result.current.treeSearching).toBe(false);
  expect(view.result.current.treeEntries.map((entry) => entry.path)).toEqual(['keep.ts']);
  await act(async () => { finishRefresh(response(['keep.ts'])); await pendingRefresh; });
  await waitFor(() => expect(view.result.current.treeEntries.map((entry) => entry.path)).toContain('README.md'));
  expect(searchEntries).toHaveBeenCalledTimes(3);
  act(() => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(searchEntries).toHaveBeenCalledTimes(4));
  expect(view.result.current.treeEntries.map((entry) => entry.path)).toContain('README.md');
  expect(view.result.current.treeError).toBeNull();
  view.unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
  changed();
  expect(searchEntries).toHaveBeenCalledTimes(4);
});

it.each(['rename', 'delete'])('updates descendants and pending directory reads after a folder %s', async (operation) => {
  let finishOldRead!: (result: WorkspaceEntrySearchResponse) => void;
  const pendingRead = new Promise<WorkspaceEntrySearchResponse>((resolve) => { finishOldRead = resolve; });
  const response = (paths: string[]): WorkspaceEntrySearchResponse => ({
    entries: paths.map((path) => ({ kind: path.endsWith('.ts') ? 'file' : 'directory', path,
      name: path.split('/').pop()!, parent: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' })),
    query: '', scanned: paths.length, truncated: false, workspaceRoot: '/repo',
  });
  const searchEntries = vi.fn(async (_query = '', parent?: string | null) => {
    if (parent === 'src') return response(['src/main.ts', 'src/nested']);
    if (parent === 'src/nested') return pendingRead;
    if (parent === 'lib/nested') return response(['lib/nested/current.ts']);
    return response(['src', 'src-extra']);
  });
  const view = renderHook(() => useWorkspaceFileTree({ workspaceKey: '/repo', enabled: true, searchEntries }));
  await waitFor(() => expect(view.result.current.loadedQuery).toBe(''));
  act(() => view.result.current.toggleDirectory('src'));
  await waitFor(() => expect(view.result.current.loadedDirectoryPaths.has('src')).toBe(true));
  act(() => view.result.current.toggleDirectory('src/nested'));
  if (operation === 'rename') {
    act(() => view.result.current.applyEntryChange({ path: 'lib', name: 'lib', type: 'directory' }, 'src'));
    await waitFor(() => expect(view.result.current.loadedDirectoryPaths.has('lib/nested')).toBe(true));
  } else act(() => view.result.current.applyEntryDeletion('src'));
  await act(async () => { finishOldRead(response(['src/nested/stale.ts'])); await pendingRead; });
  expect([...view.result.current.expandedPaths].sort()).toEqual(operation === 'rename' ? ['lib', 'lib/nested'] : []);
  expect(view.result.current.treeEntries.map((entry) => entry.path).sort()).toEqual(operation === 'rename' ? [
    'lib', 'lib/main.ts', 'lib/nested', 'lib/nested/current.ts', 'src-extra',
  ] : ['src-extra']);
  expect(view.result.current.loadingDirectoryPaths.size).toBe(0);
});

it('restores the listing when an in-flight filter is cleared', async () => {
  let finishSearch!: (result: WorkspaceEntrySearchResponse) => void;
  const pendingSearch = new Promise<WorkspaceEntrySearchResponse>((resolve) => { finishSearch = resolve; });
  const root: WorkspaceEntrySearchResponse = {
    entries: [{ kind: 'directory', path: 'src', name: 'src', parent: '' }],
    query: '', scanned: 1, truncated: false, workspaceRoot: '/repo',
  };
  const searchEntries = vi.fn(async (query = '') => query ? pendingSearch : root);
  const view = renderHook(() => useWorkspaceFileTree({ workspaceKey: '/repo', enabled: true, searchEntries }));
  await waitFor(() => expect(view.result.current.loadedQuery).toBe(''));
  act(() => view.result.current.updateTreeQuery('pending'));
  expect(view.result.current.treeSearching).toBe(true);
  act(() => view.result.current.updateTreeQuery(''));
  await waitFor(() => expect(view.result.current.treeSearching).toBe(false));
  await act(async () => {
    finishSearch({ ...root, query: 'pending', entries: [] });
    await pendingSearch;
  });
  expect(view.result.current.tree.map((node) => node.path)).toEqual(['src']);
  expect(view.result.current.loadedQuery).toBe('');
});

it.each(['workspace', 'query'])('ignores an expanded directory response after the %s changes', async (change) => {
  let resolveDirectory!: (result: WorkspaceEntrySearchResponse) => void;
  const pendingDirectory = new Promise<WorkspaceEntrySearchResponse>((resolve) => { resolveDirectory = resolve; });
  const root: WorkspaceEntrySearchResponse = {
    entries: [{ kind: 'directory', path: 'src', name: 'src', parent: '' }],
    query: '', scanned: 1, truncated: false, workspaceRoot: '/repo',
  };
  const searchEntries = vi.fn(async (query = '', parent?: string | null) => (
    parent === 'src' ? pendingDirectory : { ...root, query }
  ));
  const view = renderHook(({ workspaceKey }) => useWorkspaceFileTree({
    workspaceKey, enabled: true, searchEntries,
  }), { initialProps: { workspaceKey: 'workspace_a' } });
  await waitFor(() => expect(view.result.current.loadedQuery).toBe(''));
  act(() => view.result.current.toggleDirectory('src'));

  if (change === 'workspace') view.rerender({ workspaceKey: 'workspace_b' });
  else act(() => view.result.current.updateTreeQuery('new'));
  await waitFor(() => expect(view.result.current.loadedQuery).toBe(change === 'workspace' ? '' : 'new'));

  await act(async () => {
    resolveDirectory({
      ...root,
      entries: [{ kind: 'file', path: 'src/stale.ts', name: 'stale.ts', parent: 'src' }],
    });
    await pendingDirectory;
  });
  expect(view.result.current.treeEntries).toEqual(root.entries.map(({ name, path, kind }) => ({ name, path, type: kind })));
  expect(view.result.current.loadingDirectoryPaths.size).toBe(0);
  if (change === 'workspace') expect(view.result.current.expandedPaths.size).toBe(0);
});
