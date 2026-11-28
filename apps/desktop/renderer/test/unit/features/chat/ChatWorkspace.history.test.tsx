// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeMessage, RuntimeMessagePage, RuntimeThread } from '@setsuna-desktop/contracts';
import type { RendererOwnedSlotRenderer } from '@setsuna-desktop/feature-core/renderer';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatWorkspace } from '../../../../src/features/chat/ChatWorkspace.js';
import { RendererPluginTestHost } from '../../support/RendererPluginTestHost.js';

const highlights = new Map<string, Set<Range>>();

beforeEach(() => {
  vi.stubGlobal('Highlight', class extends Set<Range> {
    priority = 0;
    constructor(...ranges: Range[]) { super(ranges); }
  });
  vi.stubGlobal('CSS', { highlights });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.querySelectorAll('[data-message-id]').length * 500;
  });
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    const message = this.startContainer.parentElement?.closest('[data-message-id]');
    const viewport = message?.closest('.chat-messages');
    const index = Array.from(viewport?.querySelectorAll('[data-message-id]') ?? []).indexOf(message!);
    return new DOMRect(0, index * 500 + 250 - (viewport?.scrollTop ?? 0), 50, 20);
  });
});

afterEach(() => {
  cleanup();
  highlights.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads earlier pages as the reader scrolls up and keeps the latest reading position', async () => {
  const page = deferredPage();
  const oldest = deferredPage();
  const load = vi.fn<DesktopRuntimeClient['listThreadMessages']>()
    .mockImplementationOnce(page.load)
    .mockImplementationOnce(oldest.load);
  const thread = { ...snapshot, messagePage: { nextBefore: 2, total: 4 } };
  render(<Harness loadOlder={load} thread={thread} />);
  const viewport = screen.getByLabelText('对话消息');
  await waitFor(() => expect(viewport.scrollTop).toBe(600));
  expect(load).not.toHaveBeenCalled();

  scrollUpTo(viewport, 240);
  expect(load).not.toHaveBeenCalled();
  act(() => {
    scrollUpTo(viewport, 80);
    scrollUpTo(viewport, 25);
  });
  expect(load).toHaveBeenCalledExactlyOnceWith(thread.id, { before: 2, limit: 160 });

  await act(async () => { page.resolve({ messages: [message('old', 'earlier question')], nextBefore: 1, total: 4 }); });
  expect(screen.getByText('earlier question')).toBeTruthy();
  expect(viewport.scrollTop).toBe(525);
  expect(load).toHaveBeenCalledOnce();

  scrollUpTo(viewport);
  expect(load).toHaveBeenLastCalledWith(thread.id, { before: 1, limit: 160 });
  fireEvent.click(screen.getByRole('button', { name: '滚动到底部' }));
  await act(async () => { oldest.resolve({ messages: [message('oldest', 'first question')], nextBefore: null, total: 4 }); });
  expect(screen.getByText('first question')).toBeTruthy();
  await waitFor(() => expect(viewport.scrollTop).toBe(1600));
});

it.each(['message', 'standalone review'] as const)('restores a paged %s independently for each conversation', async (kind) => {
  const reopening = deferredPage();
  const reader: RuntimeMessage = kind === 'message' ? message('reader', 'reading here') : {
    ...message('review', ''), role: 'system', turnId: 'interrupted', reviewMode: { kind: 'exited', review: 'reading here' },
  };
  const older = { messages: [message('oldest', 'first question'), reader], nextBefore: null, total: 4 };
  const loadOlder = vi.fn<DesktopRuntimeClient['listThreadMessages']>()
    .mockResolvedValueOnce(older)
    .mockImplementationOnce(reopening.load)
    .mockResolvedValueOnce(older);
  const first = { ...snapshot, messagePage: { nextBefore: 2, total: 4 } };
  const second = { ...snapshot, id: 'thread-2', messages: [...snapshot.messages, message('third', 'third question')], messagePage: undefined };
  let rowHeight = 500;
  const rows = '[data-message-id], .chat-review-summary-card';
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.querySelectorAll(rows).length * rowHeight;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('chat-messages')) return new DOMRect(0, 0, 600, 400);
    const viewport = this.closest('.chat-messages');
    if (!viewport || !this.matches(rows)) return new DOMRect();
    const index = Array.from(viewport.querySelectorAll(rows)).indexOf(this);
    return new DOMRect(0, index * rowHeight - viewport.scrollTop, 600, rowHeight);
  });
  const chat = (thread: RuntimeThread) => <StrictMode><Harness loadOlder={loadOlder} thread={thread} /></StrictMode>;
  const view = render(chat(first));
  const viewport = () => screen.getByLabelText('对话消息');
  await waitFor(() => expect(viewport().scrollTop).toBe(600));
  scrollUpTo(viewport(), 80);
  const readingMessage = await screen.findByText('reading here');
  scrollUpTo(viewport(), 550);
  const readingOffset = readingMessage.closest(rows)!.getBoundingClientRect().top;

  view.rerender(chat(second));
  await waitFor(() => expect(viewport().scrollTop).toBe(1100));
  scrollUpTo(viewport(), 350);

  view.rerender(chat(first));
  await waitFor(() => expect(reopening.load).toHaveBeenCalledOnce());
  view.rerender(chat(second));
  expect(viewport().scrollTop).toBe(350);
  await act(async () => { reopening.resolve(older); });
  expect(viewport().scrollTop).toBe(350);
  expect(screen.queryByText('reading here')).toBeNull();

  rowHeight = 550;
  view.rerender(chat(first));
  const restored = await screen.findByText('reading here');
  expect(restored.closest(rows)!.getBoundingClientRect().top).toBe(readingOffset);
  expect(viewport().scrollTop).toBe(600);
});

