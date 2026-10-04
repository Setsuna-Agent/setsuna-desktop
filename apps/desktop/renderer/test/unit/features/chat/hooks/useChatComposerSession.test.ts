// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChatAttachments } from '../../../../../src/features/chat/composer/useChatAttachments.js';
import {
  chatComposerTargetIdentity,
  transitionChatComposerSession,
  useChatComposerSession,
  type ChatComposerSessionState,
} from '../../../../../src/features/chat/hooks/useChatComposerSession.js';

afterEach(cleanup);

describe('chat composer session identity', () => {
  it('starts an empty session for a conversation with no saved draft', () => {
    const current = session('thread:A', 'draft from A', 4);
    const transition = transitionChatComposerSession(current, chatComposerTargetIdentity('B', null), null, 5);

    expect(transition).toEqual({
      claimed: false,
      state: session('thread:B', '', 5),
    });
  });

  it('claims a created thread without remounting the new-thread composer', () => {
    const current = session('new-thread-slot:project-1', 'first message', 7);
    const transition = transitionChatComposerSession(current, chatComposerTargetIdentity('created-1', null), {
      fromIdentity: 'new-thread-slot:project-1',
      sessionId: 7,
      toIdentity: 'thread:created-1',
    }, 8);

    expect(transition).toEqual({
      claimed: true,
      state: session('thread:created-1', 'first message', 7),
    });
  });

  it('rejects a stale claim from an older new-thread session', () => {
    const current = session('new-thread-slot:project-1', 'new draft', 9);
    const transition = transitionChatComposerSession(current, chatComposerTargetIdentity('created-old', null), {
      fromIdentity: 'new-thread-slot:project-1',
      sessionId: 8,
      toIdentity: 'thread:created-old',
    }, 10);

    expect(transition.claimed).toBe(false);
    expect(transition.state).toEqual(session('thread:created-old', '', 10));
  });
});

function session(
  targetIdentity: ChatComposerSessionState['targetIdentity'],
  draft: string,
  sessionId: number,
): ChatComposerSessionState {
  return { draft, skillReferences: [], sessionId, targetIdentity };
}

it('restores independent drafts and attachments after switching threads and opening a new chat', async () => {
  const client = attachmentClient();
  const view = renderHook(({ target }) => useChatComposerSession(target, client), {
    initialProps: { target: 'thread:A' as ChatComposerSessionState['targetIdentity'] },
  });
  act(() => view.result.current.setDraft('A: 未发送\n下一行'));
  const trayA = renderHook(() => useChatAttachments({ client, store: view.result.current.attachmentStore }));
  await act(() => trayA.result.current.addFiles([new File(['A'], 'A.txt', { type: 'text/plain' })]));
  trayA.unmount();

  view.rerender({ target: 'thread:B' });
  expect(view.result.current.draft).toBe('');
  expect(view.result.current.attachmentStore.getSnapshot().items).toEqual([]);
  act(() => view.result.current.setDraft('B draft'));
  await act(() => view.result.current.attachmentStore.addFiles([new File(['B'], 'B.txt', { type: 'text/plain' })]));
  view.rerender({ target: 'new-thread-slot:global' });
  act(() => view.result.current.setDraft('New draft'));

  view.rerender({ target: 'thread:A' });
  expect(view.result.current.draft).toBe('A: 未发送\n下一行');
  const restoredTray = renderHook(() => useChatAttachments({ client, store: view.result.current.attachmentStore }));
  expect(restoredTray.result.current.sendableAttachments.map((item) => item.name)).toEqual(['A.txt']);
  expect(client.deleteAttachment).not.toHaveBeenCalled();
  view.rerender({ target: 'thread:B' });
  expect(view.result.current.draft).toBe('B draft');
  expect(view.result.current.attachmentStore.getSnapshot().items[0].name).toBe('B.txt');
  view.rerender({ target: 'new-thread-slot:global' });
  expect(view.result.current.draft).toBe('New draft');
  restoredTray.unmount();
  view.unmount();
  expect(client.deleteAttachment.mock.calls.map(([id]) => id).sort()).toEqual(['A.txt', 'B.txt']);
});

it('finishes an upload in its original draft while another conversation is active', async () => {
  const upload = deferred<RuntimeStoredMessageAttachment>();
  const client = attachmentClient();
  client.uploadAttachment.mockImplementationOnce(() => upload.promise);
  const view = renderHook(({ target }) => useChatComposerSession(target, client), {
    initialProps: { target: 'thread:A' as ChatComposerSessionState['targetIdentity'] },
  });
  const tray = renderHook(() => useChatAttachments({ client, store: view.result.current.attachmentStore }));
  let pending!: Promise<void>;
  act(() => { pending = tray.result.current.addFiles([new File(['A'], 'A.txt', { type: 'text/plain' })]); });
  tray.unmount();
  view.rerender({ target: 'thread:B' });
  await act(async () => { upload.resolve(attachment('A.txt')); await pending; });
  expect(view.result.current.attachmentStore.getSnapshot().items).toEqual([]);
  view.rerender({ target: 'thread:A' });
  expect(view.result.current.attachmentStore.getSnapshot().items[0]).toMatchObject({ status: 'ready', attachment: attachment('A.txt') });
  expect(client.deleteAttachment).not.toHaveBeenCalled();
});

