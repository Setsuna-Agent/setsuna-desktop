// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeInlineMessageAttachment, RuntimeStoredMessageAttachment, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useBrowserAnnotationSend } from '../../../../../src/features/chat/hooks/useBrowserAnnotationSend.js';
import { useChatTurnActions } from '../../../../../src/features/chat/hooks/useChatTurnActions.js';
import { chatComposerTargetIdentity, useChatComposerSession } from '../../../../../src/features/chat/hooks/useChatComposerSession.js';
import { useChatStarterLocation } from '../../../../../src/features/chat/hooks/useChatStarterLocation.js';
import { useChatSubmissionQueue } from '../../../../../src/features/chat/hooks/useChatSubmissionQueue.js';

afterEach(cleanup);

const image: RuntimeInlineMessageAttachment = {
  id: 'annotation', name: 'annotation.png', type: 'image/png', size: 5, url: 'data:image/png;base64,aW1hZ2U=',
};
const stored: RuntimeStoredMessageAttachment = {
  id: 'stored-image', name: image.name, type: image.type, size: image.size, source: 'runtime', assetId: 'asset-1',
};

function useSenders({ identity, client, sendInput: submit, draft = '' }: Parameters<typeof useBrowserAnnotationSend>[0] & { draft?: string }) {
  const sendInput = useChatSubmissionQueue({ identity, draft, sendInput: submit });
  const sendAnnotation = useBrowserAnnotationSend({ identity, client, sendInput });
  return { sendInput, sendAnnotation };
}

function setup() {
  let finishUpload!: (attachment: RuntimeStoredMessageAttachment) => void;
  const uploadAttachment = vi.fn(() => new Promise<RuntimeStoredMessageAttachment>((resolve) => { finishUpload = resolve; }));
  const sendTurn = vi.fn(async () => ({ accepted: true as const, turnId: 'turn-A' }));
  const setActiveTurnId = vi.fn();
  const deleteAttachment = vi.fn(async (_assetId: string) => ({ deleted: true }));
  const client = { uploadAttachment, deleteAttachment, sendTurn } as unknown as DesktopRuntimeClient;
  const hook = renderHook(({ chatId }) => {
    const currentThread: RuntimeThread = {
      id: chatId, title: chatId, createdAt: '', updatedAt: '', archived: false,
      messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
    };
    const actions = useChatTurnActions({
      activeProjectId: null, activeTurnId: null, client, currentThread, composerKey: chatId,
      claimComposerForThread: vi.fn(), draft: '', reloadThreads: async () => undefined,
      setActiveTurnId, setCurrentThread: vi.fn(), setDraft: vi.fn(), setError: vi.fn(),
      terminalTurnIdsRef: { current: new Set<string>() },
    });
    return useSenders({ identity: chatId, client, sendInput: actions.sendInput }).sendAnnotation;
  }, { initialProps: { chatId: 'A' } });
  return { ...hook, uploadAttachment, deleteAttachment, sendTurn, setActiveTurnId, finishUpload: () => finishUpload(stored) };
}

it.each(['B', 'A'])('does not send or write an active turn after switching A → B during upload and ending on %s', async (destination) => {
  const view = setup();
  const pending = view.result.current('Page feedback', [image]);
  expect(view.uploadAttachment).toHaveBeenCalledOnce();
  view.rerender({ chatId: 'B' });
  if (destination === 'A') view.rerender({ chatId: 'A' });
  await act(async () => {
    view.finishUpload();
    expect(await pending).toBe(false);
  });
  expect(view.sendTurn).not.toHaveBeenCalled();
  expect(view.setActiveTurnId).not.toHaveBeenCalled();
  expect(view.deleteAttachment).toHaveBeenCalledExactlyOnceWith(stored.assetId);
});

it('uploads the original image and sends it when the chat still owns the request', async () => {
  const view = setup();
  const pending = view.result.current('Page feedback', [image]);
  // An ordinary render of the same chat must not cancel the operation.
  view.rerender({ chatId: 'A' });
  await act(async () => { view.finishUpload(); });
  expect(await pending).toBe(true);
  expect(view.uploadAttachment).toHaveBeenCalledExactlyOnceWith({
    name: image.name, type: image.type, data: Uint8Array.from([105, 109, 97, 103, 101]),
  });
  expect(view.sendTurn).toHaveBeenCalledExactlyOnceWith('A', expect.objectContaining({
    input: 'Page feedback', attachments: [stored],
  }));
  expect(view.setActiveTurnId).toHaveBeenLastCalledWith('turn-A');
  expect(view.deleteAttachment).not.toHaveBeenCalled();
});

