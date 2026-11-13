// @vitest-environment happy-dom
import type { DesktopConversationExportInput, DesktopConversationExportPreviewResult, DesktopConversationExportResult, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../../../../src/app/providers/ToastProvider.js';
import { createChatDisplayItems } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';
import { useConversationExportActions } from '../../../../../src/features/chat/export/useConversationExportActions.js';
import { useConversationExportPreview } from '../../../../../src/features/chat/export/useConversationExportPreview.js';
import { useChatMessageOperations } from '../../../../../src/features/chat/hooks/useChatMessageOperations.js';

const snapshot: RuntimeThread = {
  id: 'thread', title: 'Export', createdAt: '', updatedAt: '', archived: false,
  messageCount: 2, lastMessagePreview: '', lastSeq: 1, messages: [
    { id: 'question', role: 'user', content: 'unselected-question', createdAt: '' },
    { id: 'reply', role: 'assistant', content: '**selected-reply**', createdAt: '' },
  ],
};
const png = 'data:image/png;base64,prepared-image';
const prepared = (id: string, format: DesktopConversationExportInput['format'] = 'png'): DesktopConversationExportPreviewResult => ({
  ok: true, file: { id, format, name: `${id}.${format === 'markdown' ? 'md' : format}`, path: `/temporary/${id}`,
    ...(format === 'png' ? { imageDataUrl: png } : {}) },
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('releases selection immediately when a slow preview closes and allows another format before native rendering finishes', async () => {
  let finishImage!: (result: DesktopConversationExportPreviewResult) => void;
  const image = new Promise<DesktopConversationExportPreviewResult>((resolve) => { finishImage = resolve; });
  const prepare = vi.fn(async (input: DesktopConversationExportInput) => input.format === 'png' ? image : prepared(input.format, input.format));
  vi.stubGlobal('setsunaDesktop', { desktop: { prepareConversationExport: prepare } });
  const client = { getThread: async () => snapshot };
  const view = renderHook(() => {
    const preview = useConversationExportPreview(client, snapshot.id);
    const messages = useChatMessageOperations({
      activeTurnId: null, composerKey: 'chat', currentThreadId: snapshot.id,
      displayItems: createChatDisplayItems(snapshot.messages), onExportMessages: (ids, format) => preview.prepare(snapshot.id, format, ids),
    });
    return { preview, messages };
  });
  act(() => view.result.current.messages.startExportSelection('reply'));
  let first!: Promise<void>;
  act(() => { first = view.result.current.messages.selection.confirm('png'); });
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  expect(view.result.current.messages.selection.loading).toBe(true);
  await act(async () => { view.result.current.preview.close(); await first; });
  expect(view.result.current.messages.selection.loading).toBe(false);
  expect(view.result.current.preview.state).toBeNull();
  expect(view.result.current.messages.selection.messageIds).toEqual(['reply']);
  await act(() => view.result.current.messages.selection.confirm('markdown'));
  expect(prepare.mock.calls.map(([input]) => input.format)).toEqual(['png', 'markdown']);
  expect(prepare.mock.calls[1][0].content).toContain('**selected-reply**');
  expect(prepare.mock.calls[1][0].content).not.toContain('unselected-question');
  await act(async () => { finishImage(prepared('old-image')); await image; });
  expect(view.result.current.preview.state?.preview?.file.format).toBe('markdown');
  expect(view.result.current.messages.selection.mode).toBe('export');
  act(() => { view.result.current.preview.close(); view.result.current.messages.selection.cancel(); });
  expect(view.result.current.messages.selection.mode).toBeNull();
});

it('previews before saving, keeps cancelled saves available and uses the prepared snapshot for copy and save', async () => {
  const getThread = vi.fn(async () => snapshot);
  const prepare = vi.fn(async () => prepared('export'));
  const save = vi.fn<() => Promise<DesktopConversationExportResult>>().mockResolvedValue({ ok: true, file: { name: 'saved.png', path: '/saved/export.png' } });
  const copyImage = vi.fn(async () => ({ ok: true }));
  const open = vi.fn(async () => ({ ok: true }));
  const reveal = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('setsunaDesktop', { desktop: {
    prepareConversationExport: prepare, savePreparedConversationExport: save,
    copyImageToClipboard: copyImage, openPath: open, revealPath: reveal,
  } });
  const client = { getThread };
  const view = renderHook(() => {
    const preview = useConversationExportPreview(client, 'thread');
    return { preview, actions: useConversationExportActions(preview.state?.preview ?? null) };
  }, { wrapper: ToastProvider });
  await act(() => view.result.current.preview.prepare('thread', 'png', ['reply']));
  expect(view.result.current.preview.state?.preview?.file.imageDataUrl).toBe(png);
  expect(save).not.toHaveBeenCalled();
  getThread.mockResolvedValue({ ...snapshot, messages: [{ id: 'new-reply', role: 'assistant', content: 'changed-after-preview', createdAt: '' }] });
  let cancelSave!: (result: DesktopConversationExportResult) => void;
  save.mockReturnValueOnce(new Promise((resolve) => { cancelSave = resolve; }));
  let pending!: Promise<void>;
  await act(async () => {
    pending = view.result.current.actions.run('save');
    await view.result.current.actions.run('save');
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { cancelSave({ ok: true, cancelled: true }); await pending; });
  expect(view.result.current.actions.file?.path).toBe('/temporary/export');
  await act(() => view.result.current.actions.run('save'));
  await act(() => view.result.current.actions.run('copy'));
  await act(() => view.result.current.actions.run('open'));
  await act(() => view.result.current.actions.run('reveal'));
  expect(getThread).toHaveBeenCalledOnce();
  expect(prepare).toHaveBeenCalledOnce();
  expect(save).toHaveBeenLastCalledWith('export');
  expect(copyImage).toHaveBeenCalledWith({ dataUrl: png, name: 'saved.png' });
  expect(open).toHaveBeenCalledWith('/saved/export.png');
  expect(reveal).toHaveBeenCalledWith('/saved/export.png');
});

it.each(['close', 'navigate'])('does not reopen or replace a newer preview after %s during generation', async (action) => {
  const completions: Array<(result: DesktopConversationExportPreviewResult) => void> = [];
  const prepare = vi.fn(() => new Promise<DesktopConversationExportPreviewResult>((resolve) => { completions.push(resolve); }));
  vi.stubGlobal('setsunaDesktop', { desktop: { prepareConversationExport: prepare } });
  const client = { getThread: vi.fn(async () => snapshot) };
  const view = renderHook(({ id }) => useConversationExportPreview(client, id), { initialProps: { id: 'first-thread' } });
  let first!: Promise<{ cancelled?: boolean }>;
  act(() => { first = view.result.current.prepare('first-thread', 'markdown', ['reply']); });
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  if (action === 'close') act(() => view.result.current.close());
  else view.rerender({ id: 'next-thread' });
  await act(async () => { expect(await first).toEqual({ cancelled: true }); });
  let second!: Promise<{ cancelled?: boolean }>;
  act(() => { second = view.result.current.prepare(action === 'navigate' ? 'next-thread' : 'first-thread', 'markdown', ['reply']); });
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
  await act(async () => { completions[0](prepared('old', 'markdown')); expect(await first).toEqual({ cancelled: true }); });
  expect(view.result.current.state?.preview).toBeNull();
  await act(async () => { completions[1](prepared('new', 'markdown')); await second; });
  expect(view.result.current.state?.preview?.file.id).toBe('new');
});

it.each(['markdown', 'html'] as const)('copies selected %s content with the appropriate clipboard representation', async (format) => {
  const writes: Array<Record<string, Blob>> = [];
  const writeText = vi.fn(async (_text: string) => undefined);
  vi.stubGlobal('ClipboardItem', class { constructor(readonly data: Record<string, Blob>) {} });
  vi.stubGlobal('navigator', { clipboard: { writeText, write: async (items: Array<{ data: Record<string, Blob> }>) => { writes.push(items[0].data); } } });
  vi.stubGlobal('setsunaDesktop', { desktop: { prepareConversationExport: async () => prepared('text', format) } });
  const client = { getThread: async () => snapshot };
  const view = renderHook(() => {
    const preview = useConversationExportPreview(client, 'thread');
    return { preview, actions: useConversationExportActions(preview.state?.preview ?? null) };
  }, { wrapper: ToastProvider });
  await act(() => view.result.current.preview.prepare('thread', format, ['reply']));
  await act(() => view.result.current.actions.run('copy'));
  const text = format === 'html' ? await writes[0]['text/plain'].text() : writeText.mock.calls[0][0];
  expect(text).toContain('**selected-reply**');
  expect(text).not.toContain('unselected-question');
  if (format === 'html') expect(await writes[0]['text/html'].text()).toContain('<strong>selected-reply</strong>');
});