it.each([false, true])('keeps existing text, Skill references and an upload when prefilling an app (source hidden: %s)', async (hidden) => {
  const upload = deferred<RuntimeStoredMessageAttachment>();
  const client = attachmentClient();
  client.uploadAttachment.mockImplementationOnce(() => upload.promise);
  const view = renderHook(({ target }) => useChatComposerSession(target, client), {
    initialProps: { target: chatComposerTargetIdentity(null, null) },
  });
  const references = [{ skillId: 'skill', start: 0, end: 5 }];
  act(() => view.result.current.setDraft('Skill original input', references));
  const original = view.result.current;
  let pending!: Promise<void>;
  act(() => { pending = original.attachmentStore.addFiles([new File(['A'], 'A.txt', { type: 'text/plain' })]); });
  if (hidden) view.rerender({ target: 'thread:ordinary' });

  let draftId!: string;
  act(() => { draftId = view.result.current.initializeNewThreadDraft(null, 'Create an app'); });
  const appIdentity = chatComposerTargetIdentity(null, null, draftId);
  view.rerender({ target: appIdentity });
  const app = view.result.current;
  expect(app.draft).toBe('Create an app');
  expect(app.attachmentStore.getSnapshot().items).toEqual([]);
  await act(async () => { upload.resolve(attachment('A.txt')); await pending; });

  view.rerender({ target: chatComposerTargetIdentity(null, null) });
  expect(view.result.current.composerKey).toBe(original.composerKey);
  expect(view.result.current.draft).toBe('Skill original input');
  expect(view.result.current.draftSkillReferences).toEqual(references);
  expect(view.result.current.attachmentStore).toBe(original.attachmentStore);
  expect(view.result.current.attachmentStore.getSnapshot().items[0]).toMatchObject({ status: 'ready', attachment: attachment('A.txt') });

  view.rerender({ target: appIdentity });
  act(() => view.result.current.claimForThread('app-thread'));
  view.rerender({ target: 'thread:app-thread' });
  expect(view.result.current.composerKey).toBe(app.composerKey);
  view.rerender({ target: chatComposerTargetIdentity(null, null) });
  expect(view.result.current.draft).toBe('Skill original input');
  expect(view.result.current.attachmentStore).toBe(original.attachmentStore);
  expect(client.deleteAttachment).not.toHaveBeenCalled();
});

it.each([false, true])('moves an unsent draft through project selection and first-thread creation without duplicating it (StrictMode: %s)', async (reactStrictMode) => {
  const client = attachmentClient();
  const view = renderHook(({ target }) => useChatComposerSession(target, client), {
    initialProps: { target: 'new-thread-slot:global' as ChatComposerSessionState['targetIdentity'] }, reactStrictMode,
  });
  act(() => view.result.current.setDraft('First input'));
  await act(() => view.result.current.attachmentStore.addFiles([new File(['A'], 'A.txt', { type: 'text/plain' })]));
  const original = view.result.current;
  act(() => original.claimForProject('project'));
  view.rerender({ target: 'new-thread-slot:project' });
  act(() => view.result.current.claimForThread('created'));
  view.rerender({ target: 'thread:created' });
  expect(view.result.current.composerKey).toBe(original.composerKey);
  expect(view.result.current.attachmentStore).toBe(original.attachmentStore);
  expect(view.result.current.draft).toBe('First input');
  view.rerender({ target: 'new-thread-slot:project' });
  expect(view.result.current.draft).toBe('');
  expect(view.result.current.attachmentStore.getSnapshot().items).toEqual([]);
  view.rerender({ target: 'thread:created' });
  expect(view.result.current.draft).toBe('First input');
  expect(client.deleteAttachment).not.toHaveBeenCalled();
});