it('rejects a callback retained by an earlier screenshot capture, even after returning to the same chat', async () => {
  const view = setup();
  const oldSend = view.result.current;
  view.rerender({ chatId: 'B' });
  view.rerender({ chatId: 'A' });
  expect(await oldSend('Old feedback', [image])).toBe(false);
  expect(view.uploadAttachment).not.toHaveBeenCalled();
  expect(view.sendTurn).not.toHaveBeenCalled();
});

it('does not send after unmounting during upload', async () => {
  const view = setup();
  const pending = view.result.current('Page feedback', [image]);
  view.unmount();
  view.finishUpload();
  expect(await pending).toBe(false);
  expect(view.sendTurn).not.toHaveBeenCalled();
  expect(view.setActiveTurnId).not.toHaveBeenCalled();
  expect(view.deleteAttachment).toHaveBeenCalledExactlyOnceWith(stored.assetId);
});

it.each([['first', 'second'], ['second', 'first']])('sends both panel batches when uploads finish %s then %s', async (earlier, later) => {
  const uploads = new Map<string, (attachment: RuntimeStoredMessageAttachment) => void>();
  const uploadAttachment = vi.fn(({ name }: { name: string }) => new Promise<RuntimeStoredMessageAttachment>((resolve) => {
    uploads.set(name, resolve);
  }));
  let finishWorkspaceCheck!: (ready: boolean) => void;
  const beforeSend = vi.fn<() => Promise<boolean>>()
    .mockImplementationOnce(() => new Promise((resolve) => { finishWorkspaceCheck = resolve; }))
    .mockResolvedValue(true);
  const queueTurnInput = vi.fn(async (_threadId: string, _input: { input: string }) => ({ accepted: true as const }));
  const client = { uploadAttachment, queueTurnInput, deleteAttachment: vi.fn(async () => ({ deleted: true })) } as unknown as DesktopRuntimeClient;
  const { result } = renderHook(() => {
    const actions = useChatTurnActions({
      activeProjectId: null, activeTurnId: 'running-turn', beforeSend, client,
      currentThread: { id: 'A' } as RuntimeThread, composerKey: 'chat-A',
      claimComposerForThread: vi.fn(), draft: '', reloadThreads: async () => undefined,
      setActiveTurnId: vi.fn(), setCurrentThread: vi.fn(), setDraft: vi.fn(), setError: vi.fn(),
      terminalTurnIdsRef: { current: new Set<string>() },
    });
    return useSenders({ identity: 'chat-A', client, sendInput: actions.sendInput }).sendAnnotation;
  });
  const pending = new Map(['first', 'second'].map((panel) => [panel, result.current(`${panel} feedback`, [{ ...image, name: panel }])]));
  expect(uploadAttachment).toHaveBeenCalledTimes(2);
  for (const panel of [earlier, later]) {
    const attachment = { ...stored, id: panel, assetId: panel, name: panel };
    await act(async () => { uploads.get(panel)!(attachment); });
    // The later upload may finish, but it must not invalidate the first workspace check.
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(queueTurnInput).not.toHaveBeenCalled();
  }
  await act(async () => { finishWorkspaceCheck(true); });
  expect(await Promise.all(pending.values())).toEqual([true, true]);
  expect(queueTurnInput).toHaveBeenCalledTimes(2);
  for (const [index, panel] of [earlier, later].entries()) {
    expect(queueTurnInput).toHaveBeenNthCalledWith(index + 1, 'A', expect.objectContaining({
      input: `${panel} feedback`, attachments: [{ ...stored, id: panel, assetId: panel, name: panel }],
    }));
  }
});

