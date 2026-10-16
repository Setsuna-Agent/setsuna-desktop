// @vitest-environment happy-dom

import { pluginAppMentionText, threadMentionText, type MessagePatch, type RuntimeMessage, type RuntimePluginSummary, type RuntimeStoredMessageAttachment } from '@setsuna-desktop/contracts';
import { browserTabMentionText } from '@setsuna-desktop/feature-browser/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UserMessageEditor } from '../../../../../../src/features/chat/conversation/messages/UserMessageEditor.js';
import type { UserMessageEditorProps } from '../../../../../../src/features/chat/conversation/messages/useUserMessageEditor.js';
import { CHAT_COMPOSER_CLIPBOARD_TYPE } from '../../../../../../src/features/chat/composer/chatComposerClipboard.js';
import { RendererPluginTestHost } from '../../../../support/RendererPluginTestHost.js';

afterEach(cleanup);

const plugin: RuntimePluginSummary = {
  id: 'tables', name: 'Tables', installedAt: '', skills: [], hooks: [], hookCount: 0, resources: [], mcpServers: [],
  extension: { apiVersion: 1, runtime: 'node-worker', trust: 'trusted', capabilities: ['ui'],
    rendererUi: { schemaVersion: 2, actions: [], contributions: [{ id: 'table.page', slot: 'renderer.plugin.page',
      navigation: { label: '我的表格' }, document: { htmlResourceId: 'html', actionIds: [] } }] } },
};
const original = attachment('old', 'original.txt');
const added = attachment('new', 'pasted.txt');
const client = () => ({ linkAttachment: vi.fn(async () => null), uploadAttachment: vi.fn(async () => added), deleteAttachment: vi.fn(async () => ({ deleted: true })) });

