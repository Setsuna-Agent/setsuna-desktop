// @vitest-environment happy-dom

import type { DesktopTextEditCommand, WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppTextContextMenu } from '../../../../src/app/layout/AppTextContextMenu.js';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { WorkspacePanel } from '../../../../src/features/workspace/WorkspacePanel.js';
import { useWorkspaceFileTree } from '../../../../src/features/workspace/hooks/useWorkspaceFileTree.js';
import { createFilePanel } from '../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

vi.mock('../../../../src/features/workspace/documents/document-preview-engine.js', () => ({
  loadDocumentPreviewFactory: async () => (container: HTMLElement) => ({
    // Replace only the Worker/WASM boundary with the selectable runs produced by the viewer.
    load: async () => {
      for (const text of ['第一页的开头和正文', '第二页的后续内容', '没有选中的段落']) {
        const page = document.createElement('div');
        const run = document.createElement('span');
        run.textContent = text;
        page.append(run);
        container.append(page);
      }
    },
    destroy: () => container.replaceChildren(),
  }),
}));

const executeTextEdit = vi.fn<(command: DesktopTextEditCommand) => Promise<boolean>>();
const copyFilePath = vi.fn();
const file: WorkspaceFileRead = { projectId: 'project', path: 'report.docx', content: '', size: 4,
  truncated: false, preview: { kind: 'document', format: 'docx' } };

beforeEach(() => {
  executeTextEdit.mockReset().mockResolvedValue(true);
  copyFilePath.mockReset();
  vi.stubGlobal('setsunaDesktop', {
    windowControls: { executeTextEdit },
    desktop: { readWorkspaceDocument: vi.fn().mockResolvedValue({ ok: true, data: new Uint8Array([1]) }) },
  });
});
afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

it('copies a selection across DOCX pages after the context menu takes focus', async () => {
  render(<Preview />);
  const start = await screen.findByText('第一页的开头和正文');
  const end = screen.getByText('第二页的后续内容');
  const range = document.createRange();
  range.setStart(start.firstChild!, 3);
  range.setEnd(end.firstChild!, 6);
  document.getSelection()!.addRange(range);
  const copied = vi.fn();
  executeTextEdit.mockImplementation(async () => {
    copied(document.getSelection()?.toString());
    return true;
  });

  fireEvent.contextMenu(end);
  const copy = await screen.findByRole('menuitem', { name: '复制' });
  expect(screen.queryByRole('menuitem', { name: '复制文件路径' })).toBeNull();
  document.getSelection()!.removeAllRanges();
  fireEvent.click(copy);

  await waitFor(() => expect(executeTextEdit).toHaveBeenCalledExactlyOnceWith('copy'));
  expect(copied).toHaveBeenCalledExactlyOnceWith('的开头和正文第二页的后续');
  expect(copyFilePath).not.toHaveBeenCalled();
});

it.each(['unselected paragraph', 'file tree'])('keeps file actions when right-clicking the %s with text selected elsewhere', async (target) => {
  render(<Preview />);
  const text = await screen.findByText('第一页的开头和正文');
  const range = document.createRange();
  range.selectNodeContents(text);
  document.getSelection()!.addRange(range);
  const clicked = target === 'file tree'
    ? await screen.findByRole('button', { name: 'report.docx' })
    : screen.getByText('没有选中的段落');

  fireEvent.contextMenu(clicked);
  const copyPath = await screen.findByRole('menuitem', { name: '复制文件路径' });
  expect(screen.queryByRole('menuitem', { name: '复制' })).toBeNull();
  fireEvent.click(copyPath);
  expect(copyFilePath).toHaveBeenCalledExactlyOnceWith(file.path);
  expect(executeTextEdit).not.toHaveBeenCalled();
});

const noop = () => undefined;
const searchEntries = async () => ({
  entries: [{ kind: 'file' as const, name: file.path, path: file.path, parent: '' }],
  query: '', scanned: 1, truncated: false, workspaceRoot: '/repo',
});

function Preview() {
  const tree = useWorkspaceFileTree({ workspaceKey: 'project', enabled: true, searchEntries });
  return <I18nProvider initialLocale="zh-CN"><ToastProvider><AppTextContextMenu /><WorkspacePanel
    activePanel={createFilePanel(file.path)} activeProject={{ id: file.projectId, name: 'Repo', path: '/repo', createdAt: '', updatedAt: '' }}
    filePreview={file} fileFocusRequest={null} fileTree={tree} entryOperationPending={false}
    fileDraft={{ content: '', editing: false, canEdit: false, dirty: false,
      error: null, errorMessage: null, preparing: false, saving: false, isSaving: () => false,
      save: async () => true, confirmDiscardChanges: async () => true, confirmDiscardAllChanges: async () => true,
      hasUnsavedChanges: false, hasDirtyEntry: () => false, discardEntry: noop, isFileDirty: () => false, updateContent: noop, relocateEntry: noop }}
    latestReviewSummary={null} latestReviewFindings={[]} reviewError={null} reviewFocusRequest={null}
    reviewLoading={false} reviewState={null} selectedWorkspaceApp={null} workspaceApps={[]}
    onAddFileToConversation={noop} onCopyFilePath={copyFilePath} onCreateEntry={async () => null}
    onRenameEntry={async () => null} onMoveEntry={async () => null} onDeleteEntry={async () => false}
    onExternalOpenFile={noop} onOpenFileWithApp={noop} onOpenEntry={noop} onOpenProjectFile={noop}
    onOpenFilesPanel={noop} onOpenBrowser={noop} onOpenSideChat={noop} onOpenTerminalPanel={noop}
    onReviewRefresh={noop} onReviewBaseRefChange={noop} onReviewSourceChange={noop} onRevealFile={noop}
  /></ToastProvider></I18nProvider>;
}
