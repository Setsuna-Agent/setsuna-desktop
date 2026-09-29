// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { chatComposerTargetIdentity, useChatComposerSession } from '../../../../../src/features/chat/hooks/useChatComposerSession.js';
import { useChatStarterLocation } from '../../../../../src/features/chat/hooks/useChatStarterLocation.js';
import { useChatTurnActions } from '../../../../../src/features/chat/hooks/useChatTurnActions.js';

afterEach(cleanup);

it.each(['local', 'worktree'] as const)('defers %s creation until send, waits for the binding, then reuses that chat', async (workspaceMode) => {
  let finish!: (thread: RuntimeThread) => void;
  const createThread = vi.fn(() => new Promise<RuntimeThread>((resolve) => { finish = resolve; }));
  const sendTurn = vi.fn(async () => ({ accepted: true as const, turnId: 'turn' }));
  const view = renderLocation({ createThread, sendTurn });
  act(() => {
    view.result.current.composer.setDraft('First message');
    view.result.current.starter.selection.onChange(workspaceMode);
  });
  expect(createThread).not.toHaveBeenCalled();
  let pending!: Promise<boolean>;
  act(() => { pending = view.result.current.starter.sendInput(); });
  expect(createThread).toHaveBeenCalledExactlyOnceWith({ projectId: 'project', workspaceMode });
  expect(sendTurn).not.toHaveBeenCalled();
  expect(view.result.current.starter.selection.disabled).toBe(true);
  await expect(view.result.current.starter.sendInput()).resolves.toBe(false);
  await act(async () => {
    finish(newThread(workspaceMode === 'worktree' ? 'worktree_1' : undefined));
    expect(await pending).toBe(true);
  });
  expect(sendTurn).toHaveBeenCalledExactlyOnceWith('created', expect.objectContaining({ input: 'First message' }));
  expect(view.result.current.currentThread?.workspaceId).toBe(workspaceMode === 'worktree' ? 'worktree_1' : undefined);
  expect(view.result.current.composer.draft).toBe('');
  await act(async () => { expect(await view.result.current.starter.sendInput('Next message')).toBe(true); });
  expect(createThread).toHaveBeenCalledTimes(1);
  expect(sendTurn).toHaveBeenLastCalledWith('created', expect.objectContaining({ input: 'Next message' }));
});

it('retains the draft and worktree choice after creation fails and retries without sending to the source project', async () => {
  const createThread = vi.fn()
    .mockRejectedValueOnce(new Error('Worktree creation failed'))
    .mockResolvedValueOnce(newThread('worktree_1'));
  const sendTurn = vi.fn(async () => ({ accepted: true as const, turnId: 'turn' }));
  const view = renderLocation({ createThread, sendTurn });
  act(() => {
    view.result.current.composer.setDraft('Keep this input');
    view.result.current.starter.selection.onChange('worktree');
  });
  await act(async () => { expect(await view.result.current.starter.sendInput()).toBe(false); });
  expect(view.result.current.composer.draft).toBe('Keep this input');
  expect(view.result.current.starter.selection).toMatchObject({ value: 'worktree', disabled: false });
  expect(view.result.current.currentThread).toBeNull();
  expect(view.result.current.setError).toHaveBeenLastCalledWith('Worktree creation failed');
  expect(sendTurn).not.toHaveBeenCalled();
  await act(async () => { expect(await view.result.current.starter.sendInput()).toBe(true); });
  expect(createThread).toHaveBeenLastCalledWith({ projectId: 'project', workspaceMode: 'worktree' });
  expect(sendTurn).toHaveBeenCalledExactlyOnceWith('created', expect.objectContaining({ input: 'Keep this input' }));
});

it('does not carry a worktree choice into another draft or allow it without a Git project', () => {
  const createThread = vi.fn();
  const view = renderLocation({ createThread });
  act(() => view.result.current.starter.selection.onChange('worktree'));
  view.rerender({ projectId: 'plain', canCreateWorktree: false });
  expect(view.result.current.starter.selection.value).toBe('local');
  act(() => view.result.current.starter.selection.onChange('worktree'));
  expect(view.result.current.starter.selection.value).toBe('local');
  view.rerender({ projectId: 'another-git-project', canCreateWorktree: true });
  expect(view.result.current.starter.selection.value).toBe('local');
  expect(createThread).not.toHaveBeenCalled();
});

function renderLocation(clientMethods: Partial<DesktopRuntimeClient>) {
  const client = clientMethods as DesktopRuntimeClient;
  const setError = vi.fn();
  return renderHook(({ projectId, canCreateWorktree }) => {
    const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(null);
    const composer = useChatComposerSession(chatComposerTargetIdentity(currentThread?.id, projectId), client);
    const actions = useChatTurnActions({
      activeProjectId: projectId, activeTurnId: null, client, currentThread,
      claimComposerForThread: composer.claimForThread, composerKey: composer.composerKey,
      draft: composer.draft, setDraft: composer.setDraft, setCurrentThread, setActiveTurnId: vi.fn(), setError,
      reloadThreads: async () => undefined, terminalTurnIdsRef: { current: new Set() },
    });
    const starter = useChatStarterLocation({
      identity: `${composer.composerKey}:${projectId}`, canCreateWorktree,
      hasThread: Boolean(currentThread), onSend: actions.sendInput,
    });
    return { composer, starter, currentThread, setError };
  }, { initialProps: { projectId: 'project', canCreateWorktree: true } });
}

function newThread(workspaceId?: string): RuntimeThread {
  return {
    id: 'created', projectId: 'project', workspaceId, title: 'New chat', createdAt: '', updatedAt: '',
    archived: false, messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
  };
}