it('restores every reference kind as editable slots and submits further @ and / selections with their identities', async () => {
  const app = pluginAppMentionText({ pluginId: plugin.id, contributionId: 'table.page', name: '我的表格' });
  const browser = browserTabMentionText({ id: 'tab-1', title: 'Docs', url: 'https://example.test' });
  const thread = threadMentionText({ id: 'thread-2', title: 'Other chat' });
  const content = `Review ${app} @"src/a b.ts" ${browser} ${thread}`;
  const submit = vi.fn(async (_input: MessagePatch) => false);
  renderEditor({ message: message(content, { skillIds: ['review'], skillReferences: [{ skillId: 'review', start: 0, end: 6 }] }), onSubmit: submit });
  const input = screen.getByRole('textbox');
  const range = document.createRange();
  range.selectNodeContents(input);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  const clipboard = new Map<string, string>();
  fireEvent.copy(input, { clipboardData: { setData: (type: string, value: string) => clipboard.set(type, value) } });
  expect(JSON.parse(clipboard.get(CHAT_COMPOSER_CLIPBOARD_TYPE)!).parts.filter((part: { type: string }) => part.type !== 'text')).toEqual([
    { type: 'skill', skillId: 'review' },
    { type: 'plugin', pluginId: 'tables', contributionId: 'table.page' },
    { type: 'workspace', entry: expect.objectContaining({ path: 'src/a b.ts', kind: 'file' }) },
    { type: 'browser-tab', tab: { id: 'tab-1', title: 'Docs', url: 'https://example.test' } },
    { type: 'thread', thread: { id: 'thread-2', title: 'Other chat' } },
  ]);
  range.collapse(false);
  paste(input, '@表格');
  fireEvent.mouseDown(await screen.findByRole('option', { name: '我的表格' }));
  paste(input, '/Build');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(submit).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
  const expected = `${content} ${app} Build`;
  expect(submit).toHaveBeenCalledExactlyOnceWith({ content: expected, attachments: [], skillIds: ['review', 'build'],
    skillReferences: [{ skillId: 'review', start: 0, end: 6 }, { skillId: 'build', start: expected.length - 5, end: expected.length }] });
  range.selectNode(input.querySelectorAll('[data-slot-key]')[6]!);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  fireEvent.cut(input, { clipboardData: { setData: vi.fn() } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送' })); });
  expect(submit).toHaveBeenLastCalledWith({ content: `${content} ${app}`, attachments: [], skillIds: ['review'],
    skillReferences: [{ skillId: 'review', start: 0, end: 6 }] });
});

it('keeps original attachments, accepts a clipboard file, and retains the edited payload on failed send', async () => {
  const attachmentClient = client();
  const submit = vi.fn(async (_input: MessagePatch) => false);
  const current = message('', { attachments: [original] });
  const view = renderEditor({ message: current, client: attachmentClient, onSubmit: submit });
  pasteFile(screen.getByRole('textbox'));
  await waitFor(() => expect(attachmentClient.linkAttachment).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送' })); });
  expect(submit).toHaveBeenLastCalledWith({ content: '', attachments: [original, added], skillIds: [], skillReferences: [] });
  expect(attachmentClient.deleteAttachment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '移除 original.txt' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送' })); });
  expect(submit).toHaveBeenLastCalledWith({ content: '', attachments: [added], skillIds: [], skillReferences: [] });
  expect(current.attachments).toEqual([original]);
  view.unmount();
  expect(attachmentClient.deleteAttachment).toHaveBeenCalledWith(added.assetId);
});

it.each(['http', 'https'])('preserves historical %s image attachments when editing and sending', async (protocol) => {
  const remote = { id: 'remote-image', name: 'remote.png', type: 'image/png', size: 4,
    url: `${protocol}://example.test/image.png` };
  const attachmentClient = client();
  const submit = vi.fn(async (_input: MessagePatch) => false);
  const current = message('', { attachments: [remote] });
  const view = renderEditor({ message: current, client: attachmentClient, onSubmit: submit });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送' })); });
  expect(submit).toHaveBeenCalledExactlyOnceWith({ content: '', attachments: [remote], skillIds: [], skillReferences: [] });
  expect(attachmentClient.uploadAttachment).not.toHaveBeenCalled();
  expect(current.attachments).toEqual([remote]);
  view.unmount();
  expect(attachmentClient.deleteAttachment).not.toHaveBeenCalled();
});

it.each([true, false])('settles uploads correctly if the editor unmounts during a send (accepted: %s)', async (accepted) => {
  const attachmentClient = client();
  let finish!: (sent: boolean) => void;
  const submit = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const view = renderEditor({ client: attachmentClient, onSubmit: submit });
  pasteFile(screen.getByRole('textbox'));
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送' })); });
  view.unmount();
  expect(attachmentClient.deleteAttachment).not.toHaveBeenCalled();
  await act(async () => { finish(accepted); });
  if (accepted) expect(attachmentClient.deleteAttachment).not.toHaveBeenCalled();
  else expect(attachmentClient.deleteAttachment).toHaveBeenCalledExactlyOnceWith(added.assetId);
});

function renderEditor(props: Partial<UserMessageEditorProps> = {}) {
  return render(<RendererPluginTestHost><UserMessageEditor message={message('')} client={client()} disabled={false} submitting={false}
    plugins={[plugin]} skills={[{ id: 'review', name: 'Review', kind: 'builtin', enabled: true }, { id: 'build', name: 'Build', kind: 'builtin', enabled: true }]}
    onSearchProjectEntries={vi.fn()} onCancel={vi.fn()} onSubmit={async () => false} {...props} /></RendererPluginTestHost>);
}
function message(content: string, fields: Partial<RuntimeMessage> = {}): RuntimeMessage {
  return { id: 'message-1', role: 'user', content, createdAt: '2026-10-16T00:00:00Z', ...fields };
}
function attachment(id: string, name: string): RuntimeStoredMessageAttachment {
  return { id, name, assetId: id, source: 'runtime', type: 'text/plain', size: 4 };
}
function paste(input: HTMLElement, text: string) {
  fireEvent.paste(input, { clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? text : '' } });
}
function pasteFile(input: HTMLElement) {
  fireEvent.paste(input, { clipboardData: { files: [new File(['text'], added.name, { type: added.type })], getData: () => '' } });
}
