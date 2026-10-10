// @vitest-environment happy-dom

import type { WorkspaceEntrySearchItem, WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MarkdownContentBlock } from '../../../../../src/features/chat/markdown/MarkdownContentBlock.js';
import { MarkdownNavigationProvider } from '../../../../../src/features/chat/markdown/MarkdownNavigationProvider.js';
import { WorkspaceFileContextMenu, type WorkspaceFileContextTarget } from '../../../../../src/features/workspace/WorkspaceFileContextMenu.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'setsunaDesktop');
});

function entry(path: string, kind: WorkspaceEntrySearchItem['kind'] = 'file'): WorkspaceEntrySearchItem {
  return { path, kind, name: path.split('/').at(-1)!, parent: path.slice(0, Math.max(0, path.lastIndexOf('/'))) };
}

function listing(entries: WorkspaceEntrySearchItem[], workspaceRoot = '/workspace'): WorkspaceEntrySearchResponse {
  return { entries, workspaceRoot, query: '', scanned: entries.length, truncated: false };
}

it('links only verified files, preserving commands and missing paths while batching queries by directory', async () => {
  const files = [entry('README.md'), entry('src', 'directory'), entry('template.ts', 'directory'),
    entry('src/main.ts'), entry('docs/My Notes.md'), entry('assets/diagram.png')];
  const search = vi.fn(async (_query = '', parent: string | null = '') => listing(files.filter((file) => file.parent === parent)));
  const open = vi.fn();
  const openMenu = vi.fn();
  const preview = vi.fn(async () => ({ ok: true, url: 'http://127.0.0.1:1234/preview/image' }));
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: { createWorkspaceFilePreview: preview } } });
  const content = [
    '`?? README.md` and `node --experimental-strip-types scripts/snake-logic.test.mjs`',
    '`README.md:12` and `src/main.ts#L8` and `missing.md` and `template.ts` and `process.env`',
    '[`src/main.ts`](src/main.ts:20) [notes](docs/My%20Notes.md#L3) [directory](src/)',
    '![diagram](assets/diagram.png) ![missing image](assets/missing.png)',
  ].join('\n\n');
  const view = render(<MarkdownNavigationProvider workspaceRoot="/workspace" onSearchWorkspaceEntries={search} onOpenWorkspaceFile={open} onOpenWorkspaceFileContextMenu={openMenu}>
    <MarkdownContentBlock content={content} />
  </MarkdownNavigationProvider>);
  expect(view.queryAllByRole('link')).toHaveLength(0);
  await waitFor(() => expect(view.getAllByRole('link')).toHaveLength(4));
  expect(search.mock.calls.map(([, parent]) => parent).sort()).toEqual(['', 'assets', 'docs', 'src']);
  expect(view.getByText('?? README.md').tagName).toBe('CODE');
  expect(view.getByText('node --experimental-strip-types scripts/snake-logic.test.mjs').tagName).toBe('CODE');
  expect(view.getByText('missing.md').tagName).toBe('CODE');
  expect(view.getByText('process.env').tagName).toBe('CODE');
  expect(view.getByText('template.ts').closest('a')).toBeNull();
  expect(view.getByText('directory').closest('a')).toBeNull();
  expect(view.container.querySelector('a a')).toBeNull();
  fireEvent.click(view.getByRole('link', { name: 'README.md:12' }));
  fireEvent.click(view.getByRole('link', { name: 'src/main.ts#L8' }));
  fireEvent.click(view.getByRole('link', { name: 'src/main.ts' }));
  fireEvent.click(view.getByRole('link', { name: 'notes' }));
  fireEvent.click(await view.findByRole('button', { name: /diagram/u }));
  const dialog = within(view.getByRole('dialog', { name: 'diagram' }));
  fireEvent.click(dialog.getByRole('button', { name: '放大' }));
  fireEvent.contextMenu(dialog.getByRole('img', { name: 'diagram' }), { clientX: 120, clientY: 80 });
  expect(openMenu).toHaveBeenCalledExactlyOnceWith({ filePath: 'assets/diagram.png', x: 120, y: 80 });
  expect(preview).toHaveBeenCalledExactlyOnceWith('/workspace', 'assets/diagram.png');
  expect(open.mock.calls).toEqual([
    ['README.md', 12], ['src/main.ts', 8], ['src/main.ts', 20], ['docs/My Notes.md', 3],
  ]);
  expect(view.getByText('missing image').closest('button')).toBeNull();
});

