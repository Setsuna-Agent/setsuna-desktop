// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { createNoopReviewRendererService, type ReviewRendererService } from '../../../src/contracts/index.js';
import { ReviewRendererProvider } from '../../../src/renderer/context.js';
import type { DesktopDiffFile, DesktopReviewActionResult, DesktopReviewBridge, DesktopReviewState } from '../../../src/contracts/index.js';
import { WorkspaceGitCommitProvider } from '../../../src/renderer/git/WorkspaceGitCommitDialog.js';
import type { CommitMessageEditorLauncher } from '../../../src/renderer/git/useCommitMessageEditor.js';
import { GitChangesPanel } from '../../../src/renderer/history/GitChangesPanel.js';
import { ReviewRendererTestHost } from '../review-renderer-test-host.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const noop = () => undefined;
const file = (path: string): DesktopDiffFile => ({ path, action: 'Modified', additions: 1, deletions: 1, truncated: false, lines: [] });
const state: DesktopReviewState = {
  workspaceRoot: '/repo', gitRoot: '/repo', isGitRepository: true, currentBranch: 'main',
  currentRemoteRef: null, baseRef: null, baseRefs: [], branches: [], currentRemoteSummary: null, branchSummary: null,
  stagedSummary: { files: [file('staged.txt')], additions: 1, deletions: 1 },
  unstagedSummary: { files: [{ ...file('new.txt'), previousPath: 'old.txt', action: 'Renamed' }], additions: 1, deletions: 1 },
};

function createBridge(operations: Partial<DesktopReviewBridge>): DesktopReviewBridge {
  return {
    getHistory: vi.fn(async (root) => ({ gitRoot: root, head: null, tip: null, currentBranch: 'main', nextSkip: null, commits: [], refs: [] })),
    ...operations,
  } as DesktopReviewBridge;
}

function surface(bridge: DesktopReviewBridge, { root = '/repo', onRefresh = noop, onOpen = noop, reviewState = state, onOpenEditor, conversationModelSelection, service = createNoopReviewRendererService() }: {
  service?: ReviewRendererService;
  conversationModelSelection?: RuntimeConfiguredModelReference;
  root?: string;
  onRefresh?: () => void;
  onOpen?: (path: string) => void;
  reviewState?: DesktopReviewState;
  onOpenEditor?: CommitMessageEditorLauncher;
} = {}) {
  return (
    <ReviewRendererProvider service={service}><ReviewRendererTestHost bridge={bridge}>
      <WorkspaceGitCommitProvider threadId="thread_1" activeProject={{ id: root, path: root, name: 'Repository', createdAt: '', updatedAt: '' }} reviewState={reviewState} reviewLoading={false} onReviewRefresh={onRefresh} onOpenMessageEditor={onOpenEditor} conversationModelSelection={conversationModelSelection}>
        <GitChangesPanel editingMessage workspaceRoot={root} reviewState={reviewState} reviewError={null} reviewLoading={false} onRefresh={onRefresh} actions={{
          workspaceApps: [], onAddFileToConversation: noop, onCopyFilePath: noop, onExternalOpenFile: noop,
          onOpenFileWithApp: noop, onOpenProjectFile: onOpen, onRevealFile: noop,
        }} />
      </WorkspaceGitCommitProvider>
    </ReviewRendererTestHost></ReviewRendererProvider>
  );
}

it('generates and commits only staged changes by default and preserves edits when a commit fails', async () => {
  const generatedMessage = 'feat: generated summary\n\n- Describe the staged changes\n- Preserve the message body';
  const editedMessage = generatedMessage + '\n- Reviewed before committing';
  const generateCommitMessage = vi.fn().mockResolvedValue({ message: generatedMessage });
  const commit = vi.fn().mockRejectedValueOnce(new Error('Git hook rejected commit'))
    .mockResolvedValueOnce({ ok: true, commitHash: 'abc123', pushed: false, state });
  const onRefresh = vi.fn();
  render(surface(createBridge({ generateCommitMessage, commit }), { onRefresh }));
  const input = screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement;
  const form = screen.getByRole('form', { name: '提交到 main' });
  fireEvent.click(screen.getByRole('button', { name: 'AI 生成提交消息' }));
  await waitFor(() => expect(input.value).toBe(generatedMessage));
  expect(generateCommitMessage).toHaveBeenCalledWith('/repo', { includeUnstaged: false }, expect.any(Function));
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: editedMessage } });
  fireEvent.click(within(form).getByRole('button', { name: /^提交 / }));
  await screen.findByRole('alert');
  expect(commit).toHaveBeenCalledWith('/repo', { message: editedMessage, includeUnstaged: false, push: false });
  expect(input.value).toBe(editedMessage);
  expect(onRefresh).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(input.value).toBe('');
});

