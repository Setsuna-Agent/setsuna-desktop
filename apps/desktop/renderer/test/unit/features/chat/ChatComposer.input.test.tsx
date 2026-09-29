// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeMessage, RuntimeSkillSummary, RuntimeThread } from '@setsuna-desktop/contracts';
import { browserTabMentionText, type BrowserTabReference } from '@setsuna-desktop/feature-browser/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatComposer } from '../../../../src/features/chat/ChatComposer.js';
import { useChatComposerSession, type ChatComposerTargetIdentity } from '../../../../src/features/chat/hooks/useChatComposerSession.js';
import { BrowserTabMentionsProvider } from '../../../../src/features/chat/mentions/BrowserTabReference.js';
import { CHAT_COMPOSER_CLIPBOARD_TYPE } from '../../../../src/features/chat/composer/chatComposerClipboard.js';
import { MAX_INLINE_PASTE_CHARACTERS } from '../../../../src/features/chat/composer/useChatComposerClipboard.js';
import { RendererPluginTestHost } from '../../support/RendererPluginTestHost.js';

afterEach(cleanup);

it('uploads a long paste verbatim as TXT, preserves the draft, and sends the stored attachment', async () => {
  const text = '中文 🙂\r\n'.repeat(MAX_INLINE_PASTE_CHARACTERS);
  const uploaded = { id: 'text-1', assetId: 'text-1', source: 'runtime' as const, name: 'pasted.txt', type: 'text/plain', size: new TextEncoder().encode(text).length };
  const uploadAttachment = vi.fn<DesktopRuntimeClient['uploadAttachment']>(async () => uploaded);
  const linkAttachment = vi.fn(async () => null);
  const send = vi.fn(async () => true);
  render(<Harness initialDraft="请分析" client={{ linkAttachment, uploadAttachment, deleteAttachment: vi.fn() } as unknown as DesktopRuntimeClient} send={send} />);
  const input = screen.getByRole('textbox');
  placeCaret(input, 0);
  paste(input, text);
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledOnce());
  const [request] = uploadAttachment.mock.calls[0];
  expect(request.name).toMatch(/^pasted-\d+\.txt$/u);
  expect(request.type).toBe('text/plain');
  expect(new TextDecoder().decode(request.data)).toBe(text);
  expect(input.textContent).toBe('请分析');
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false));
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(send).toHaveBeenCalledWith('请分析', expect.objectContaining({ attachments: [uploaded] })));
});

it('inserts a regular paste at the selection then places the caret at the end', () => {
  render(<Harness initialDraft="before after" />);
  const input = screen.getByRole('textbox');
  placeCaret(input, 7);
  const text = 'x'.repeat(MAX_INLINE_PASTE_CHARACTERS);
  paste(input, text);
  expect(input.textContent).toBe(`before ${text}after`);
  expect(document.activeElement).toBe(input);
  expect(caretSuffix(input)).toBe('');
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(input.textContent).toBe(`before ${text}after\n`);
});

it('browses only user prompts from the start and restores the unsent draft', () => {
  const messages = [message('first', 'first\nquestion'), message('assistant', 'reply', 'assistant'), message('hidden', 'internal')];
  messages[2].visibility = 'model';
  messages.push({ ...message('hook', 'hook prompt'), promptSource: 'hook' }, message('last', 'last question'));
  render(<Harness initialDraft={'unsent\ndraft'} messages={messages} />);
  const input = screen.getByRole('textbox');
  placeCaret(input, 0);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('last question');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('first\nquestion');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('first\nquestion');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.textContent).toBe('last question');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.textContent).toBe('unsent\ndraft');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.textContent).toBe('unsent\ndraft');
});

it('leaves arrows to text editing, selection and IME unless the caret is at the first character', () => {
  render(<Harness initialDraft={'first\nsecond'} messages={[message('history', 'previous prompt')]} />);
  const input = screen.getByRole('textbox');
  for (const offset of [2, 6]) {
    placeCaret(input, offset);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.textContent).toBe('first\nsecond');
  }
  placeCaret(input, 0);
  const selection = document.getSelection()!;
  selection.extend(input.firstChild!, 2);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('first\nsecond');
  placeCaret(input, 0);
  for (const modifier of ['shiftKey', 'altKey', 'metaKey', 'ctrlKey']) {
    fireEvent.keyDown(input, { key: 'ArrowUp', [modifier]: true });
    expect(input.textContent).toBe('first\nsecond');
  }
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('first\nsecond');
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('previous prompt');
});