it('navigates linked images once without a preview, while standalone image controls stay independent', async () => {
  const openFile = vi.fn();
  const openWeb = vi.fn();
  const preview = vi.fn(async () => ({ ok: true, url: 'http://127.0.0.1:1234/preview/image' }));
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: { createWorkspaceFilePreview: preview } } });
  const search = vi.fn(async () => listing([entry('image.png'), entry('README.md')]));
  const view = render(<MarkdownNavigationProvider workspaceRoot="/workspace" onSearchWorkspaceEntries={search}
    onOpenWorkspaceFile={openFile} onOpenWebLink={openWeb}>
    <MarkdownContentBlock content={'[![website](image.png)](https://example.com) [![readme](https://example.com/image.png)](README.md)\n\n![standalone](https://example.com/image.png)'} />
  </MarkdownNavigationProvider>);
  fireEvent.click(await view.findByRole('img', { name: 'website' }));
  fireEvent.click(await view.findByRole('img', { name: 'readme' }));
  expect(openWeb).toHaveBeenCalledExactlyOnceWith('https://example.com');
  expect(openFile).toHaveBeenCalledExactlyOnceWith('README.md', undefined);
  expect(view.queryByRole('dialog')).toBeNull();

  fireEvent.click(view.getByRole('button', { name: 'standalone' }));
  const dialog = within(view.getByRole('dialog', { name: 'standalone' }));
  fireEvent.click(dialog.getByRole('button', { name: '放大' }));
  fireEvent.click(dialog.getByRole('button', { name: '旋转图片' }));
  expect(openWeb).toHaveBeenCalledOnce();
  expect(openFile).toHaveBeenCalledOnce();
});

it('keeps workspace file menu actions usable inside an image preview', async () => {
  const copyPath = vi.fn();
  const search = vi.fn(async () => listing([entry('image.png')]));
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: {
    createWorkspaceFilePreview: vi.fn(async () => ({ ok: true, url: 'http://127.0.0.1:1234/preview/image' })),
  } } });
  function PreviewWithMenu() {
    const [target, setTarget] = useState<WorkspaceFileContextTarget | null>(null);
    return <>
      <MarkdownNavigationProvider workspaceRoot="/workspace" onSearchWorkspaceEntries={search} onOpenWorkspaceFileContextMenu={setTarget}>
        <MarkdownContentBlock content="![diagram](image.png)" />
      </MarkdownNavigationProvider>
      <WorkspaceFileContextMenu target={target} onClose={() => setTarget(null)} selectedWorkspaceApp={null} workspaceApps={[]}
        onCopyPath={copyPath} onAddToConversation={vi.fn()} onOpenWithApp={vi.fn()} onReveal={vi.fn()} />
    </>;
  }
  const view = render(<PreviewWithMenu />);
  fireEvent.click(await view.findByRole('button', { name: 'diagram' }));
  fireEvent.contextMenu(within(view.getByRole('dialog')).getByRole('img', { name: 'diagram' }));
  fireEvent.click(await view.findByRole('menuitem', { name: '复制文件路径' }));
  expect(copyPath).toHaveBeenCalledExactlyOnceWith('image.png');
  await waitFor(() => expect(view.queryByRole('menu')).toBeNull());
  expect(view.getByRole('dialog')).toBeTruthy();
});

it('shares watchers and removes/restores links when files are deleted, replaced by directories or recreated', async () => {
  let files = [entry('README.md')];
  const search = vi.fn(async () => listing(files));
  let changed!: () => void;
  const stop = vi.fn();
  const watch = vi.fn((_root: string, _paths: string[], callback: () => void) => { changed = callback; return stop; });
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: { desktop: { watchWorkspaceEntries: watch } } });
  const view = render(<MarkdownNavigationProvider workspaceRoot="/workspace" onSearchWorkspaceEntries={search} onOpenWorkspaceFile={() => undefined}>
    <MarkdownContentBlock content="`README.md` and [readme](README.md)" />
  </MarkdownNavigationProvider>);
  await waitFor(() => expect(view.getAllByRole('link')).toHaveLength(2));
  expect(search).toHaveBeenCalledOnce();
  expect(watch).toHaveBeenCalledExactlyOnceWith('/workspace', [''], expect.any(Function));
  files = [];
  act(() => { changed(); });
  await waitFor(() => expect(view.queryAllByRole('link')).toHaveLength(0));
  files = [entry('README.md', 'directory')];
  act(() => { changed(); });
  await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
  expect(view.queryAllByRole('link')).toHaveLength(0);
  files = [entry('README.md')];
  fireEvent.focus(window);
  await waitFor(() => expect(view.getAllByRole('link')).toHaveLength(2));
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
});

it('does not carry an old workspace verification into the next workspace when requests finish out of order', async () => {
  let finishFirst!: (value: WorkspaceEntrySearchResponse) => void;
  const first = vi.fn(() => new Promise<WorkspaceEntrySearchResponse>((resolve) => { finishFirst = resolve; }));
  const second = vi.fn(async () => listing([], '/second'));
  const view = render(<MarkdownNavigationProvider workspaceRoot="/workspace" onSearchWorkspaceEntries={first}>
    <MarkdownContentBlock content="`README.md`" />
  </MarkdownNavigationProvider>);
  await waitFor(() => expect(first).toHaveBeenCalledOnce());
  view.rerender(<MarkdownNavigationProvider workspaceRoot="/second" onSearchWorkspaceEntries={second}>
    <MarkdownContentBlock content="`README.md`" />
  </MarkdownNavigationProvider>);
  await waitFor(() => expect(second).toHaveBeenCalledOnce());
  await act(async () => { finishFirst(listing([entry('README.md')])); });
  expect(view.queryAllByRole('link')).toHaveLength(0);
  expect(view.getByText('README.md').tagName).toBe('CODE');
});