it('retains the manually dragged message height while editing and restores automatic sizing on reset', () => {
  render(surface(createBridge({})));
  const input = screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement;
  vi.spyOn(input, 'offsetHeight', 'get').mockReturnValue(26);
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ height: 32.5 } as DOMRect);
  const handle = screen.getByRole('button', { name: '调整提交消息输入框高度' });
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 40 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 165 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(input.style.height).toBe('126px');
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  fireEvent.change(input, { target: { value: 'feat: multiline draft\n\n- Explain the changes' } });
  expect(input.style.height).toBe('126px');
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 240 });
  expect(input.style.height).toBe('126px');
  fireEvent.doubleClick(handle);
  expect(input.style.height).not.toBe('126px');
  expect(input.value).toBe('feat: multiline draft\n\n- Explain the changes');
});

it('uses the latest conversation model when generating after switching conversations', async () => {
  const generateCommitMessage = vi.fn().mockResolvedValue({ message: 'feat: generated summary' });
  const bridge = createBridge({ generateCommitMessage });
  const first = { providerId: 'first-provider', modelId: 'first-model' };
  const second = { providerId: 'second-provider', modelId: 'second-model' };
  const view = render(surface(bridge, { conversationModelSelection: first }));
  fireEvent.click(screen.getByRole('button', { name: 'AI 生成提交消息' }));
  await waitFor(() => expect((screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement).value).toBe('feat: generated summary'));
  expect(generateCommitMessage).toHaveBeenLastCalledWith('/repo', { includeUnstaged: false, modelSelection: first }, expect.any(Function));
  view.rerender(surface(bridge, { conversationModelSelection: second }));
  fireEvent.click(screen.getByRole('button', { name: 'AI 生成提交消息' }));
  await waitFor(() => expect(generateCommitMessage).toHaveBeenLastCalledWith('/repo', { includeUnstaged: false, modelSelection: second }, expect.any(Function)));
});

it('does not turn an empty index into a commit-all action through buttons or the shortcut', async () => {
  const commit = vi.fn();
  const generateCommitMessage = vi.fn();
  render(surface(createBridge({ commit, generateCommitMessage }), { reviewState: { ...state, stagedSummary: null } }));
  const input = screen.getByRole('textbox', { name: '提交消息' });
  fireEvent.change(input, { target: { value: 'Only staged changes' } });
  const form = screen.getByRole('form', { name: '提交到 main' });
  expect((within(form).getByRole('button', { name: /^提交 / }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '提交' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'AI 生成提交消息' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  fireEvent.submit(form);
  expect(commit).not.toHaveBeenCalled();
  expect(generateCommitMessage).not.toHaveBeenCalled();
});

it.each([
  { label: '拉取', options: {} },
  { label: '拉取（变基）', options: { rebase: true } },
])('$label does not require staged changes, preserves the draft, and refreshes even after a Git failure', async ({ label, options }) => {
  const cleanState = { ...state, stagedSummary: null, unstagedSummary: null };
  let finishPull!: () => void;
  const pull = vi.fn().mockImplementationOnce(() => new Promise((resolve) => {
    finishPull = () => resolve({ ok: true, pulled: true, state: cleanState });
  })).mockRejectedValueOnce(new Error('Merge conflict in tracked.txt'));
  const onRefresh = vi.fn();
  render(surface(createBridge({ pull }), { onRefresh, reviewState: cleanState }));
  const input = screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Keep my draft' } });
  fireEvent.click(screen.getByRole('button', { name: '更多 Git 操作' }));
  const item = await screen.findByRole('menuitem', { name: label });
  expect(item.getAttribute('aria-disabled')).not.toBe('true');
  fireEvent.click(item);
  expect(pull).toHaveBeenCalledExactlyOnceWith('/repo', options);
  expect(input.disabled).toBe(true);
  expect(onRefresh).not.toHaveBeenCalled();
  await act(async () => { finishPull(); });
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(onRefresh).toHaveBeenCalledOnce();
  expect(input.value).toBe('Keep my draft');

  fireEvent.click(screen.getByRole('button', { name: '更多 Git 操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
  expect((await screen.findByRole('alert')).textContent).toContain('Merge conflict in tracked.txt');
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
  expect(input.value).toBe('Keep my draft');
  expect(input.disabled).toBe(false);
});

it('keeps including unstaged changes an explicit dialog action and resets it when the dialog closes', async () => {
  const commit = vi.fn().mockResolvedValue({ ok: true, commitHash: 'abc123', pushed: false, state });
  render(surface(createBridge({ commit })));
  const input = screen.getByRole('textbox', { name: '提交消息' });
  fireEvent.change(input, { target: { value: 'Commit chosen scope' } });
  const openDialog = async () => {
    fireEvent.click(screen.getByRole('button', { name: '更多 Git 操作' }));
    expect(screen.queryByRole('menuitem', { name: '包含未暂存的更改' })).toBeNull();
    fireEvent.click(await screen.findByRole('menuitem', { name: '提交或推送…' }));
    return within(await screen.findByRole('dialog', { name: '提交或推送' }));
  };
  const dialog = await openDialog();
  const checkbox = dialog.getByRole('checkbox', { name: '包含未暂存的更改' }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '提交' }));
  await waitFor(() => expect(commit).toHaveBeenCalledExactlyOnceWith('/repo', { message: 'Commit chosen scope', includeUnstaged: false, push: false }));
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe(''));

  fireEvent.change(input, { target: { value: 'Explicitly include all changes' } });
  const nextDialog = await openDialog();
  const nextCheckbox = nextDialog.getByRole('checkbox', { name: '包含未暂存的更改' }) as HTMLInputElement;
  expect(nextCheckbox.checked).toBe(false);
  fireEvent.click(nextCheckbox);
  fireEvent.click(nextDialog.getByRole('button', { name: '提交' }));
  await waitFor(() => expect(commit).toHaveBeenLastCalledWith('/repo', { message: 'Explicitly include all changes', includeUnstaged: true, push: false }));
});

it('shows AI progress before completion and ignores later chunks from a project that has been left', async () => {
  let resolve!: (value: { message: string }) => void;
  const generateCommitMessage = vi.fn(() => new Promise<{ message: string }>((accept) => { resolve = accept; }));
  const commit = vi.fn();
  const bridge = createBridge({ generateCommitMessage, commit });
  const view = render(surface(bridge));
  fireEvent.click(screen.getByRole('button', { name: 'AI 生成提交消息' }));
  expect(generateCommitMessage).toHaveBeenCalledOnce();
  const onProgress = (generateCommitMessage.mock.calls[0] as unknown as Parameters<DesktopReviewBridge['generateCommitMessage']>)[2]!;
  act(() => onProgress('feat: streamed title'));
  expect((screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement).value).toBe('feat: streamed title');
  act(() => onProgress('feat: streamed title\n\n- First change'));
  expect((screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement).value).toContain('- First change');
  view.rerender(surface(bridge, { root: '/next-project' }));
  const input = screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'new project draft' } });
  act(() => onProgress('old project chunk'));
  await act(async () => { resolve({ message: 'old project result' }); });
  expect(input.value).toBe('new project draft');
  expect(commit).not.toHaveBeenCalled();
});