it.each(['ordinary', 'annotation'])('reuses the thread and active turn claimed by the first %s message', async (firstMessage) => {
  const uploads: Array<(attachment: RuntimeStoredMessageAttachment) => void> = [];
  const uploadAttachment = vi.fn(() => new Promise<RuntimeStoredMessageAttachment>((resolve) => { uploads.push(resolve); }));
  const thread: RuntimeThread = {
    id: 'A', title: 'A', createdAt: '', updatedAt: '', archived: false,
    messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
  };
  const createThread = vi.fn(async () => thread);
  const sendTurn = vi.fn(async () => ({ accepted: true as const, turnId: 'ordinary-turn' }));
  const queueTurnInput = vi.fn(async () => ({ accepted: true as const }));
  const client = { uploadAttachment, createThread, sendTurn, queueTurnInput, deleteAttachment: vi.fn(async () => ({ deleted: true })) } as unknown as DesktopRuntimeClient;
  const { result } = renderHook(() => {
    const [currentThread, setCurrentThread] = useState<RuntimeThread | null>(null);
    const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
    const composer = useChatComposerSession(chatComposerTargetIdentity(currentThread?.id, null), client);
    const actions = useChatTurnActions({
      activeProjectId: null, activeTurnId, client, currentThread, composerKey: composer.composerKey,
      claimComposerForThread: composer.claimForThread, draft: composer.draft,
      reloadThreads: async () => undefined, setActiveTurnId, setCurrentThread,
      setDraft: composer.setDraft, setError: vi.fn(), terminalTurnIdsRef: { current: new Set<string>() },
    });
    const starter = useChatStarterLocation({
      identity: composer.composerKey, canCreateWorktree: false, hasThread: Boolean(currentThread), onSend: actions.sendInput,
    });
    const senders = useSenders({ identity: composer.composerKey, draft: composer.draft, client, sendInput: starter.sendInput });
    return { composerKey: composer.composerKey, currentThread, ...senders };
  });
  const composerKey = result.current.composerKey;
  const pending = result.current.sendAnnotation('Page feedback', [image]);
  if (firstMessage === 'ordinary') {
    let first!: Promise<boolean>;
    await act(async () => { first = result.current.sendInput('First message'); });
    expect(await first).toBe(true);
    await act(async () => { uploads[0](stored); });
  } else {
    const first = result.current.sendAnnotation('First message', [image]);
    // Both uploads are ready before creation finishes. The next send must see the committed thread.
    await act(async () => { uploads[1](stored); uploads[0](stored); });
    expect(await first).toBe(true);
  }
  expect(result.current.currentThread?.id).toBe('A');
  expect(result.current.composerKey).toBe(composerKey);
  expect(await pending).toBe(true);
  expect(createThread).toHaveBeenCalledOnce();
  expect(sendTurn).toHaveBeenCalledExactlyOnceWith('A', expect.objectContaining({ input: 'First message' }));
  expect(queueTurnInput).toHaveBeenCalledExactlyOnceWith('A', expect.objectContaining({ input: 'Page feedback', attachments: [stored] }));
  expect(result.current.currentThread?.id).toBe('A');
});

it.each(['switch', 'unmount'])('discards waiting submissions on %s without blocking a new chat', async (change) => {
  let finishFirst!: (accepted: boolean) => void;
  const sendInput = vi.fn()
    .mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishFirst = resolve; }))
    .mockResolvedValue(true);
  const deleteAttachment = vi.fn(async (_assetId: string) => ({ deleted: true }));
  let uploadId = 0;
  const client = { uploadAttachment: vi.fn(async () => ({ ...stored, assetId: `asset-${++uploadId}` })), deleteAttachment };
  const view = renderHook(({ identity }) => useSenders({ identity, client, sendInput }).sendAnnotation, {
    initialProps: { identity: 'A' },
  });
  const first = view.result.current('First', [image]);
  const waiting = view.result.current('Waiting in A', [image]);
  await act(async () => undefined);
  expect(sendInput).toHaveBeenCalledOnce();
  if (change === 'switch') {
    view.rerender({ identity: 'B' });
    const next = view.result.current('Send in B', [image]);
    await act(async () => undefined);
    expect(await next).toBe(true);
    expect(sendInput).toHaveBeenLastCalledWith('Send in B', { attachments: [{ ...stored, assetId: 'asset-3' }], preserveDraft: true });
  } else view.unmount();
  expect(await waiting).toBe(false);
  expect(deleteAttachment).toHaveBeenCalledExactlyOnceWith('asset-2');
  await act(async () => { finishFirst(false); });
  expect(await first).toBe(false);
  expect(sendInput).toHaveBeenCalledTimes(change === 'switch' ? 2 : 1);
  expect(deleteAttachment.mock.calls.map(([id]) => id)).toEqual(['asset-2', 'asset-1']);
});

it('continues with the next panel after a submission rejects', async () => {
  const failure = new Error('Workspace check failed');
  const sendInput = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(true);
  const client = { uploadAttachment: vi.fn(async () => stored), deleteAttachment: vi.fn(async () => ({ deleted: true })) };
  const { result } = renderHook(() => useSenders({ identity: 'A', client, sendInput }).sendAnnotation);
  const first = result.current('First', [image]).catch((error: unknown) => error);
  const next = result.current('Next', [image]);
  await act(async () => undefined);
  expect(await first).toBe(failure);
  expect(await next).toBe(true);
  expect(sendInput).toHaveBeenCalledTimes(2);
});