it('starts a fresh history browse after editing a recalled prompt and isolates conversation changes', () => {
  const messages = [message('1', 'older'), message('2', 'newer')];
  const view = render(<Harness messages={messages} />);
  const input = screen.getByRole('textbox');
  placeCaret(input, 0);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  input.textContent = 'edited prompt';
  fireEvent.input(input);
  placeCaret(input, 0);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('newer');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.textContent).toBe('edited prompt');
  view.rerender(<Harness threadId="another-thread" messages={[message('3', 'another history')]} />);
  placeCaret(input, 0);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('another history');
});

it('restores structured skill references with a recalled prompt and with the unsent draft', async () => {
  const skill: RuntimeSkillSummary = { id: 'skill-1', name: 'Skill', enabled: true, kind: 'builtin' };
  const history = { ...message('1', 'Skill explain'), skillIds: [skill.id], skillReferences: [{ skillId: skill.id, start: 0, end: 5 }] };
  const send = vi.fn(async () => false);
  render(<Harness messages={[history]} skills={[skill]} send={send} />);
  const input = screen.getByRole('textbox');
  placeCaret(input, 0);
  paste(input, 'Skill draft', JSON.stringify({ version: 1, parts: [{ type: 'skill', skillId: skill.id }, { type: 'text', value: ' draft' }] }));
  placeCaret(input, 0);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
  expect(send).toHaveBeenLastCalledWith('Skill explain', expect.objectContaining({ skillIds: [skill.id], skillReferences: history.skillReferences }));
  placeCaret(input, 0);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
  expect(send).toHaveBeenLastCalledWith('Skill draft', expect.objectContaining({ skillIds: [skill.id] }));
});

it('selects a specific browser tab with the keyboard and sends its identity without a project', async () => {
  const tabs = [
    { id: 'tab-one', title: '相同标题', url: 'https://one.example.com/' },
    { id: 'tab-two', title: '相同标题', url: 'https://two.example.com/' },
  ];
  const send = vi.fn(async () => false);
  render(<Harness initialDraft="@" tabs={tabs} send={send} />);
  const input = screen.getByRole('textbox');
  act(() => { placeCaret(input, 1); fireEvent.focus(input); });
  await screen.findByRole('listbox');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(send).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
  expect(send).toHaveBeenCalledWith(`${browserTabMentionText(tabs[1])} `, expect.anything());
});

it('filters browser tabs by URL and inserts the clicked tab at the mention query', async () => {
  const tabs = [
    { id: 'one', title: '文档', url: 'https://one.example.com/' },
    { id: 'two', title: '搜索', url: 'https://two.example.com/' },
  ];
  const send = vi.fn(async () => false);
  render(<Harness initialDraft="请检查 @two.example" tabs={tabs} send={send} />);
  const input = screen.getByRole('textbox');
  act(() => { placeCaret(input, '请检查 @two.example'.length); fireEvent.focus(input); });
  const option = await screen.findByRole('option', { name: /搜索/ });
  fireEvent.mouseDown(option);
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
  expect(send).toHaveBeenCalledWith(`请检查 ${browserTabMentionText(tabs[1])} `, expect.anything());
});

it('retains browser tab identities through draft, clipboard and history restoration even after the tab closes', async () => {
  const tab = { id: 'closed-tab', title: '页面', url: 'https://example.com/' };
  const reference = browserTabMentionText(tab);
  const send = vi.fn(async () => false);
  render(<Harness initialDraft={`${reference} 草稿`} messages={[message('old', `${reference} 历史`)]} send={send} />);
  const input = screen.getByRole('textbox');
  const submit = async (expected: string) => {
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(send).toHaveBeenLastCalledWith(expected, expect.anything());
  };
  await submit(`${reference} 草稿`);
  placeCaret(input, 0);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  await submit(`${reference} 历史`);
  placeCaret(input, 0);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  await submit(`${reference} 草稿`);
  const copied = new Map<string, string>();
  const clipboardData = { files: [], getData: (type: string) => copied.get(type) ?? '', setData: (type: string, value: string) => copied.set(type, value) };
  const range = document.createRange();
  range.selectNodeContents(input);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  fireEvent.cut(input, { clipboardData });
  expect(JSON.parse(copied.get(CHAT_COMPOSER_CLIPBOARD_TYPE)!)).toMatchObject({ parts: [{ type: 'browser-tab', tab }, { type: 'text', value: ' 草稿' }] });
  fireEvent.paste(input, { clipboardData });
  await submit(`${reference} 草稿`);
});