it.each(['close', 'save', 'shortcut'] as const)('keeps navigation beside the full message and accepts the latest edit once via %s', async (action) => {
  const previous = {
    oid: 'a'.repeat(40), branch: 'main',
    message: action === 'save' ? 'original subject\n\n# Original heading' : 'original subject\n\nOriginal body',
    context: 'Author: Test <test@example.invalid>\nDate: 2026-09-09\n\nOn branch main\n\nChanges to be committed:\n\tmodified: staged.txt',
  };
  const commentPrefix = action === 'save' ? '##' : '#';
  const editedMessage = action === 'save' ? 'amended subject\n\n# Latest heading\n\nFixes #123' : 'amended subject\n\nLatest body';
  const getCommitMessage = vi.fn().mockResolvedValue(previous);
  const commit = vi.fn().mockRejectedValue(new Error('Hook rejected commit'));
  const dispose = vi.fn();
  let events!: Parameters<CommitMessageEditorLauncher>[0];
  const onOpenEditor: CommitMessageEditorLauncher = (next) => { events = next; return dispose; };
  render(surface(createBridge({ getCommitMessage, commit }), {
    onOpenEditor,
    reviewState: action === 'close' ? { ...state, stagedSummary: null, unstagedSummary: null } : state,
  }));
  fireEvent.change(screen.getByRole('textbox', { name: '提交消息' }), { target: { value: 'Existing subject-only draft' } });
  fireEvent.click(screen.getByRole('button', { name: '提交选项' }));
  expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['提交', '提交（修改）', '提交和推送', '提交和同步']);
  fireEvent.click(screen.getByRole('menuitem', { name: '提交（修改）' }));
  const editor = await screen.findByRole('textbox', { name: 'COMMIT_EDITMSG' }) as HTMLTextAreaElement;
  expect(editor.value.startsWith(previous.message + '\n\n' + commentPrefix)).toBe(true);
  expect(editor.value).toContain(commentPrefix + ' On branch main');
  expect(editor.value).toContain(commentPrefix + '\tmodified: staged.txt');
  expect(editor.value).toContain(commentPrefix + ' Please enter the commit message for your changes. Lines starting');
  const comments = editor.value.slice(previous.message.length);
  const editorRegion = screen.getByRole('region', { name: 'COMMIT_EDITMSG' });
  const navigation = screen.getByRole('navigation', { name: '变更' });
  expect(editorRegion.parentElement).toBe(navigation.parentElement);
  if (action !== 'close') {
    expect(within(navigation).getByRole('button', { name: 'staged.txt' })).toBeTruthy();
    expect(within(navigation).getByRole('button', { name: 'new.txt' })).toBeTruthy();
  }
  expect(getCommitMessage).toHaveBeenCalledWith('/repo');
  expect(commit).not.toHaveBeenCalled();
  act(() => {
    const text = editedMessage + comments + commentPrefix + ' Editor-only note\n';
    fireEvent.change(editor, { target: { value: action === 'shortcut' ? text.replace(/\n/g, '\r\n') : text } });
    if (action === 'save') fireEvent.click(within(editorRegion).getByRole('button', { name: '保存并提交' }));
    else if (action === 'shortcut') fireEvent.keyDown(editor, { key: 's', metaKey: true });
    else events.onClose();
    events.onClose();
  });
  await screen.findByRole('alert');
  expect(commit).toHaveBeenCalledExactlyOnceWith('/repo', {
    message: editedMessage, includeUnstaged: false, push: false,
    amend: { oid: previous.oid, branch: previous.branch },
  });
  expect((screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement).value).toBe(editedMessage);
  expect(dispose).toHaveBeenCalledOnce();
});

