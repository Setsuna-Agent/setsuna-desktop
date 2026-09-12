// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import type { WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { UIEvent } from 'react';
import { expect, it, vi } from 'vitest';
import { useWorkspaceFileTree } from '../../src/features/workspace/hooks/useWorkspaceFileTree.js';

it('reflects external creates, renames and deletes without resetting the shared navigator', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-tree-sync-'));
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await writeFile(path.join(root, 'src', 'nested', 'old.ts'), 'original');
  const searchEntries = vi.fn(async (query = '', parent = ''): Promise<WorkspaceEntrySearchResponse> => {
    const entries = await readdir(path.join(root, parent), { withFileTypes: true });
    return {
      entries: entries.map((entry) => ({ kind: entry.isDirectory() ? 'directory' : 'file', name: entry.name,
        path: parent ? `${parent}/${entry.name}` : entry.name, parent })),
      query, scanned: entries.length, truncated: false, workspaceRoot: root,
    };
  });
  let watchedPaths: string[] = [];
  let changed = () => {};
  const watchEntries = (directoryPaths: string[], callback: () => void) => {
    watchedPaths = directoryPaths;
    changed = callback;
    return () => { changed = () => {}; };
  };
  const view = renderHook(() => useWorkspaceFileTree({ workspaceKey: root, enabled: true, searchEntries, watchEntries }));
  try {
    await waitFor(() => expect(view.result.current.treeEntries.map((entry) => entry.path)).toContain('src'));
    act(() => view.result.current.toggleDirectory('src'));
    await waitFor(() => expect(view.result.current.treeEntries.map((entry) => entry.path)).toContain('src/nested'));
    act(() => view.result.current.toggleDirectory('src/nested'));
    await waitFor(() => expect(watchedPaths).toContain('src/nested'));
    await waitFor(() => expect(view.result.current.loadingDirectoryPaths.size).toBe(0));
    act(() => {
      view.result.current.setTreeWidth(300);
      view.result.current.onFileListScroll({ currentTarget: { scrollTop: 240 } } as UIEvent<HTMLDivElement>);
    });

    await writeFile(path.join(root, 'README.md'), '# Created by a tool');
    await writeFile(path.join(root, 'src', 'new.vue'), '<template />');
    act(changed);
    await waitFor(() => {
      expect(view.result.current.treeEntries.map((entry) => entry.path)).toEqual(expect.arrayContaining(['README.md', 'src/new.vue']));
    });
    expect(view.result.current.treeSearching).toBe(false);
    expect([...view.result.current.expandedPaths]).toEqual(['src', 'src/nested']);
    expect(view.result.current.treeWidth).toBe(300);
    const list = document.createElement('div');
    view.result.current.fileListRef(list);
    expect(list.scrollTop).toBe(240);

    await rename(path.join(root, 'src', 'nested'), path.join(root, 'src', 'renamed'));
    await rm(path.join(root, 'README.md'));
    act(changed);
    await waitFor(() => {
      const paths = view.result.current.treeEntries.map((entry) => entry.path);
      expect(paths).toContain('src/renamed');
      expect(paths).not.toContain('README.md');
      expect(paths.some((entry) => entry.startsWith('src/nested'))).toBe(false);
    });
    expect(view.result.current.expandedPaths.has('src')).toBe(true);
    expect(view.result.current.treeError).toBeNull();
  } finally {
    view.unmount();
    await rm(root, { recursive: true, force: true });
  }
});
