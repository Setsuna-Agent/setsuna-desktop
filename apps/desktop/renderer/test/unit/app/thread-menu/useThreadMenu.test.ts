// @vitest-environment happy-dom
import type { DesktopRuntimeClient, RuntimeThread, RuntimeThreadSummary, WorkspaceStatus } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { ConfirmationProvider } from '@setsuna-desktop/renderer-ui';
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useThreadMenu } from '../../../../src/app/thread-menu/useThreadMenu.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const source: RuntimeThread = {
  id: 'unselected', projectId: 'project', workspaceId: 'worktree', title: '', archived: false,
  createdAt: '', updatedAt: '', messageCount: 2, lastMessagePreview: '', lastSeq: 7,
  messages: [
    { id: 'prompt', role: 'user', content: 'Prompt', createdAt: '' },
    { id: 'latest-answer', role: 'assistant', content: 'Answer', createdAt: '', status: 'complete' },
  ],
};
const workspace: WorkspaceStatus = { exists: true, readable: true, gitRoot: '/worktree',
  project: { id: 'worktree', name: 'Worktree', path: '/worktree', createdAt: '', updatedAt: '' } };
const apps = [{ id: 'vscode', label: 'VS Code', icon: 'code' }];

function setup(thread = source, status = workspace) {
  const getThread = vi.fn(async () => thread);
  const getWorkspaceStatus = vi.fn(async () => status);
  const list = vi.fn(async () => apps);
  const open = vi.fn(async () => true);
  vi.stubGlobal('setsunaDesktop', { workspaceApps: { list, open } });
  const options = { client: { getThread, getWorkspaceStatus } as unknown as DesktopRuntimeClient,
    onClose: vi.fn(), onFork: vi.fn(async (): Promise<void> => undefined),
    onDelete: vi.fn(async (_thread: RuntimeThreadSummary): Promise<void> => undefined), onError: vi.fn() };
  return { options, getThread, getWorkspaceStatus, list, open };
}

it('loads only the context target, opens its worktree, and keeps forks single-flight when the menu reopens', async () => {
  const { options, getThread, getWorkspaceStatus, list, open } = setup();
  const { result, rerender } = renderHook(({ id }: { id: string | null }) => useThreadMenu({ ...options, threadId: id }),
    { initialProps: { id: null as string | null } });
  expect(getThread).not.toHaveBeenCalled();
  rerender({ id: source.id });
  await waitFor(() => expect(result.current.apps).toEqual(apps));
  expect(getThread).toHaveBeenCalledExactlyOnceWith(source.id);
  expect(getWorkspaceStatus).toHaveBeenCalledExactlyOnceWith({ threadId: source.id });
  expect(list).toHaveBeenCalledExactlyOnceWith('/worktree');
  await act(() => result.current.openWith('vscode'));
  expect(open).toHaveBeenCalledExactlyOnceWith('/worktree', 'vscode');

  let finish!: () => void;
  options.onFork.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = result.current.fork('worktree'); void result.current.fork('workspace'); });
  expect(options.onFork).toHaveBeenCalledExactlyOnceWith(source.id, { messageId: 'latest-answer', target: 'worktree' });
  rerender({ id: null });
  rerender({ id: source.id });
  await waitFor(() => expect(result.current.apps).toEqual(apps));
  expect(result.current.canFork).toBe(false);
  await act(() => result.current.fork('workspace'));
  expect(options.onFork).toHaveBeenCalledOnce();
  await act(async () => { finish(); await pending; });
  expect(result.current.canFork).toBe(true);
});