it.each(['', 'Global draft'])('preserves an occupied workspace and the source draft (%j) when selecting it', async (sourceDraft) => {
  const client = attachmentClient();
  const view = renderHook(({ target }) => useChatComposerSession(target, client), {
    initialProps: { target: 'new-thread-slot:project' as ChatComposerSessionState['targetIdentity'] },
  });
  act(() => view.result.current.setDraft('Project draft'));
  await act(() => view.result.current.attachmentStore.addFiles([new File(['A'], 'A.txt', { type: 'text/plain' })]));
  const projectSession = view.result.current;
  view.rerender({ target: 'new-thread-slot:global' });
  act(() => view.result.current.setDraft(sourceDraft));
  if (sourceDraft) await act(() => view.result.current.attachmentStore.addFiles([new File(['B'], 'B.txt', { type: 'text/plain' })]));
  const sourceSession = view.result.current;

  act(() => view.result.current.claimForProject('project'));
  view.rerender({ target: 'new-thread-slot:project' });
  expect(view.result.current.draft).toBe('Project draft');
  expect(view.result.current.composerKey).toBe(projectSession.composerKey);
  expect(view.result.current.attachmentStore).toBe(projectSession.attachmentStore);
  expect(view.result.current.attachmentStore.getSnapshot().items[0].attachment?.id).toBe('A.txt');
  view.rerender({ target: 'new-thread-slot:global' });
  expect(view.result.current.draft).toBe(sourceDraft);
  expect(view.result.current.attachmentStore).toBe(sourceSession.attachmentStore);
  expect(view.result.current.attachmentStore.getSnapshot().items.map((item) => item.name)).toEqual(sourceDraft ? ['B.txt'] : []);
  expect(client.deleteAttachment).not.toHaveBeenCalled();
});

it('restores an attachment-only workspace while its upload is pending', async () => {
  const upload = deferred<RuntimeStoredMessageAttachment>();
  const client = attachmentClient();
  client.uploadAttachment.mockImplementationOnce(() => upload.promise);
  const view = renderHook(({ target }) => useChatComposerSession(target, client), {
    initialProps: { target: 'new-thread-slot:project' as ChatComposerSessionState['targetIdentity'] },
  });
  let pending!: Promise<void>;
  act(() => { pending = view.result.current.attachmentStore.addFiles([new File(['A'], 'A.txt', { type: 'text/plain' })]); });
  const projectStore = view.result.current.attachmentStore;
  view.rerender({ target: 'new-thread-slot:global' });
  act(() => view.result.current.claimForProject('project'));
  view.rerender({ target: 'new-thread-slot:project' });
  await act(async () => { upload.resolve(attachment('A.txt')); await pending; });
  expect(view.result.current.attachmentStore).toBe(projectStore);
  expect(projectStore.getSnapshot().items[0]).toMatchObject({ status: 'ready', attachment: attachment('A.txt') });
  expect(client.deleteAttachment).not.toHaveBeenCalled();
});

it('transfers text and Skill references into a previously visited empty workspace', () => {
  const client = attachmentClient();
  const view = renderHook(({ target }) => useChatComposerSession(target, client), {
    initialProps: { target: 'new-thread-slot:project' as ChatComposerSessionState['targetIdentity'] },
  });
  view.rerender({ target: 'new-thread-slot:global' });
  const references = [{ skillId: 'skill', start: 2, end: 7 }];
  act(() => view.result.current.setDraft('  Skill draft', references));
  const source = view.result.current;
  act(() => source.claimForProject('project'));
  view.rerender({ target: 'new-thread-slot:project' });
  expect(view.result.current.composerKey).toBe(source.composerKey);
  expect(view.result.current.draftSkillReferences).toEqual(references);
  view.rerender({ target: 'new-thread-slot:global' });
  expect(view.result.current.draft).toBe('');
  expect(view.result.current.draftSkillReferences).toEqual([]);
  view.rerender({ target: 'new-thread-slot:project' });
  act(() => view.result.current.reset());
  act(() => source.setDraft('Stale Skill', references));
  expect(view.result.current.draft).toBe('');
  expect(view.result.current.draftSkillReferences).toEqual([]);
});

it('discards a pending upload and rejects stale draft updates after an explicit reset', async () => {
  const upload = deferred<RuntimeStoredMessageAttachment>();
  const client = attachmentClient();
  client.uploadAttachment.mockImplementationOnce(() => upload.promise);
  const view = renderHook(() => useChatComposerSession('thread:A', client));
  const old = view.result.current;
  let pending!: Promise<void>;
  act(() => {
    old.setDraft('Discard me');
    pending = old.attachmentStore.addFiles([new File(['A'], 'A.txt', { type: 'text/plain' })]);
  });
  act(() => view.result.current.reset());
  await act(async () => { upload.resolve(attachment('A.txt')); await pending; old.setDraft('Stale'); });
  expect(view.result.current.draft).toBe('');
  expect(view.result.current.attachmentStore.getSnapshot().items).toEqual([]);
  expect(client.deleteAttachment).toHaveBeenCalledWith('A.txt');
});

function attachmentClient() {
  return {
    deleteAttachment: vi.fn<DesktopRuntimeClient['deleteAttachment']>().mockResolvedValue({ deleted: true }),
    linkAttachment: vi.fn<DesktopRuntimeClient['linkAttachment']>().mockResolvedValue(null),
    uploadAttachment: vi.fn<DesktopRuntimeClient['uploadAttachment']>(async ({ name }) => attachment(name)),
  };
}

function attachment(name: string): RuntimeStoredMessageAttachment {
  return { id: name, assetId: name, name, source: 'runtime', size: 1, type: 'text/plain' };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