it.each(['empty', 'comments', 'cancel', 'project'] as const)('does not amend when the editor is abandoned via %s', async (reason) => {
  let events!: Parameters<CommitMessageEditorLauncher>[0];
  const dispose = vi.fn();
  const onOpenEditor: CommitMessageEditorLauncher = (next) => { events = next; return dispose; };
  const commit = vi.fn();
  const bridge = createBridge({ getCommitMessage: vi.fn().mockResolvedValue({ oid: 'a'.repeat(40), branch: 'main', message: 'original', context: 'On branch main' }), commit });
  const view = render(surface(bridge, { onOpenEditor }));
  fireEvent.click(screen.getByRole('button', { name: '提交选项' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '提交（修改）' }));
  const editor = await screen.findByRole('textbox', { name: 'COMMIT_EDITMSG' });
  if (reason === 'empty') fireEvent.change(editor, { target: { value: '  \n' } });
  else if (reason === 'comments') {
    const comments = (editor as HTMLTextAreaElement).value.slice('original'.length);
    fireEvent.change(editor, { target: { value: comments } });
    expect((screen.getByRole('button', { name: '保存并提交' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });
    expect(commit).not.toHaveBeenCalled();
  }
  else if (reason === 'cancel') fireEvent.click(screen.getByRole('button', { name: '取消' }));
  else view.rerender(surface(bridge, { root: '/other', onOpenEditor }));
  await act(async () => { events.onClose(); });
  expect(commit).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: 'COMMIT_EDITMSG' })).toBeNull();
  expect(dispose).toHaveBeenCalledOnce();
});

it('reports a missing commit context instead of opening a broken document or committing it', async () => {
  const commit = vi.fn();
  const onOpenEditor = vi.fn();
  const bridge = createBridge({ getCommitMessage: vi.fn().mockResolvedValue({ oid: 'a'.repeat(40), branch: 'main', message: 'Subject' }), commit });
  render(surface(bridge, { onOpenEditor }));
  fireEvent.click(screen.getByRole('button', { name: '提交选项' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '提交（修改）' }));
  expect((await screen.findByRole('alert')).textContent).toContain('未能读取 Git 提交注释');
  expect(screen.queryByRole('textbox', { name: 'COMMIT_EDITMSG' })).toBeNull();
  expect(onOpenEditor).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it('reports a sync failure after a successful local commit without leaving a duplicate commit draft', async () => {
  const commit = vi.fn().mockResolvedValue({ ok: true, commitHash: 'abc123', pushed: false, synced: false, syncError: 'Remote unavailable', state });
  render(surface(createBridge({ commit })));
  const input = screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'feat: sync' } });
  fireEvent.click(screen.getByRole('button', { name: '提交选项' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '提交和同步' }));
  expect((await screen.findByRole('alert')).textContent).toContain('同步失败');
  expect(commit).toHaveBeenCalledExactlyOnceWith('/repo', { includeUnstaged: false, message: 'feat: sync', push: false, sync: true });
  expect(input.value).toBe('');
});