it('ignores a previous target response after another context menu has opened', async () => {
  const { options, getThread, list } = setup();
  let finish!: (thread: RuntimeThread) => void;
  getThread.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { result, rerender } = renderHook(({ id }) => useThreadMenu({ ...options, threadId: id }),
    { initialProps: { id: 'old-target' } });
  rerender({ id: source.id });
  await waitFor(() => expect(result.current.apps).toEqual(apps));
  await act(async () => finish({ ...source, id: 'old-target' }));
  await act(() => result.current.fork('workspace'));
  expect(options.onFork).toHaveBeenCalledExactlyOnceWith(source.id, { messageId: 'latest-answer', target: 'workspace' });
  expect(list).toHaveBeenCalledOnce();
});

it.each([
  { ...source, messages: [] },
  { ...source, activeTurnId: 'running' },
  { ...source, contextCompaction: { status: 'running' as const, startedAt: '' } },
])('blocks forking when the source is empty or changing ($activeTurnId)', async (thread) => {
  const { options } = setup(thread);
  const { result } = renderHook(() => useThreadMenu({ ...options, threadId: source.id }));
  await waitFor(() => expect(result.current.apps).toEqual(apps));
  expect(result.current.canFork).toBe(false);
  await act(() => result.current.fork('workspace'));
  expect(options.onFork).not.toHaveBeenCalled();
});

it('disables only worktree forks outside Git and reports action failures', async () => {
  const { options, open } = setup(source, { ...workspace, gitRoot: undefined });
  const { result } = renderHook(() => useThreadMenu({ ...options, threadId: source.id }));
  await waitFor(() => expect(result.current.apps).toEqual(apps));
  expect(result.current.canFork).toBe(true);
  expect(result.current.canCreateWorktree).toBe(false);
  await act(() => result.current.fork('worktree'));
  expect(options.onFork).not.toHaveBeenCalled();
  options.onFork.mockRejectedValueOnce(new Error('Fork failed'));
  await act(() => result.current.fork('workspace'));
  expect(options.onError).toHaveBeenCalledWith('Fork failed');
  expect(result.current.canFork).toBe(true);
  open.mockResolvedValueOnce(false);
  await act(() => result.current.openWith('vscode'));
  expect(options.onError).toHaveBeenLastCalledWith('所选打开方式当前不可用。');
});

it.each([false, true])('requires confirmation for the captured delete target after its menu closes: confirm=%s', async (confirmed) => {
  const { options } = setup();
  const target = { ...source, title: '目标对话' };
  const { result, rerender } = renderHook(({ id }: { id: string | null }) => useThreadMenu({ ...options, threadId: id }), {
    initialProps: { id: source.id as string | null },
    wrapper: ({ children }: { children: ReactNode }) => createElement(ConfirmationProvider, null, children),
  });
  let deletion!: Promise<void>;
  act(() => { deletion = result.current.deleteThread(target); });
  rerender({ id: null });
  expect(await screen.findByRole('dialog', { name: '彻底删除“目标对话”？' })).toBeTruthy();
  expect(options.onDelete).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: confirmed ? '彻底删除' : '取消' }));
    await deletion;
  });
  if (confirmed) expect(options.onDelete).toHaveBeenCalledExactlyOnceWith(target);
  else expect(options.onDelete).not.toHaveBeenCalled();
});

it('prevents duplicate deletion while pending and reports failures before allowing a retry', async () => {
  const { options } = setup();
  let rejectDelete!: (error: Error) => void;
  options.onDelete.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectDelete = reject; }));
  const { result } = renderHook(() => useThreadMenu({ ...options, threadId: null }), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(ConfirmationProvider, null, children),
  });
  let deletion!: Promise<void>;
  act(() => { deletion = result.current.deleteThread(source); });
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: '彻底删除' })); });
  await act(() => result.current.deleteThread(source));
  expect(options.onDelete).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
  await act(async () => { rejectDelete(new Error('Delete failed')); await deletion; });
  expect(options.onError).toHaveBeenCalledWith('Delete failed');
  act(() => { deletion = result.current.deleteThread(source); });
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: '彻底删除' }));
    await deletion;
  });
  expect(options.onDelete).toHaveBeenCalledTimes(2);
});