it('keeps a cached message in place when the loading row disappears below it', async () => {
  const page = deferredPage();
  const thread = { ...longSnapshot, messagePage: { nextBefore: 1, total: 83 }, messageCount: 83 };
  render(<Harness loadOlder={page.load} thread={thread} />);
  const viewport = screen.getByLabelText('对话消息');
  const loadingSpace = 38;
  vi.spyOn(viewport, 'scrollHeight', 'get').mockImplementation(() => (
    viewport.querySelectorAll('[data-message-id]').length * 500
    + (viewport.querySelector('.chat-history-loading') ? loadingSpace : 0)
  ));
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 400));

  await waitFor(() => expect(viewport.scrollTop).toBeGreaterThan(120));
  scrollUpTo(viewport, 80);
  expect(page.load).toHaveBeenCalledExactlyOnceWith(thread.id, { before: 1, limit: 160 });
  const readingMessage = screen.getByText('history 0 needle').closest<HTMLElement>('[data-message-id]')!;
  vi.spyOn(readingMessage, 'getBoundingClientRect').mockImplementation(() => {
    const precedingMessages = Array.from(viewport.querySelectorAll('[data-message-id]')).indexOf(readingMessage);
    return new DOMRect(0, precedingMessages * 500 - viewport.scrollTop, 600, 500);
  });
  // The first cached message occupies the viewport, above the pending history row.
  scrollUpTo(viewport, 60);
  const readingOffset = readingMessage.getBoundingClientRect().top;

  await act(async () => { page.resolve({ messages: [message('old', 'earlier question')], nextBefore: null, total: 83 }); });
  expect(screen.getByText('earlier question')).toBeTruthy();
  expect(readingMessage.getBoundingClientRect().top).toBe(readingOffset);
});

it.each(['next result', 'new query', 'reading scroll'] as const)('keeps the latest %s position when an automatic search page arrives', async (action) => {
  const page = deferredPage();
  render(<Harness loadOlder={page.load} find />);
  const input = screen.getByRole('textbox', { name: '搜索对话内容' });
  fireEvent.change(input, { target: { value: 'needle' } });
  await waitFor(() => expect(page.load).toHaveBeenCalledOnce());
  if (action === 'new query') fireEvent.change(input, { target: { value: 'two' } });
  else fireEvent.keyDown(input, { key: 'Enter' });
  const viewport = screen.getByLabelText('对话消息');
  if (action === 'reading scroll') {
    viewport.scrollTop += 80;
    fireEvent.scroll(viewport);
  }
  const active = activeRange();
  const readingPosition = active.getBoundingClientRect().top;
  await act(async () => { page.resolve({ messages: [message('old', 'old needle')], nextBefore: null, total: 3 }); });
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(action === 'new query' ? '第 1 项，共 1 项' : '第 3 项，共 3 项'));
  expect(activeRange().startContainer).toBe(active.startContainer);
  expect(activeRange().getBoundingClientRect().top).toBe(readingPosition);
});

it.each([false, true])('recalls paged prompts and restores the draft (already browsing: %s)', async (alreadyBrowsing) => {
  const page = deferredPage();
  render(<Harness loadOlder={page.load} />);
  const input = screen.getByRole('textbox');
  if (alreadyBrowsing) {
    focusAtStart(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.textContent).toBe('two needle');
  }
  scrollUpTo(screen.getByLabelText('对话消息'));
  await act(async () => { page.resolve({ messages: [message('old', 'old question')], nextBefore: null, total: 3 }); });
  expect(screen.getByText('old question')).toBeTruthy();
  focusAtStart(input);
  if (!alreadyBrowsing) fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('one needle');
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.textContent).toBe('old question');
  for (let i = 0; i < 3; i += 1) fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.textContent).toBe('unsent draft');
});

it.each([false, true])('preserves history revealed by scrolling when find opens and closes (expanded: %s)', (expanded) => {
  const loadOlder = vi.fn();
  render(<Harness loadOlder={loadOlder} thread={longSnapshot} />);
  expect(screen.queryByText('history 0 needle')).toBeNull();
  if (expanded) scrollUpTo(screen.getByLabelText('对话消息'));

  fireEvent.click(screen.getByRole('button', { name: 'Open find' }));
  expect(screen.getByText('history 0 needle')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('textbox', { name: '搜索对话内容' }), { key: 'Escape' });

  expect(Boolean(screen.queryByText('history 0 needle'))).toBe(expanded);
  expect(loadOlder).not.toHaveBeenCalled();
});