it('restores typed text and selected files into a remounted composer and submits them together', async () => {
  const attachment = { id: 'file-A', assetId: 'file-A', source: 'runtime' as const, name: 'A.pdf', size: 4, type: 'application/pdf' };
  const deleteAttachment = vi.fn().mockResolvedValue({ deleted: true });
  const client = { linkAttachment: vi.fn(async () => attachment), deleteAttachment } as unknown as DesktopRuntimeClient;
  const send = vi.fn(async () => true);
  const view = render(<SessionHarness target="thread:A" client={client} send={send} />);
  paste(screen.getByRole('textbox'), 'A 未发送的内容');
  await act(async () => fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['file'], 'A.pdf', { type: 'application/pdf' })] },
  }));
  view.rerender(<SessionHarness target="thread:B" client={client} send={send} />);
  expect(screen.getByRole('textbox').textContent).toBe('');
  paste(screen.getByRole('textbox'), 'B 的内容');
  view.rerender(<SessionHarness target="new-thread-slot:global" client={client} send={send} />);
  expect(screen.getByRole('textbox').textContent).toBe('');
  view.rerender(<SessionHarness target="thread:A" client={client} send={send} />);
  expect(screen.getByRole('textbox').textContent).toBe('A 未发送的内容');
  expect(deleteAttachment).not.toHaveBeenCalled();
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
  expect(send).toHaveBeenCalledWith('A 未发送的内容', expect.objectContaining({ attachments: [attachment] }));
  view.rerender(<SessionHarness target="thread:B" client={client} send={send} />);
  expect(screen.getByRole('textbox').textContent).toBe('B 的内容');
});

it.each([true, false])('locks text-only submissions across editor remounts until the send settles (%s)', async (sent) => {
  let settle!: (sent: boolean) => void;
  const send = vi.fn<(...args: unknown[]) => Promise<boolean>>()
    .mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }))
    .mockResolvedValue(false);
  const client = {} as DesktopRuntimeClient;
  const view = render(<SessionHarness target="new-thread-slot:global" client={client} send={send} />);
  paste(screen.getByRole('textbox'), 'First message');
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(send).toHaveBeenCalledExactlyOnceWith('First message', expect.objectContaining({ attachments: [] }));

  view.rerender(<SessionHarness target="thread:other" client={client} send={send} />);
  view.rerender(<SessionHarness target="new-thread-slot:global" client={client} send={send} />);
  expect(screen.getByRole('textbox').textContent).toBe('First message');
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(send).toHaveBeenCalledOnce();

  await act(async () => settle(sent));
  if (sent) {
    const input = screen.getByRole('textbox');
    input.textContent = 'Next message';
    fireEvent.input(input);
  }
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
  expect(send).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith(sent ? 'Next message' : 'First message', expect.anything());
});

it('retains a Skill chosen from the slash menu after remounting the draft', async () => {
  const skills: RuntimeSkillSummary[] = [{ id: 'skill-1', name: 'Review', enabled: true, kind: 'builtin' }];
  const client = {} as DesktopRuntimeClient;
  const send = vi.fn(async () => false);
  const view = render(<SessionHarness target="thread:A" client={client} send={send} skills={skills} />);
  paste(screen.getByRole('textbox'), '/Review');
  fireEvent.mouseDown(await screen.findByRole('option', { name: /Review/ }));
  view.rerender(<SessionHarness target="thread:B" client={client} send={send} skills={skills} />);
  view.rerender(<SessionHarness target="thread:A" client={client} send={send} skills={skills} />);
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
  expect(send).toHaveBeenCalledWith('Review ', expect.objectContaining({
    skillIds: ['skill-1'], skillReferences: [{ skillId: 'skill-1', start: 0, end: 6 }],
  }));
});

