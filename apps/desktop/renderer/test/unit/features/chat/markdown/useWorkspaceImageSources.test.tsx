// @vitest-environment happy-dom

import type { DesktopWorkspaceFilePreviewResult, WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';
import { useWorkspaceImageSources } from '../../../../../src/features/chat/markdown/useWorkspaceImageSources.js';

afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'setsunaDesktop'); });

function listing(root: string, paths: string[]): WorkspaceEntrySearchResponse {
  return { workspaceRoot: root, query: '', scanned: paths.length, truncated: false,
    entries: paths.map((path) => ({ name: path, path, parent: '', kind: 'file' })) };
}
function preview(id: string) {
  return { ok: true as const, previewId: id, url: `http://127.0.0.1:1234/preview/${id}` };
}
function installBridge(create: (...args: [string, string]) => Promise<DesktopWorkspaceFilePreviewResult>, watch = vi.fn()) {
  const release = vi.fn(async (_previewId: string) => true);
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: {
    createWorkspaceFilePreview: create, releaseWorkspaceFilePreview: release, watchWorkspaceEntries: watch,
  } } });
  return release;
}

it('registers only new images as 24 sources stream in and releases only removed or unmounted images', async () => {
  const paths = Array.from({ length: 24 }, (_, index) => `image-${index}.png`);
  const create = vi.fn(async (_root: string, path: string) => preview(path));
  const stop = vi.fn();
  const watch = vi.fn(() => stop);
  const release = installBridge(create, watch);
  const search = vi.fn(async () => listing('/workspace', paths));
  const view = renderHook(({ sources }) => useWorkspaceImageSources(sources), {
    initialProps: { sources: [] as string[] },
    wrapper: ({ children }) => <MarkdownNavigationProvider workspaceRoot="/workspace" onSearchWorkspaceEntries={search}>{children}</MarkdownNavigationProvider>,
  });
  for (let count = 1; count <= paths.length; count += 1) {
    view.rerender({ sources: paths.slice(0, count) });
    await waitFor(() => expect(view.result.current.get(paths[count - 1])?.source).toBe(preview(paths[count - 1]).url));
  }
  view.rerender({ sources: [...paths].reverse().concat(paths[0], `file:///workspace/${paths[0]}`) });
  expect(create).toHaveBeenCalledTimes(24);
  expect(search).toHaveBeenCalledOnce();
  expect(watch).toHaveBeenCalledOnce();
  expect(release).not.toHaveBeenCalled();
  view.rerender({ sources: [paths[0]] });
  await waitFor(() => expect(release).toHaveBeenCalledTimes(23));
  expect(view.result.current.get(paths[0])?.source).toBe(preview(paths[0]).url);
  expect(release).not.toHaveBeenCalledWith(paths[0]);
  view.unmount();
  expect(release).toHaveBeenCalledTimes(24);
  expect(new Set(release.mock.calls.map(([id]) => id)).size).toBe(24);
  expect(stop).toHaveBeenCalledOnce();
});

it('reuses pending requests and releases late registrations after removal, workspace changes and unmount', async () => {
  const pending: Array<(value: DesktopWorkspaceFilePreviewResult) => void> = [];
  const create = vi.fn(() => new Promise<DesktopWorkspaceFilePreviewResult>((resolve) => { pending.push(resolve); }));
  const release = installBridge(create);
  let root = '/workspace';
  const search = vi.fn(async () => listing(root, ['a.png', 'b.png']));
  const view = renderHook(({ sources }) => useWorkspaceImageSources(sources), {
    initialProps: { sources: ['a.png'] },
    wrapper: ({ children }) => <MarkdownNavigationProvider workspaceRoot={root} onSearchWorkspaceEntries={search}>{children}</MarkdownNavigationProvider>,
  });
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  view.rerender({ sources: ['a.png', 'b.png'] });
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  view.rerender({ sources: ['b.png'] });
  await act(async () => pending[0](preview('removed')));
  expect(release).toHaveBeenCalledExactlyOnceWith('removed');
  view.rerender({ sources: ['a.png', 'b.png'] });
  await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
  root = '/other';
  view.rerender({ sources: ['a.png', 'b.png'] });
  await waitFor(() => expect(create).toHaveBeenCalledTimes(5));
  await act(async () => { pending[1](preview('old-b')); pending[2](preview('old-a')); });
  expect(release).toHaveBeenCalledWith('old-b');
  expect(release).toHaveBeenCalledWith('old-a');
  expect(view.result.current.get('a.png')?.source).toBeUndefined();
  await act(async () => pending[3](preview('current')));
  expect(view.result.current.get('a.png')?.source).toBe(preview('current').url);
  view.unmount();
  expect(release).toHaveBeenCalledWith('current');
  await act(async () => pending[4](preview('closed')));
  expect(release).toHaveBeenCalledWith('closed');
  expect(release).toHaveBeenCalledTimes(5);
});

it('revokes a deleted file and acquires a fresh preview when the file is recreated', async () => {
  let paths = ['image.png'];
  const search = vi.fn(async () => listing('/workspace', paths));
  let changed!: () => void;
  const watch = vi.fn((_root: string, _paths: string[], listener: () => void) => { changed = listener; return () => undefined; });
  let registrations = 0;
  const create = vi.fn(async () => preview(String(++registrations)));
  const release = installBridge(create, watch);
  const view = renderHook(() => useWorkspaceImageSources(['image.png']), {
    wrapper: ({ children }) => <MarkdownNavigationProvider workspaceRoot="/workspace" onSearchWorkspaceEntries={search}>{children}</MarkdownNavigationProvider>,
  });
  await waitFor(() => expect(view.result.current.get('image.png')?.source).toBe(preview('1').url));
  paths = [];
  act(() => changed());
  await waitFor(() => expect(release).toHaveBeenCalledExactlyOnceWith('1'));
  expect(view.result.current.get('image.png')?.source).toBeUndefined();
  paths = ['image.png'];
  act(() => changed());
  await waitFor(() => expect(view.result.current.get('image.png')?.source).toBe(preview('2').url));
  view.unmount();
  expect(release).toHaveBeenCalledWith('2');
});