it.each(['before close', 'after close'] as const)('restores the message window when a search page arrives %s, retaining loaded history', async (arrival) => {
  const page = deferredPage();
  const thread = { ...longSnapshot, messagePage: { nextBefore: 1, total: 83 }, messageCount: 83 };
  render(<Harness loadOlder={page.load} thread={thread} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open find' }));
  const input = screen.getByRole('textbox', { name: '搜索对话内容' });
  fireEvent.change(input, { target: { value: 'needle' } });
  await waitFor(() => expect(page.load).toHaveBeenCalledOnce());

  const finishPage = async () => {
    await act(async () => { page.resolve({ messages: [message('old', 'old needle')], nextBefore: null, total: 83 }); });
  };
  if (arrival === 'before close') {
    await finishPage();
    expect(screen.getByText('old needle')).toBeTruthy();
  }
  fireEvent.keyDown(input, { key: 'Escape' });
  if (arrival === 'after close') await finishPage();

  expect(screen.queryByRole('search')).toBeNull();
  expect(screen.queryByText('history 0 needle')).toBeNull();
  expect(screen.queryByText('old needle')).toBeNull();
  expect(screen.getByText('history 81 needle')).toBeTruthy();
  scrollUpTo(screen.getByLabelText('对话消息'));
  expect(screen.getByText('old needle')).toBeTruthy();
  expect(page.load).toHaveBeenCalledOnce();
});

function scrollUpTo(viewport: HTMLElement, top = 0) {
  const previousTop = viewport.scrollTop;
  fireEvent.wheel(viewport, { deltaY: Math.min(-1, top - previousTop) });
  if (previousTop > top) {
    // The DOM emulator does not apply the wheel's native scroll position.
    viewport.scrollTop = top;
    fireEvent.scroll(viewport);
  }
}

function activeRange(): Range {
  return [...highlights.get('content-find-active')!][0];
}

function focusAtStart(input: HTMLElement) {
  input.focus();
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}

function deferredPage() {
  let resolve!: (page: RuntimeMessagePage) => void;
  const load = vi.fn(() => new Promise<RuntimeMessagePage>((done) => { resolve = done; }));
  return { load, resolve: (page: RuntimeMessagePage) => resolve(page) };
}

function message(id: string, content: string): RuntimeMessage {
  return { id, content, role: 'user', createdAt: '2026-09-28T00:00:00.000Z', status: 'complete' };
}

const snapshot: RuntimeThread = {
  id: 'thread-1', title: 'Thread', messages: [message('one', 'one needle'), message('two', 'two needle')],
  messagePage: { nextBefore: 2, total: 3 }, messageCount: 3,
  createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z',
  archived: false, lastMessagePreview: '', lastSeq: 1,
};
const longSnapshot: RuntimeThread = {
  ...snapshot,
  messages: Array.from({ length: 82 }, (_, index) => message(`history-${index}`, `history ${index} needle`)),
  messagePage: { nextBefore: null, total: 82 }, messageCount: 82,
};
const slots: RendererOwnedSlotRenderer = {
  chain: () => null as never, keyed: () => null, keyedEntries: () => [], list: () => null, listEntryIds: () => [],
  single: (_slot, props) => (props as { renderDefault?: () => ReactNode }).renderDefault?.() ?? null,
};
const noop = () => undefined;

function Harness({ loadOlder, find = false, thread = snapshot }: {
  loadOlder: DesktopRuntimeClient['listThreadMessages'];
  find?: boolean;
  thread?: RuntimeThread;
}) {
  const [client] = useState(() => ({ listThreadMessages: loadOlder } as DesktopRuntimeClient));
  const [draft, setDraft] = useState('unsent draft');
  const [request, setRequest] = useState(find ? 1 : 0);
  return <RendererPluginTestHost slots={slots}>
    <button type="button" onClick={() => setRequest((value) => value + 1)}>Open find</button>
    <ChatWorkspace
      activeTurnId={null} client={client} config={null} canClearContext={false}
      composerKey="test-composer" currentThread={thread} draft={draft} skills={[]}
      capabilitySelectionRequest={null} onCapabilitySelectionRequestConsumed={noop}
      findInChatRequest={request} onFindInChatRequestConsumed={() => setRequest(0)}
      onDraftChange={setDraft} onSend={async () => false} onAnswerApproval={async () => undefined}
      onDeleteMessages={noop} onEditUserMessage={noop}
      queuedTurnActions={{ deleteQueuedTurnInput: vi.fn(), retrieveQueuedTurnInput: vi.fn(), reorderQueuedTurnInputs: vi.fn(), sendQueuedTurnInputNow: vi.fn() }}
      onAccessModeChange={noop} onCancelActiveTurn={noop} onClearContext={noop} onCompactContext={noop}
      onSelectModel={noop} onStartThreadReview={vi.fn()} onSearchProjectEntries={vi.fn()}
    />
  </RendererPluginTestHost>;
}
