// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeMessage, RuntimeSkillSummary, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatComposer } from '../../../../src/features/chat/ChatComposer.js';
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

function Harness({ initialDraft = '', client = {} as DesktopRuntimeClient, messages = [], skills = [], threadId = 'thread-1', send = async () => false }: {
  initialDraft?: string;
  client?: DesktopRuntimeClient;
  messages?: RuntimeMessage[];
  skills?: RuntimeSkillSummary[];
  threadId?: string;
  send?: (...args: unknown[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(initialDraft);
  return <RendererPluginTestHost><ChatComposer
    activeTurnId={null} client={client} config={null} canClearContext={false}
    contextUsage={{ compactedMessageCount: 0, percent: 0, totalTokens: 256_000, triggerScopes: [], usedTokens: 0, visiblePercent: 0 }}
    currentThread={{ id: threadId, messages, queuedTurnInputs: [] } as unknown as RuntimeThread}
    draft={draft} skills={skills} onDraftChange={setDraft} onSend={send}
    queuedTurnActions={{ deleteQueuedTurnInput: vi.fn(), releaseQueuedTurnInputEdit: vi.fn(), retrieveQueuedTurnInput: vi.fn(), sendQueuedTurnInputNow: vi.fn(), updateQueuedTurnInput: vi.fn() }}
    onAccessModeChange={vi.fn()} onCancelActiveTurn={vi.fn()} onClearContext={vi.fn()} onCompactContext={vi.fn()}
    onSelectModel={vi.fn()} onSetMultiAgentEnabled={vi.fn()} onStartThreadReview={vi.fn()} onSearchProjectEntries={vi.fn()}
  /></RendererPluginTestHost>;
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