it.each(['ordinary', 'annotation'])('serializes mixed sends while the first %s message waits for its workspace check', async (firstKind) => {
  let finishCheck!: (ready: boolean) => void;
  const beforeSend = vi.fn<() => Promise<boolean>>()
    .mockImplementationOnce(() => new Promise((resolve) => { finishCheck = resolve; }))
    .mockResolvedValue(true);
  const queueTurnInput = vi.fn(async (_threadId: string, _input: { input: string }) => ({ accepted: true as const }));
  const client = {
    uploadAttachment: vi.fn(async () => stored), deleteAttachment: vi.fn(), queueTurnInput,
  } as unknown as DesktopRuntimeClient;
  const { result } = renderHook(() => {
    const [draft, setDraft] = useState('Ordinary feedback');
    const actions = useChatTurnActions({
      activeProjectId: null, activeTurnId: 'running-turn', beforeSend, client,
      currentThread: { id: 'A' } as RuntimeThread, composerKey: 'A',
      claimComposerForThread: vi.fn(), draft, setDraft, reloadThreads: async () => undefined,
      setActiveTurnId: vi.fn(), setCurrentThread: vi.fn(), setError: vi.fn(),
      terminalTurnIdsRef: { current: new Set<string>() },
    });
    return { ...useSenders({ identity: 'A', draft, client, sendInput: actions.sendInput }), draft, setDraft };
  });
  const submit = (kind: string) => kind === 'ordinary'
    ? result.current.sendInput()
    : result.current.sendAnnotation('Page feedback', [image]);
  let first!: Promise<boolean>;
  let next!: Promise<boolean>;
  await act(async () => { first = submit(firstKind); });
  await act(async () => { next = submit(firstKind === 'ordinary' ? 'annotation' : 'ordinary'); });
  act(() => result.current.setDraft('Newer draft'));
  expect(beforeSend).toHaveBeenCalledOnce();
  expect(queueTurnInput).not.toHaveBeenCalled();
  await act(async () => { finishCheck(true); });
  expect(await Promise.all([first, next])).toEqual([true, true]);
  expect(queueTurnInput.mock.calls.map(([, input]) => input.input)).toEqual(firstKind === 'ordinary'
    ? ['Ordinary feedback', 'Page feedback'] : ['Page feedback', 'Ordinary feedback']);
  expect(result.current.draft).toBe('Newer draft');
});

it.each(['workspace', 'creation', 'submission'])('keeps annotation retry input out of the composer after %s failure', async (stage) => {
  const failure = new Error('Cannot send');
  const deleteAttachment = vi.fn(async () => ({ deleted: true }));
  const client = {
    uploadAttachment: vi.fn(async () => stored), deleteAttachment,
    createThread: vi.fn(async () => { throw failure; }),
    sendTurn: vi.fn(async () => { throw failure; }),
  } as unknown as DesktopRuntimeClient;
  const { result } = renderHook(() => {
    const [draft, setDraft] = useState('');
    const actions = useChatTurnActions({
      activeProjectId: null, activeTurnId: null, client, composerKey: 'A',
      beforeSend: async () => { if (stage === 'workspace') throw failure; return true; },
      currentThread: stage === 'creation' ? null : { id: 'A' } as RuntimeThread,
      claimComposerForThread: vi.fn(), draft, setDraft, reloadThreads: async () => undefined,
      setActiveTurnId: vi.fn(), setCurrentThread: vi.fn(), setError: vi.fn(),
      terminalTurnIdsRef: { current: new Set<string>() },
    });
    return { ...useSenders({ identity: 'A', draft, client, sendInput: actions.sendInput }), draft };
  });
  let pending!: Promise<boolean>;
  await act(async () => { pending = result.current.sendAnnotation('Page feedback with DOM context', [image]); });
  expect(await pending).toBe(false);
  expect(result.current.draft).toBe('');
  expect(deleteAttachment).toHaveBeenCalledExactlyOnceWith(stored.assetId);
  // Ordinary submissions still restore their own input for retry.
  await act(async () => { pending = result.current.sendInput('Ordinary retry'); });
  expect(await pending).toBe(false);
  expect(result.current.draft).toBe('Ordinary retry');
});