it('opens files without selecting a diff and scopes stage, unstage, and confirmed discard to the row', async () => {
  const stageFiles = vi.fn().mockResolvedValue({ ok: true, state });
  const unstageFiles = vi.fn().mockResolvedValue({ ok: true, state });
  const discardUnstaged = vi.fn().mockResolvedValue({ ok: true, state });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const onOpen = vi.fn();
  const onRefresh = vi.fn();
  render(surface(createBridge({ stageFiles, unstageFiles, discardUnstaged }), { onOpen, onRefresh }));
  const selectedFile = screen.getByRole('button', { name: 'new.txt' });
  const row = within(selectedFile.closest<HTMLElement>('.git-changes-file')!);
  fireEvent.click(row.getByRole('button', { name: '打开文件' }));
  expect(onOpen).toHaveBeenCalledWith('new.txt');
  expect(selectedFile.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(row.getByRole('button', { name: '暂存更改' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  expect(stageFiles).toHaveBeenCalledWith('/repo', ['old.txt', 'new.txt']);
  const stagedRow = within(screen.getByRole('button', { name: 'staged.txt' }).closest<HTMLElement>('.git-changes-file')!);
  expect(stagedRow.queryByRole('button', { name: '丢弃更改' })).toBeNull();
  fireEvent.click(stagedRow.getByRole('button', { name: '取消暂存' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
  expect(unstageFiles).toHaveBeenCalledWith('/repo', ['staged.txt']);
  fireEvent.click(row.getByRole('button', { name: '丢弃更改' }));
  expect(confirm).toHaveBeenCalled();
  expect(discardUnstaged).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(row.getByRole('button', { name: '丢弃更改' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(3));
  expect(discardUnstaged).toHaveBeenCalledWith('/repo', ['old.txt', 'new.txt']);
});

it('batches only the selected group, includes filtered files and rename paths, and confirms discard once', async () => {
  const reviewState = { ...state, unstagedSummary: { files: [...state.unstagedSummary!.files, file('hidden.txt')], additions: 2, deletions: 2 } };
  let finishStage!: (result: DesktopReviewActionResult) => void;
  const stageFiles = vi.fn(() => new Promise<DesktopReviewActionResult>((resolve) => { finishStage = resolve; }));
  const unstageFiles = vi.fn().mockResolvedValue({ ok: true, state });
  const discardUnstaged = vi.fn().mockResolvedValue({ ok: true, state });
  const onRefresh = vi.fn();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(surface(createBridge({ stageFiles, unstageFiles, discardUnstaged }), { reviewState, onRefresh }));

  fireEvent.click(screen.getByRole('button', { name: '更多 Git 操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '筛选变更文件' }));
  fireEvent.change(screen.getByRole('textbox', { name: '筛选变更文件' }), { target: { value: 'new.txt' } });
  const group = within(screen.getByRole('button', { name: 'new.txt' }).closest<HTMLElement>('.git-changes-files__group')!);
  const heading = group.getByRole('button', { name: '更改', expanded: true });
  const stageButton = screen.getByRole('button', { name: '暂存全部更改' });
  fireEvent.click(stageButton);
  fireEvent.click(stageButton);
  expect(stageFiles).toHaveBeenCalledExactlyOnceWith('/repo', ['old.txt', 'new.txt', 'hidden.txt']);
  expect((screen.getByRole('button', { name: '丢弃全部更改' }) as HTMLButtonElement).disabled).toBe(true);
  expect(heading.getAttribute('aria-expanded')).toBe('true');
  await act(async () => { finishStage({ ok: true, state }); });
  expect(onRefresh).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: '丢弃全部更改' }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm.mock.calls[0][0]).toContain('2 个文件');
  expect(discardUnstaged).not.toHaveBeenCalled();
  confirm.mockClear().mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '丢弃全部更改' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
  expect(confirm).toHaveBeenCalledOnce();
  expect(discardUnstaged).toHaveBeenCalledExactlyOnceWith('/repo', ['old.txt', 'new.txt', 'hidden.txt']);

  fireEvent.change(screen.getByRole('textbox', { name: '筛选变更文件' }), { target: { value: '' } });
  const stagedGroup = within(screen.getByRole('button', { name: '暂存的更改' }).closest<HTMLElement>('.git-changes-files__group')!);
  expect(stagedGroup.queryByRole('button', { name: '丢弃全部更改' })).toBeNull();
  fireEvent.click(stagedGroup.getByRole('button', { name: '取消全部暂存' }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(3));
  expect(unstageFiles).toHaveBeenCalledExactlyOnceWith('/repo', ['staged.txt']);
});

it('opens the complete group diff, including deleted files, and can return to a single file', async () => {
  const reviewState = { ...state, unstagedSummary: { files: [file('first.txt'), { ...file('deleted.txt'), action: 'Deleted' as const }], additions: 1, deletions: 2 } };
  const view = render(surface(createBridge({}), { reviewState }));
  const group = within(screen.getByRole('button', { name: 'first.txt' }).closest<HTMLElement>('.git-changes-files__group')!);
  fireEvent.click(group.getByRole('button', { name: '更改' }));
  fireEvent.click(group.getByRole('button', { name: '打开全部更改' }));
  expect(view.container.querySelector('.git-changes-panel__body')?.classList.contains('has-detail')).toBe(true);
  const diff = within(view.container.querySelector<HTMLElement>('.git-history-diff')!);
  expect(diff.getByText('变更文件 · 2')).toBeTruthy();
  expect(diff.getByText('first.txt')).toBeTruthy();
  expect(diff.getByText('deleted.txt')).toBeTruthy();
  fireEvent.click(group.getByRole('button', { name: '更改' }));
  fireEvent.click(group.getByRole('button', { name: 'first.txt' }));
  expect(diff.queryByText('deleted.txt')).toBeNull();
  await waitFor(() => expect(group.getByRole('button', { name: 'first.txt' }).getAttribute('aria-pressed')).toBe('true'));
});


it.each(['pull', 'sync'] as const)('keeps %s recovery details available until dismissed and shows subsequent failures', async (kind) => {
  const recoveryCommand = `git stash apply --index ${'d'.repeat(40)}`;
  const gitError = `Rebase conflict\n原始暂存与未暂存改动已保留，请使用 ${recoveryCommand} 恢复。`;
  const resolveGitConflicts = vi.fn<ReviewRendererService['resolveGitConflicts']>().mockResolvedValue({ started: true, threadId: 'repair-thread', turnId: 'repair', operation: kind, createdAt: '2026-09-10T00:00:00Z' });
  const operations = kind === 'pull'
    ? { pull: vi.fn().mockRejectedValue(new Error(gitError)) }
    : { commit: vi.fn().mockResolvedValue({ ok: true, commitHash: 'abc', pushed: false, syncError: gitError, state }) };
  render(surface(createBridge(operations), { service: { ...createNoopReviewRendererService(), available: true, resolveGitConflicts } }));
  const input = screen.getByRole('textbox', { name: '提交消息' }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Local draft' } });
  fireEvent.click(screen.getByRole('button', { name: kind === 'pull' ? '更多 Git 操作' : '提交选项' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: kind === 'pull' ? '拉取' : '提交和同步' }));
  await waitFor(() => expect(resolveGitConflicts).toHaveBeenCalledExactlyOnceWith({ threadId: 'thread_1', workspaceRoot: '/repo', modelSelection: undefined, language: 'zh-CN', operation: kind }));
  const alert = await screen.findByRole('alert');
  const details = alert.querySelector('details')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('summary')?.textContent).toBe('Git 操作未完成');
  fireEvent.click(within(alert).getByTitle('查看错误详情'));
  expect(details.open).toBe(true);
  expect(details.querySelector('pre')?.textContent).toContain(recoveryCommand);
  expect(input.value).toBe(kind === 'pull' ? 'Local draft' : '');
  expect((await screen.findByRole('region', { name: 'Conflict task' })).getAttribute('data-thread-id')).toBe('repair-thread');
  fireEvent.click(screen.getByRole('button', { name: 'Back to changes' }));
  expect(screen.getByRole('alert').textContent).toContain(recoveryCommand);
  expect(screen.queryByRole('region', { name: 'Conflict task' })).toBeNull();
  expect(screen.queryByRole('button', { name: '查看冲突处理' })).toBeNull();
  fireEvent.click(within(screen.getByRole('region', { name: '冲突处理记录' })).getByRole('button', { name: kind === 'pull' ? /拉取冲突 · 1/ : /同步冲突 · 1/ }));
  expect(screen.getByRole('region', { name: 'Conflict task' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(input.value).toBe(kind === 'pull' ? 'Local draft' : '');
  expect(screen.getByRole('region', { name: 'Conflict task' }).getAttribute('data-thread-id')).toBe('repair-thread');
  expect(kind === 'pull' ? operations.pull : operations.commit).toHaveBeenCalledTimes(1);
  expect(resolveGitConflicts).toHaveBeenCalledTimes(1);

  await waitFor(() => expect(input.disabled).toBe(false));
  fireEvent.change(input, { target: { value: 'Next draft' } });
  fireEvent.click(screen.getByRole('button', { name: kind === 'pull' ? '更多 Git 操作' : '提交选项' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: kind === 'pull' ? '拉取' : '提交和同步' }));
  const nextAlert = await screen.findByRole('alert');
  expect(nextAlert.querySelector('details')?.open).toBe(false);
  expect(nextAlert.textContent).toContain(recoveryCommand);
  expect(resolveGitConflicts).toHaveBeenCalledTimes(2);
});


it('keeps multiple conflict transcripts per workspace, deduplicates the active task, and allows reopening older records', async () => {
  const resolveGitConflicts = vi.fn<ReviewRendererService['resolveGitConflicts']>()
    .mockResolvedValueOnce({ started: true, threadId: 'first-repair', turnId: 'first-turn', operation: 'pull', createdAt: '2026-09-10T00:00:00Z' })
    .mockResolvedValue({ started: true, threadId: 'second-repair', turnId: 'second-turn', operation: 'pull', createdAt: '2026-09-10T00:01:00Z' });
  const service = { ...createNoopReviewRendererService(), available: true, resolveGitConflicts };
  const bridge = createBridge({ pull: vi.fn().mockRejectedValue(new Error('Merge conflict')) });
  const view = render(surface(bridge, { service }));
  const pull = async () => {
    const previousCalls = resolveGitConflicts.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '更多 Git 操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '拉取' }));
    await waitFor(() => expect(resolveGitConflicts).toHaveBeenCalledTimes(previousCalls + 1));
    expect((await screen.findByRole('alert')).textContent).toContain('Merge conflict');
  };
  await pull();
  await pull();
  await pull();
  const history = within(screen.getByRole('region', { name: '冲突处理记录' }));
  expect(history.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('region', { name: 'Conflict task' }).getAttribute('data-thread-id')).toBe('second-repair');
  fireEvent.click(history.getByRole('button', { name: /拉取冲突 · 1/ }));
  expect(screen.getByRole('region', { name: 'Conflict task' }).getAttribute('data-thread-id')).toBe('first-repair');
  fireEvent.click(history.getByRole('button', { name: /^冲突\s*2$/ }));
  expect(history.queryByRole('list')).toBeNull();
  fireEvent.click(history.getByRole('button', { name: /^冲突\s*2$/ }));
  expect(history.getAllByRole('listitem')).toHaveLength(2);
  view.rerender(surface(bridge, { service, root: '/another-repo' }));
  expect(screen.queryByRole('region', { name: '冲突处理记录' })).toBeNull();
  view.rerender(surface(bridge, { service }));
  expect(within(screen.getByRole('region', { name: '冲突处理记录' })).getAllByRole('listitem')).toHaveLength(2);
});

it('reloads durable conflict records after the entire review surface has been closed', async () => {
  const records = [
    { threadId: 'repair-new', turnId: 'turn-new', createdAt: '2026-09-10T01:00:00Z', operation: 'rebase' as const },
    { threadId: 'repair-old', turnId: 'turn-old', createdAt: '2026-09-09T01:00:00Z', operation: 'pull' as const },
  ];
  const readGitConflictHistory = vi.fn<ReviewRendererService['readGitConflictHistory']>(async ({ workspaceRoot }) => workspaceRoot === '/repo' ? records : []);
  const service = { ...createNoopReviewRendererService(), available: true, readGitConflictHistory };
  const bridge = createBridge();
  const first = render(surface(bridge, { service }));
  await screen.findByRole('button', { name: /变基冲突 · 2/ });
  first.unmount();
  const reopened = render(surface(bridge, { service }));
  const older = await screen.findByRole('button', { name: /拉取冲突 · 1/ });
  fireEvent.click(older);
  expect(screen.getByRole('region', { name: 'Conflict task' }).getAttribute('data-thread-id')).toBe('repair-old');
  expect(readGitConflictHistory).toHaveBeenCalledTimes(2);
  reopened.rerender(surface(bridge, { service, root: '/another-repo' }));
  expect(screen.queryByRole('region', { name: '冲突处理记录' })).toBeNull();
});

it.each(['no-conflicts', 'disabled'] as const)('retains pull errors when conflict resolution is %s', async (reason) => {
  const resolveGitConflicts = vi.fn<ReviewRendererService['resolveGitConflicts']>().mockResolvedValue({ started: false, reason });
  render(surface(createBridge({ pull: vi.fn().mockRejectedValue(new Error('Pull failed')) }), {
    service: { ...createNoopReviewRendererService(), available: true, resolveGitConflicts },
  }));
  fireEvent.click(screen.getByRole('button', { name: '更多 Git 操作' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '拉取' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Pull failed');
  expect(screen.queryByRole('region', { name: '冲突处理记录' })).toBeNull();
});


it('archives single conflict records from the row and context menu, preserving failed writes and persisted visibility', async () => {
  const records = [
    { threadId: 'repair-new', turnId: 'turn-new', createdAt: '2026-09-10T01:00:00Z', operation: 'rebase' as const, archived: false },
    { threadId: 'repair-old', turnId: 'turn-old', createdAt: '2026-09-09T01:00:00Z', operation: 'pull' as const, archived: false },
  ];
  const readGitConflictHistory = vi.fn<ReviewRendererService['readGitConflictHistory']>(async () => records.map((record) => ({ ...record })));
  const setGitConflictArchived = vi.fn<ReviewRendererService['setGitConflictArchived']>(async ({ threadId, archived }) => {
    const record = records.find((item) => item.threadId === threadId)!;
    record.archived = archived;
    return { ...record };
  });
  const service = { ...createNoopReviewRendererService(), available: true, readGitConflictHistory, setGitConflictArchived };
  const bridge = createBridge({});
  const view = render(surface(bridge, { service }));
  const latest = await screen.findByRole('button', { name: /变基冲突 · 2/ });
  fireEvent.click(within(latest.closest('[role="listitem"]') as HTMLElement).getByRole('button', { name: '归档记录' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /变基冲突 · 2/ })).toBeNull());
  expect(setGitConflictArchived).toHaveBeenCalledExactlyOnceWith({ workspaceRoot: '/repo', threadId: 'repair-new', archived: true });
  expect(screen.queryByRole('region', { name: 'Conflict task' })).toBeNull();
  expect(screen.getByRole('button', { name: /拉取冲突 · 1/ })).toBeTruthy();

  view.unmount();
  render(surface(bridge, { service }));
  await screen.findByRole('button', { name: /拉取冲突 · 1/ });
  expect(screen.queryByRole('button', { name: /变基冲突 · 2/ })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Conflict task' })).toBeNull();
  const remaining = screen.getByRole('button', { name: /拉取冲突 · 1/ });
  fireEvent.click(remaining);
  setGitConflictArchived.mockRejectedValueOnce(new Error('Disk unavailable'));
  fireEvent.contextMenu(remaining);
  fireEvent.click(await screen.findByRole('menuitem', { name: '归档记录' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '归档全部冲突记录' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByRole('region', { name: 'Conflict task' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /拉取冲突 · 1/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '归档记录' }));
  await screen.findByText('暂无未归档记录');
  expect(setGitConflictArchived).toHaveBeenLastCalledWith({ workspaceRoot: '/repo', threadId: 'repair-old', archived: true });
  expect(screen.queryByRole('region', { name: 'Conflict task' })).toBeNull();
});

it('archives all visible conflict records from the header and retries only the records whose writes failed', async () => {
  const records = [
    { threadId: 'first', turnId: 'first-turn', createdAt: '2026-09-10T02:00:00Z', operation: 'rebase' as const, archived: false },
    { threadId: 'second', turnId: 'second-turn', createdAt: '2026-09-10T01:00:00Z', operation: 'pull' as const, archived: false },
    { threadId: 'archived', turnId: 'archived-turn', createdAt: '2026-09-10T00:00:00Z', operation: 'pull' as const, archived: true },
  ];
  let failSecond = true;
  const setGitConflictArchived = vi.fn<ReviewRendererService['setGitConflictArchived']>(async ({ threadId, archived }) => {
    if (threadId === 'second' && failSecond) { failSecond = false; throw new Error('Disk unavailable'); }
    const task = records.find((entry) => entry.threadId === threadId)!;
    task.archived = archived;
    return { ...task };
  });
  const service = { ...createNoopReviewRendererService(), available: true, setGitConflictArchived,
    readGitConflictHistory: async () => records.map((entry) => ({ ...entry })),
  };
  render(surface(createBridge({}), { service }));
  fireEvent.click(await screen.findByRole('button', { name: /拉取冲突 · 2/ }));
  const archiveAll = screen.getByRole('button', { name: '归档全部冲突记录' }) as HTMLButtonElement;
  fireEvent.click(archiveAll);
  await waitFor(() => expect(setGitConflictArchived).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(archiveAll.disabled).toBe(false));
  expect(screen.queryByRole('button', { name: /变基冲突 · 3/ })).toBeNull();
  expect(screen.getByRole('button', { name: /拉取冲突 · 2/ })).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Conflict task' }).getAttribute('data-thread-id')).toBe('second');
  fireEvent.click(archiveAll);
  await screen.findByText('暂无未归档记录');
  expect(archiveAll.disabled).toBe(true);
  expect(screen.queryByRole('region', { name: 'Conflict task' })).toBeNull();
  expect(setGitConflictArchived.mock.calls.map(([input]) => input)).toEqual([
    { workspaceRoot: '/repo', threadId: 'first', archived: true },
    { workspaceRoot: '/repo', threadId: 'second', archived: true },
    { workspaceRoot: '/repo', threadId: 'second', archived: true },
  ]);
});
