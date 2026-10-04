// @vitest-environment happy-dom

import type { DesktopRuntimeClient, RuntimeMessage, RuntimeMessagePage, RuntimeThread } from '@setsuna-desktop/contracts';
import type { RendererOwnedSlotRenderer } from '@setsuna-desktop/feature-core/renderer';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatWorkspace } from '../../../../src/features/chat/ChatWorkspace.js';
import { RendererPluginTestHost } from '../../support/RendererPluginTestHost.js';

const highlights = new Map<string, Set<Range>>();

// Supply deterministic scrolling in the DOM emulator; keep the transcript's
// paging, anchor restoration, find navigation and composer wiring real.
vi.mock('../../../../src/features/chat/conversation/ChatWorkspaceScroll.js', async () => {
  const { useCallback, useRef } = await import('react');
  return {
    useConversationOverviewLayout: () => 'hidden',
    usePinnedChatScroll: () => {
      const scrollRef = useRef<HTMLDivElement | null>(null);
      const listRef = useRef<HTMLDivElement | null>(null);
      const scrollToOffset = useCallback((top: number) => { if (scrollRef.current) scrollRef.current.scrollTop = top; }, []);
      const noop = useCallback(() => undefined, []);
      return {
        scrollRef, listRef, scrollToOffset, scrollToBottom: noop, showScrollBottom: false,
        handleScroll: noop, handleScrollKeyDown: noop, handleScrollPointerDown: noop,
        handleScrollTouchMove: noop, handleScrollWheel: noop,
      };
    },
  };
});

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
  fireEvent.click(screen.getByRole('button', { name: '加载较早记录' }));
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

it.each([false, true])('preserves manual history expansion when find opens and closes (expanded: %s)', (expanded) => {
  const loadOlder = vi.fn();
  render(<Harness loadOlder={loadOlder} thread={longSnapshot} />);
  expect(screen.queryByText('history 0 needle')).toBeNull();
  if (expanded) fireEvent.click(screen.getByRole('button', { name: /已折叠较早的/ }));

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
  fireEvent.click(screen.getByRole('button', { name: /已折叠较早的/ }));
  expect(screen.getByText('old needle')).toBeTruthy();
  expect(page.load).toHaveBeenCalledOnce();
});

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
      queuedTurnActions={{ deleteQueuedTurnInput: vi.fn(), releaseQueuedTurnInputEdit: vi.fn(), retrieveQueuedTurnInput: vi.fn(), sendQueuedTurnInputNow: vi.fn(), updateQueuedTurnInput: vi.fn() }}
      onAccessModeChange={noop} onCancelActiveTurn={noop} onClearContext={noop} onCompactContext={noop}
      onSelectModel={noop} onSetMultiAgentEnabled={noop} onStartThreadReview={vi.fn()} onSearchProjectEntries={vi.fn()}
    />
  </RendererPluginTestHost>;
}