it('restores selected Skills by ID and exact range after navigation, and removes them after editing or sending', async () => {
  const skills: RuntimeSkillSummary[] = [
    { id: 'builtin-review', name: 'Review', enabled: true, kind: 'builtin' },
    { id: 'user-review', name: 'Review', enabled: true, kind: 'user' },
  ];
  const client = {} as DesktopRuntimeClient;
  const send = vi.fn(async () => false);
  const view = render(<SessionHarness target="thread:A" client={client} send={send} skills={skills} />);
  paste(screen.getByRole('textbox'), '  Review Review then Review  ', JSON.stringify({ version: 1, parts: [
    { type: 'text', value: '  Review ' },
    { type: 'skill', skillId: skills[0].id },
    { type: 'text', value: ' then ' },
    { type: 'skill', skillId: skills[1].id },
    { type: 'text', value: '  ' },
  ] }));
  view.rerender(<SessionHarness target="thread:B" client={client} send={send} skills={skills} />);
  paste(screen.getByRole('textbox'), 'Review as plain text');
  view.rerender(<SessionHarness target="thread:A" client={client} send={send} skills={skills} />);
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
  expect(send).toHaveBeenLastCalledWith('  Review Review then Review  ', expect.objectContaining({
    skillIds: skills.map((skill) => skill.id),
    skillReferences: [
      { skillId: skills[0].id, start: 7, end: 13 },
      { skillId: skills[1].id, start: 19, end: 25 },
    ],
  }));
  // Replacing a tag with identical plain text must still remove its saved selection.
  const input = screen.getByRole('textbox');
  input.textContent = '  Review Review then Review  ';
  fireEvent.input(input);
  view.rerender(<SessionHarness target="thread:B" client={client} send={send} skills={skills} />);
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
  expect(send).toHaveBeenLastCalledWith('Review as plain text', expect.objectContaining({ skillIds: [] }));
  view.rerender(<SessionHarness target="thread:A" client={client} send={send} skills={skills} />);
  send.mockResolvedValueOnce(true);
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }));
  expect(send).toHaveBeenLastCalledWith('  Review Review then Review  ', expect.objectContaining({ skillIds: [] }));
  view.rerender(<SessionHarness target="thread:B" client={client} send={send} skills={skills} />);
  view.rerender(<SessionHarness target="thread:A" client={client} send={send} skills={skills} />);
  expect(screen.getByRole('textbox').textContent).toBe('');
});

function SessionHarness({ target, client, send, skills }: {
  target: ChatComposerTargetIdentity;
  client: DesktopRuntimeClient;
  send: (...args: unknown[]) => Promise<boolean>;
  skills?: RuntimeSkillSummary[];
}) {
  const session = useChatComposerSession(target, client);
  return <Harness client={client} session={session} send={send} skills={skills} />;
}

function Harness({ initialDraft = '', client = {} as DesktopRuntimeClient, messages = [], skills = [], tabs = [], threadId = 'thread-1', send = async () => false, session }: {
  initialDraft?: string;
  client?: DesktopRuntimeClient;
  messages?: RuntimeMessage[];
  skills?: RuntimeSkillSummary[];
  tabs?: BrowserTabReference[];
  threadId?: string;
  send?: (...args: unknown[]) => Promise<boolean>;
  session?: ReturnType<typeof useChatComposerSession>;
}) {
  const [draft, setDraft] = useState(initialDraft);
  return <RendererPluginTestHost><BrowserTabMentionsProvider value={tabs}><ChatComposer
    key={session?.composerKey} attachmentStore={session?.attachmentStore}
    draftSkillReferences={session?.draftSkillReferences}
    activeTurnId={null} client={client} config={null} canClearContext={false}
    contextUsage={{ compactedMessageCount: 0, percent: 0, totalTokens: 256_000, triggerScopes: [], usedTokens: 0, visiblePercent: 0 }}
    currentThread={{ id: threadId, messages, queuedTurnInputs: [] } as unknown as RuntimeThread}
    draft={session?.draft ?? draft} skills={skills} onDraftChange={session?.setDraft ?? setDraft} onSend={send}
    queuedTurnActions={{ deleteQueuedTurnInput: vi.fn(), releaseQueuedTurnInputEdit: vi.fn(), retrieveQueuedTurnInput: vi.fn(), sendQueuedTurnInputNow: vi.fn(), updateQueuedTurnInput: vi.fn() }}
    onAccessModeChange={vi.fn()} onCancelActiveTurn={vi.fn()} onClearContext={vi.fn()} onCompactContext={vi.fn()}
    onSelectModel={vi.fn()} onSetMultiAgentEnabled={vi.fn()} onStartThreadReview={vi.fn()} onSearchProjectEntries={vi.fn()}
  /></BrowserTabMentionsProvider></RendererPluginTestHost>;
}

function message(id: string, content: string, role: RuntimeMessage['role'] = 'user'): RuntimeMessage {
  return { id, content, role, createdAt: '2026-09-28T00:00:00.000Z' };
}

function placeCaret(input: HTMLElement, offset: number) {
  input.focus();
  const range = document.createRange();
  range.setStart(input.firstChild ?? input, offset);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}

function paste(input: HTMLElement, text: string, structured = '') {
  fireEvent.paste(input, { clipboardData: { files: [], getData: (type: string) => type === CHAT_COMPOSER_CLIPBOARD_TYPE ? structured : text } });
}

function caretSuffix(input: HTMLElement) {
  const range = document.getSelection()!.getRangeAt(0).cloneRange();
  range.setEnd(input, input.childNodes.length);
  return range.toString();
}
