// @vitest-environment happy-dom
import type { DesktopRuntimeClient, RuntimeThread, WorkspaceStatus } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useThreadWorkspaceRecovery } from '../../../../../src/features/workspace/hooks/useThreadWorkspaceRecovery.js';
import { useThreadWorkspace } from '../../../../../src/features/workspace/hooks/useThreadWorkspace.js';
import { useChatTurnActions } from '../../../../../src/features/chat/hooks/useChatTurnActions.js';
import { useChatComposerSession } from '../../../../../src/features/chat/hooks/useChatComposerSession.js';

afterEach(cleanup);

const thread: RuntimeThread = {
  id: 'thread', projectId: 'project', workspaceId: 'worktree', title: 'Conversation',
  createdAt: '', updatedAt: '', archived: false, lastSeq: 1, messageCount: 0, lastMessagePreview: '', messages: [],
};
const recovered: RuntimeThread = { ...thread, workspaceId: undefined, lastSeq: 2 };

it.each([false, true])('prompts only on send, preserves retry input, and sends after recovery (initially available: %s)', async (exists) => {
  const project = { id: 'worktree', name: 'Project', path: '/worktree', createdAt: '', updatedAt: '' };
  const getWorkspaceStatus = vi.fn(async () => ({ project, exists, readable: exists }));
  const sendTurn = vi.fn(async () => ({ accepted: true, turnId: 'turn' }));
  const queueTurnInput = vi.fn();
  const client = {
    getWorkspaceStatus, sendTurn, queueTurnInput, updateThread: vi.fn(async () => recovered),
    deleteAttachment: vi.fn(async () => ({ deleted: true })),
  } as unknown as DesktopRuntimeClient;
  const reloadThreads = vi.fn(async () => undefined);
  const view = renderHook(() => {
    const [current, setCurrentThread] = useState<RuntimeThread | null>(thread);
    const workspace = useThreadWorkspace({ client, thread: current });
    const composer = useChatComposerSession(`thread:${thread.id}`, client);
    const recovery = useThreadWorkspaceRecovery({ client, threadId: thread.id, setCurrentThread, reloadThreads });
    const actions = useChatTurnActions({
      activeProjectId: 'project', activeTurnId: null, client, currentThread: current,
      composerKey: composer.composerKey, claimComposerForThread: composer.claimForThread,
      draft: composer.draft, setDraft: composer.setDraft, setCurrentThread, setActiveTurnId: vi.fn(), setError: vi.fn(),
      reloadThreads, terminalTurnIdsRef: { current: new Set() }, beforeSend: workspace.ensureAvailableForSend,
    });
    return { workspace, composer, recovery, actions };
  });
  await waitFor(() => expect(view.result.current.workspace.status).toBe(exists ? 'ready' : 'missing'));
  expect(view.result.current.workspace.missingWorktreePromptOpen).toBe(false);
  getWorkspaceStatus.mockResolvedValue({ project, exists: false, readable: false });
  const asset = { id: 'asset', assetId: 'asset', source: 'runtime' as const, name: 'note.txt', type: 'text/plain', size: 1 };
  act(() => {
    view.result.current.composer.setDraft('Keep this input');
    view.result.current.composer.attachmentStore.replaceWithExisting([asset]);
  });
  const store = view.result.current.composer.attachmentStore;
  await act(async () => {
    store.beginSend([asset]);
    const sent = await view.result.current.actions.sendInput(undefined, { attachments: [asset] });
    expect(sent).toBe(false);
    store.settleSend([asset], sent);
  });
  expect(view.result.current.workspace.missingWorktreePromptOpen).toBe(true);
  expect(view.result.current.composer.draft).toBe('Keep this input');
  expect(store.getSnapshot().items.map((item) => item.attachment)).toEqual([asset]);
  expect(sendTurn).not.toHaveBeenCalled();
  expect(queueTurnInput).not.toHaveBeenCalled();
  act(() => view.result.current.workspace.dismissMissingWorktreePrompt());
  expect(view.result.current.workspace.missingWorktreePromptOpen).toBe(false);
  await act(async () => { expect(await view.result.current.actions.sendInput()).toBe(false); });
  expect(view.result.current.workspace.missingWorktreePromptOpen).toBe(true);
  await act(() => view.result.current.recovery.recover());
  expect(view.result.current.workspace.missingWorktreePromptOpen).toBe(false);
  await act(async () => {
    store.beginSend([asset]);
    const sent = await view.result.current.actions.sendInput(undefined, { attachments: [asset] });
    expect(sent).toBe(true);
    store.settleSend([asset], sent);
  });
  expect(sendTurn).toHaveBeenCalledExactlyOnceWith(thread.id, expect.objectContaining({ input: 'Keep this input', attachments: [asset] }));
});

