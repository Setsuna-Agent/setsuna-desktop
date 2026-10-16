// @vitest-environment happy-dom

import type { WorkspaceEntry, WorkspaceEntrySearchResponse, WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { WorkspacePanel } from '../../../../src/features/workspace/WorkspacePanel.js';
import { useWorkspaceFileTree } from '../../../../src/features/workspace/hooks/useWorkspaceFileTree.js';
import { createFilePanel } from '../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'setsunaDesktop');
});

const png = 'data:image/png;base64,AQID';
const file: WorkspaceFileRead = { projectId: 'project', path: 'stickers/004.webp', content: '', size: 4, truncated: false,
  preview: { kind: 'image', mimeType: 'image/webp', base64: 'UklGRg==' } };

function clipboard(request?: ReturnType<typeof vi.fn>) {
  const copy = vi.fn().mockResolvedValue({ ok: true });
  Object.defineProperty(window, 'setsunaDesktop', { configurable: true, value: {
    desktop: { copyImageToClipboard: copy }, runtime: { request },
  } });
  return copy;
}

it('copies the right-clicked image at its original size, even if another file becomes active', async () => {
  const copy = clipboard();
  const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue();
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(720);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(640);
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
  const view = render(<Preview currentFile={file} />);
  fireEvent.contextMenu(screen.getByRole('img', { name: '预览 stickers/004.webp' }));
  expect(decode).not.toHaveBeenCalled();
  const next: WorkspaceFileRead = { ...file, path: 'next.png', preview: { kind: 'image', mimeType: 'image/png', base64: 'AQID' } };
  view.rerender(<Preview currentFile={next} />);
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制图片' }));
  await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith({ dataUrl: png, name: '004.webp' }));
  expect(decode.mock.instances[0]).toMatchObject({ src: 'data:image/webp;base64,UklGRg==' });
  expect(draw).toHaveBeenCalledExactlyOnceWith(decode.mock.instances[0], 0, 0);
  expect(encode).toHaveBeenCalledExactlyOnceWith('image/png');
  expect(encode.mock.instances[0]).toMatchObject({ width: 720, height: 640 });
  expect(screen.queryByRole('menu')).toBeNull();

  fireEvent.contextMenu(screen.getByRole('img', { name: '预览 next.png' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制图片' }));
  await waitFor(() => expect(copy).toHaveBeenCalledTimes(2));
  expect(copy).toHaveBeenLastCalledWith({ dataUrl: png, name: 'next.png' });
  expect(decode).toHaveBeenCalledTimes(1);
});

it('reports a decoding failure without replacing the clipboard', async () => {
  const copy = clipboard();
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockRejectedValue(new Error('Image decode failed.'));
  render(<Preview currentFile={file} />);
  fireEvent.contextMenu(screen.getByRole('img'));
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制图片' }));
  expect(await screen.findByText('Image decode failed.')).toBeTruthy();
  expect(copy).not.toHaveBeenCalled();
  expect(screen.queryByText('图片已复制')).toBeNull();
});

it('reads an unopened tree image on copy from its original directory without navigating the preview', async () => {
  let finishRead!: (value: WorkspaceFileRead) => void;
  const request = vi.fn(() => new Promise<WorkspaceFileRead>((resolve) => { finishRead = resolve; }));
  const copy = clipboard(request);
  const searchEntries = vi.fn(async (): Promise<WorkspaceEntrySearchResponse> => ({
    entries: [
      { kind: 'file', name: '016.WEBP', path: '016.WEBP', parent: '' },
      { kind: 'file', name: 'README.md', path: 'README.md', parent: '' },
      { kind: 'directory', name: 'folder.png', path: 'folder.png', parent: '' },
    ], query: '', scanned: 3, truncated: false, workspaceRoot: '/repo',
  }));
  const onOpenEntry = vi.fn();
  const view = render(<Preview currentFile={{ ...file, rootId: 'secondary' }} searchEntries={searchEntries} onOpenEntry={onOpenEntry} />);
  fireEvent.contextMenu(await screen.findByRole('button', { name: 'folder.png' }));
  expect(screen.queryByRole('menuitem', { name: '复制图片' })).toBeNull();
  fireEvent.contextMenu(screen.getByRole('button', { name: 'README.md' }));
  expect(screen.queryByRole('menuitem', { name: '复制图片' })).toBeNull();
  fireEvent.contextMenu(screen.getByRole('button', { name: '016.WEBP' }));
  const menuItem = await screen.findByRole('menuitem', { name: '复制图片' });
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(menuItem);
  expect(request).toHaveBeenCalledExactlyOnceWith({ path: '/v1/projects/project/read?path=016.WEBP&rootId=secondary' });
  view.rerender(<Preview currentFile={{ ...file, projectId: 'other-project', rootId: 'other-root', path: 'other.png' }}
    searchEntries={searchEntries} onOpenEntry={onOpenEntry} />);
  await act(async () => finishRead({ ...file, path: '016.WEBP', preview: { kind: 'image', mimeType: 'image/png', base64: 'AQID' } }));
  await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith({ dataUrl: png, name: '016.WEBP' }));
  expect(onOpenEntry).not.toHaveBeenCalled();
  expect(screen.getByRole('img', { name: '预览 other.png' })).toBeTruthy();
});

it.each(['binary', 'image-too-large'] as const)('keeps the clipboard when a tree image is classified as %s', async (reason) => {
  const request = vi.fn().mockResolvedValue({ ...file, preview: { kind: 'unsupported', reason } });
  const copy = clipboard(request);
  const searchEntries = vi.fn(async (): Promise<WorkspaceEntrySearchResponse> => ({
    entries: [{ kind: 'file', name: 'broken.png', path: 'broken.png', parent: '' }],
    query: '', scanned: 1, truncated: false, workspaceRoot: '/repo',
  }));
  render(<Preview currentFile={file} searchEntries={searchEntries} />);
  fireEvent.contextMenu(await screen.findByRole('button', { name: 'broken.png' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制图片' }));
  expect(await screen.findByText(reason === 'image-too-large' ? '图片过大，暂时无法预览' : '图片不可用')).toBeTruthy();
  expect(copy).not.toHaveBeenCalled();
});

const noop = () => undefined;

function Preview({ currentFile, searchEntries, onOpenEntry = noop }: {
  currentFile: WorkspaceFileRead;
  searchEntries?: () => Promise<WorkspaceEntrySearchResponse>;
  onOpenEntry?: (entry: WorkspaceEntry) => void;
}) {
  const tree = useWorkspaceFileTree({ workspaceKey: JSON.stringify([currentFile.projectId, currentFile.rootId]),
    enabled: Boolean(searchEntries), searchEntries: searchEntries ?? vi.fn() });
  return <I18nProvider initialLocale="zh-CN"><ToastProvider><WorkspacePanel
    activePanel={createFilePanel(currentFile.path, currentFile.rootId)} activeProject={{ id: currentFile.projectId, name: 'Repo', path: '/repo', createdAt: '', updatedAt: '' }}
    filePreview={currentFile} fileFocusRequest={null} fileTree={tree} entryOperationPending={false}
    fileDraft={{ content: '', editing: false, canEdit: false, dirty: false,
      error: null, errorMessage: null, preparing: false, saving: false, isSaving: () => false,
      save: async () => true, confirmDiscardChanges: async () => true, confirmDiscardAllChanges: async () => true,
      hasUnsavedChanges: false, hasDirtyEntry: () => false, discardEntry: noop, isFileDirty: () => false, updateContent: noop, relocateEntry: noop }}
    latestReviewSummary={null} latestReviewFindings={[]} reviewError={null} reviewFocusRequest={null}
    reviewLoading={false} reviewState={null} selectedWorkspaceApp={null} workspaceApps={[]}
    onAddFileToConversation={noop} onCopyFilePath={noop} onCreateEntry={async () => null}
    onRenameEntry={async () => null} onMoveEntry={async () => null} onDeleteEntry={async () => false}
    onExternalOpenFile={noop} onOpenFileWithApp={noop} onOpenEntry={onOpenEntry} onOpenProjectFile={noop}
    onOpenFilesPanel={noop} onOpenBrowser={noop} onOpenSideChat={noop} onOpenTerminalPanel={noop}
    onReviewRefresh={noop} onReviewBaseRefChange={noop} onReviewSourceChange={noop} onRevealFile={noop}
  /></ToastProvider></I18nProvider>;
}
