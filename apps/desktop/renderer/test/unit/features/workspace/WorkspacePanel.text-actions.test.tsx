// @vitest-environment happy-dom

import type { DesktopTextEditCommand, WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { Editor } from '@pierre/diffs/edit';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps file actions alongside copying a selection across DOCX pages', async () => {
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
  fireEvent.click(await screen.findByRole('menuitem', { name: '复制文件路径' }));
  expect(copyFilePath).toHaveBeenCalledExactlyOnceWith(file.path);
  expect(executeTextEdit).not.toHaveBeenCalled();

  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  fireEvent.contextMenu(end);
  const copy = await screen.findByRole('menuitem', { name: '复制' });
  document.getSelection()!.removeAllRanges();
  fireEvent.click(copy);

  await waitFor(() => expect(executeTextEdit).toHaveBeenCalledExactlyOnceWith('copy'));
  expect(copied).toHaveBeenCalledExactlyOnceWith('的开头和正文第二页的后续');
  expect(copyFilePath).toHaveBeenCalledExactlyOnceWith(file.path);
});

it.each(['unselected paragraph', 'file tree'])('keeps file actions when right-clicking the %s with text selected elsewhere', async (target) => {
  render(<Preview />);
  const text = await screen.findByText('第一页的开头和正文');
  const range = document.createRange();
  range.selectNodeContents(text);
  document.getSelection()!.addRange(range);
  const clicked = target === 'file tree'
    ? await screen.findByRole('button', { name: 'report.docx', current: true })
    : screen.getByText('没有选中的段落');

  fireEvent.contextMenu(clicked);
  const copyPath = await screen.findByRole('menuitem', { name: '复制文件路径' });
  if (target === 'unselected paragraph') {
    fireEvent.click(screen.getByRole('menuitem', { name: '剪切' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '粘贴' }));
  }
  fireEvent.click(copyPath);
  expect(copyFilePath).toHaveBeenCalledExactlyOnceWith(file.path);
  expect(executeTextEdit).not.toHaveBeenCalled();
});

it('keeps file actions at an unselected code caret and pastes into that editor', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as CanvasRenderingContext2D);
  let editor!: Editor<undefined>;
  const edit = Editor.prototype.edit;
  vi.spyOn(Editor.prototype, 'edit').mockImplementation(function (this: Editor<undefined>, instance) {
    editor = this;
    return edit.call(this, instance);
  });
  const codeFile: WorkspaceFileRead = { ...file, path: 'quick_sort.py', content: 'before after', preview: { kind: 'text' } };
  const view = render(<Preview currentFile={codeFile} editing />);
  const getInput = () => view.container.querySelector('diffs-container')?.shadowRoot?.querySelector<HTMLElement>('[role="textbox"]');
  await waitFor(() => expect(getInput()).toBeTruthy());
  const input = getInput()!;
  const root = input.getRootNode() as ShadowRoot;
  const selection = document.getSelection()!;
  // happy-dom lacks Chromium's composed selection API; keep the real editor and menu flow.
  Object.defineProperty(selection, 'getComposedRanges', { configurable: true,
    value: () => selection.rangeCount ? [selection.getRangeAt(0)] : [],
  });
  const openCodeMenu = () => {
    // Chromium retargets the bubbling event to the host while retaining its composed path.
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true });
    const path: EventTarget[] = [input, root];
    for (let node: Node | null = root.host; node; node = node.parentNode) path.push(node);
    path.push(window);
    Object.defineProperty(event, 'composedPath', { value: () => path });
    fireEvent(root.host, event);
  };
  try {
    act(() => { editor.focus({ lineNumber: 1 }); input.focus(); });
    openCodeMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: '剪切' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '复制' }));
    expect(executeTextEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: '复制文件路径' }));
    expect(copyFilePath).toHaveBeenCalledExactlyOnceWith(codeFile.path);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    act(() => editor.focus({ lineNumber: 1 }));
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'pasted ');
    executeTextEdit.mockImplementation(async () => {
      fireEvent.paste(root.activeElement!, { clipboardData });
      return true;
    });
    openCodeMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: '粘贴' }));
    await waitFor(() => expect(editor.getText()).toBe('pasted before after'));
    expect(executeTextEdit).toHaveBeenCalledExactlyOnceWith('paste');
    expect(copyFilePath).toHaveBeenCalledExactlyOnceWith(codeFile.path);
  } finally {
    Reflect.deleteProperty(selection, 'getComposedRanges');
  }
});

const noop = () => undefined;
const searchEntries = async () => ({
  entries: [{ kind: 'file' as const, name: file.path, path: file.path, parent: '' }],
  query: '', scanned: 1, truncated: false, workspaceRoot: '/repo',
});

function Preview({ currentFile = file, editing = false }: { currentFile?: WorkspaceFileRead; editing?: boolean }) {
  const [content, setContent] = useState(currentFile.content);
  const tree = useWorkspaceFileTree({ workspaceKey: 'project', enabled: true, searchEntries });
  return <I18nProvider initialLocale="zh-CN"><ToastProvider><AppTextContextMenu /><WorkspacePanel
    activePanel={createFilePanel(currentFile.path)} activeProject={{ id: currentFile.projectId, name: 'Repo', path: '/repo', createdAt: '', updatedAt: '' }}
    filePreview={currentFile} fileFocusRequest={null} fileTree={tree} entryOperationPending={false} onSearchProjectEntries={searchEntries} onSearchProjectText={noop}
    fileDraft={{ content, editing, canEdit: editing, dirty: false,
      error: null, errorMessage: null, preparing: false, saving: false, isSaving: () => false,
      save: async () => true, confirmDiscardChanges: async () => true, confirmDiscardAllChanges: async () => true,
      hasUnsavedChanges: false, hasDirtyEntry: () => false, discardEntry: noop, isFileDirty: () => false, updateContent: setContent, relocateEntry: noop }}
    latestReviewSummary={null} latestReviewFindings={[]} reviewError={null} reviewFocusRequest={null}
    reviewLoading={false} reviewState={null} selectedWorkspaceApp={null} workspaceApps={[]}
    onAddFileToConversation={noop} onCopyFilePath={copyFilePath} onCreateEntry={async () => null}
    onRenameEntry={async () => null} onMoveEntry={async () => null} onDeleteEntry={async () => false}
    onExternalOpenFile={noop} onOpenFileWithApp={noop} onOpenEntry={noop} onOpenProjectFile={noop}
    onOpenFilesPanel={noop} onOpenBrowser={noop} onOpenSideChat={noop} onOpenTerminalPanel={noop}
    onReviewRefresh={noop} onReviewBaseRefChange={noop} onReviewSourceChange={noop} onRevealFile={noop}
  /></ToastProvider></I18nProvider>;
}