it('ignores a missing-worktree check that finishes after navigating to another conversation', async () => {
  let finish!: (value: WorkspaceStatus) => void;
  const getWorkspaceStatus = vi.fn<DesktopRuntimeClient['getWorkspaceStatus']>()
    .mockResolvedValueOnce({ exists: false, readable: false })
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const client = { getWorkspaceStatus };
  const view = renderHook(({ current }) => useThreadWorkspace({ client, thread: current }), { initialProps: { current: thread } });
  await waitFor(() => expect(view.result.current.status).toBe('missing'));
  let check!: Promise<boolean>;
  act(() => { check = view.result.current.ensureAvailableForSend(); });
  view.rerender({ current: { ...recovered, id: 'other' } });
  await act(async () => { finish({ exists: false, readable: false }); expect(await check).toBe(false); });
  expect(view.result.current.missingWorktreePromptOpen).toBe(false);
});

it('waits for the persisted switch, deduplicates clicks, and leaves a newly selected conversation alone', async () => {
  let finish!: (value: RuntimeThread) => void;
  const updateThread = vi.fn(() => new Promise<RuntimeThread>((resolve) => { finish = resolve; }));
  const reloadThreads = vi.fn(async () => undefined);
  const view = renderHook(() => {
    const [current, setCurrentThread] = useState<RuntimeThread | null>(thread);
    const recovery = useThreadWorkspaceRecovery({ client: { updateThread }, threadId: thread.id, setCurrentThread, reloadThreads });
    return { current, setCurrentThread, ...recovery };
  });
  let request!: Promise<void>;
  act(() => {
    request = view.result.current.recover();
    void view.result.current.recover();
  });
  expect(updateThread).toHaveBeenCalledExactlyOnceWith(thread.id, { workspaceId: null });
  expect(view.result.current.current?.workspaceId).toBe('worktree');
  expect(view.result.current.pending).toBe(true);
  const other = { ...thread, id: 'other' };
  act(() => view.result.current.setCurrentThread(other));
  await act(async () => { finish(recovered); await request; });
  expect(view.result.current.current).toEqual(other);
  expect(reloadThreads).toHaveBeenCalledTimes(1);
});

it('keeps the missing binding on failure and adopts the saved project binding after retry', async () => {
  const updateThread = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(recovered);
  const reloadThreads = vi.fn(async () => undefined);
  const view = renderHook(() => {
    const [current, setCurrentThread] = useState<RuntimeThread | null>(thread);
    return { current, ...useThreadWorkspaceRecovery({ client: { updateThread }, threadId: thread.id, setCurrentThread, reloadThreads }) };
  });
  await act(() => view.result.current.recover());
  expect(view.result.current.failed).toBe(true);
  expect(view.result.current.current).toEqual(thread);
  expect(reloadThreads).not.toHaveBeenCalled();
  await act(() => view.result.current.recover());
  expect(view.result.current.failed).toBe(false);
  expect(view.result.current.current).toEqual(recovered);
  expect(reloadThreads).toHaveBeenCalledTimes(1);
});
