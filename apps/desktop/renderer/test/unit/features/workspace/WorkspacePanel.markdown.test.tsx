// @vitest-environment happy-dom

import { Editor } from '@pierre/diffs/edit';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { WorkspaceFileRead } from '@setsuna-desktop/contracts';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../src/app/providers/ToastProvider.js';
import { WorkspacePanel } from '../../../../src/features/workspace/WorkspacePanel.js';
import { useWorkspaceFileTree } from '../../../../src/features/workspace/hooks/useWorkspaceFileTree.js';
import { createFilePanel, type WorkspaceFileFocusRequest } from '../../../../src/features/workspace/model.js';
import { I18nProvider } from '../../../../src/shared/i18n/I18nProvider.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const file: WorkspaceFileRead = { projectId: 'project', path: 'README.md', content: '# Original',
  size: 10, truncated: false, revision: 'r1', preview: { kind: 'text' } };
const noop = () => undefined;

function Document({ currentFile = file, initialContent = currentFile.content, focus = null, editing = false }: {
  currentFile?: WorkspaceFileRead; initialContent?: string; focus?: WorkspaceFileFocusRequest | null; editing?: boolean;
}) {
  const [content, setContent] = useState(initialContent);
  const tree = useWorkspaceFileTree({ workspaceKey: 'project', enabled: false, searchEntries: vi.fn() });
  return <I18nProvider initialLocale="zh-CN"><ToastProvider><WorkspacePanel
    activePanel={createFilePanel(currentFile.path)} activeProject={{ id: 'project', name: 'Repo', path: '/repo', createdAt: '', updatedAt: '' }}
    filePreview={currentFile} fileFocusRequest={focus} fileTree={tree} entryOperationPending={false}
    fileDraft={{ content, editing, canEdit: editing, dirty: content !== currentFile.content,
      error: null, errorMessage: null, preparing: false, saving: false, isSaving: () => false,
      save: async () => true, confirmDiscardChanges: async () => true, updateContent: setContent, relocateFile: noop }}
    latestReviewSummary={null} latestReviewFindings={[]} reviewError={null} reviewFocusRequest={null}
    reviewLoading={false} reviewState={null} selectedWorkspaceApp={null} workspaceApps={[]}
    onAddFileToConversation={noop} onCopyFilePath={noop} onCreateEntry={async () => null}
    onRenameEntry={async () => null} onMoveEntry={async () => null} onDeleteEntry={async () => false}
    onExternalOpenFile={noop} onOpenFileWithApp={noop} onOpenEntry={noop} onOpenProjectFile={noop}
    onOpenFilesPanel={noop} onOpenBrowser={noop} onOpenSideChat={noop} onOpenTerminalPanel={noop}
    onReviewRefresh={noop} onReviewBaseRefChange={noop} onReviewSourceChange={noop} onRevealFile={noop}
  /></ToastProvider></I18nProvider>;
}

it('opens Markdown in preview by default and switches to source for a line navigation', async () => {
  const view = render(<Document />);
  const source = screen.getByRole('button', { name: '查看源码' });
  expect(source.getAttribute('aria-pressed')).toBe('false');
  expect(source.closest('.desktop-editor__crumb-actions')?.contains(screen.getByRole('button', { name: '收起文件目录' }))).toBe(true);
  await screen.findByRole('heading', { name: 'Original' });
  view.rerender(<Document focus={{ path: file.path, line: 1, version: 1 }} />);
  expect(screen.queryByRole('heading')).toBeNull();
  expect(source.getAttribute('aria-pressed')).toBe('true');
  view.rerender(<Document currentFile={{ ...file, path: 'other.MD' }} />);
  expect(screen.getByRole('button', { name: '查看预览' }).getAttribute('aria-pressed')).toBe('true');
  await screen.findByRole('heading', { name: 'Original' });
  view.rerender(<Document currentFile={{ ...file, path: 'main.ts' }} />);
  expect(screen.queryByRole('group', { name: 'Markdown 显示模式' })).toBeNull();
});

it('previews unsaved input and keeps the live editor, selection and undo history when switching back', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as CanvasRenderingContext2D);
  let editor!: Editor<undefined>;
  const edit = Editor.prototype.edit;
  vi.spyOn(Editor.prototype, 'edit').mockImplementation(function (this: Editor<undefined>, instance) {
    editor = this;
    return edit.call(this, instance);
  });
  const view = render(<Document editing />);
  await screen.findByRole('heading', { name: 'Original' });
  const getInput = () => view.container.querySelector('diffs-container')?.shadowRoot?.querySelector<HTMLElement>('[role="textbox"]');
  await waitFor(() => expect(getInput()).toBeTruthy());
  const input = getInput()!;
  await act(async () => { await new Promise(requestAnimationFrame); });
  expect((input.getRootNode() as ShadowRoot).activeElement).not.toBe(input);
  fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
  act(() => editor.focus({ lineNumber: 1 }));
  await act(async () => {
    fireEvent(input, new InputEvent('beforeinput', { bubbles: true, composed: true, cancelable: true,
      inputType: 'insertText', data: 'Draft ' }));
  });
  const changed = editor.getText();
  const selection = editor.getState().selections;
  fireEvent.click(screen.getByRole('button', { name: '查看预览' }));
  const article = await screen.findByRole('article');
  expect(article.textContent).toContain('Draft');
  expect(changed).not.toBe(file.content);
  expect(getInput()).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: '查看源码' }));
  expect(getInput()).toBe(input);
  expect(editor.getText()).toBe(changed);
  expect(editor.getState().selections).toEqual(selection);
  expect(editor.canUndo).toBe(true);
  await act(async () => { editor.undo(); });
  expect(editor.getText()).toBe(file.content);
  // An empty unsaved draft must not fall back to the saved Markdown text.
  view.rerender(<Document editing initialContent="" key="empty" />);
  fireEvent.click(screen.getByRole('button', { name: '查看预览' }));
  expect((await screen.findByRole('article')).textContent).toBe('');
});
