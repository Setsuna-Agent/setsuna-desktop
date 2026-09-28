// @vitest-environment happy-dom
import type { DesktopRuntimeClient, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatFindBar } from '../../../../../../src/features/chat/conversation/search/ChatFindBar.js';
import { useThreadMessageHistory } from '../../../../../../src/features/chat/hooks/useThreadMessageHistory.js';

const highlights = new Map<string, Set<Range>>();
const scroll = vi.fn();

beforeEach(() => {
  vi.stubGlobal('Highlight', class extends Set<Range> {
    priority = 0;
    constructor(...ranges: Range[]) { super(ranges); }
  });
  vi.stubGlobal('CSS', { highlights });
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 400, 50, 20));
});

afterEach(() => {
  cleanup();
  highlights.clear();
  scroll.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('conversation find interactions', () => {
  it('focuses find, wraps keyboard navigation, respects IME, and releases highlights/focus on close', () => {
    const previous = document.createElement('input');
    document.body.append(previous);
    previous.focus();
    const client = { listThreadMessages: vi.fn() };
    render(<Harness client={client} thread={thread([message('1', 'one needle'), message('2', 'two needle')])} />);
    const input = screen.getByRole('textbox', { name: '搜索对话内容' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'needle' } });
    expect(screen.getByRole('status').textContent).toBe('第 1 项，共 2 项');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(activeText()).toBe('two needle');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(activeText()).toBe('two needle');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(activeText()).toBe('one needle');
    fireEvent.click(screen.getByRole('button', { name: '下一个结果' }));
    expect(activeText()).toBe('two needle');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(highlights.size).toBe(0);
    expect(document.activeElement).toBe(previous);
    previous.remove();
  });

  it('refreshes streamed and prepended text while preserving the selected match without another scroll', async () => {
    const client = { listThreadMessages: vi.fn() };
    const view = render(<Harness client={client} thread={thread([message('2', 'one needle'), message('3', 'two needle')])} />);
    const input = screen.getByRole('textbox', { name: '搜索对话内容' });
    fireEvent.change(input, { target: { value: 'needle' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const scrollCount = scroll.mock.calls.length;
    view.rerender(<Harness client={client} thread={thread([
      message('1', 'old needle'), message('2', 'one needle'), message('3', 'two needle'), message('4', 'new needle'),
    ])} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('第 3 项，共 4 项'));
    expect(activeText()).toBe('two needle');
    expect(scroll).toHaveBeenCalledTimes(scrollCount);
    fireEvent.change(input, { target: { value: 'missing' } });
    expect(screen.getByRole('status').textContent).toBe('无结果');
    expect((screen.getByRole('button', { name: '下一个结果' }) as HTMLButtonElement).disabled).toBe(true);
    expect(highlights.get('content-find-active')?.size).toBe(0);
  });

  it('searches paginated history and stops scheduling pages when find closes', async () => {
    let resolvePage!: (page: Awaited<ReturnType<DesktopRuntimeClient['listThreadMessages']>>) => void;
    const client = { listThreadMessages: vi.fn(() => new Promise<Awaited<ReturnType<DesktopRuntimeClient['listThreadMessages']>>>((resolve) => { resolvePage = resolve; })) };
    render(<Harness client={client} thread={thread([message('3', 'recent')], { nextBefore: 2, total: 3 })} />);
    const input = screen.getByRole('textbox', { name: '搜索对话内容' });
    fireEvent.change(input, { target: { value: 'needle' } });
    await waitFor(() => expect(client.listThreadMessages).toHaveBeenCalledExactlyOnceWith('thread-1', { before: 2, limit: 160 }));
    await act(async () => { resolvePage({ messages: [message('2', 'older needle')], nextBefore: 1, total: 3 }); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('第 1 项，共 1 项'));
    await waitFor(() => expect(client.listThreadMessages).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => { resolvePage({ messages: [message('1', 'oldest needle')], nextBefore: 0, total: 3 }); });
    expect(client.listThreadMessages).toHaveBeenCalledTimes(2);
    expect(highlights.size).toBe(0);
  });
});

function activeText() {
  return [...(highlights.get('content-find-active') ?? [])][0]?.startContainer.textContent;
}

function Harness({ client, thread: snapshot }: {
  client: Pick<DesktopRuntimeClient, 'listThreadMessages'>;
  thread: RuntimeThread;
}) {
  const history = useThreadMessageHistory(client, snapshot);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(true);
  const [request, setRequest] = useState(1);
  return <>
    <div ref={scrollRef}><div ref={contentRef}>{history.messages.map((item) => <p key={item.id}>{item.content}</p>)}</div></div>
    {open ? <ChatFindBar contentRef={contentRef} scrollRef={scrollRef} history={history} onLoadOlder={history.loadOlder} focusRequest={request} onFocusRequestConsumed={() => setRequest(0)} onClose={() => setOpen(false)} onScrollToOffset={scroll} /> : null}
  </>;
}

function message(id: string, content: string): RuntimeMessage {
  return { id, content, role: 'assistant', createdAt: '2026-09-28T00:00:00.000Z', status: 'complete' };
}

function thread(messages: RuntimeMessage[], messagePage = { nextBefore: null as number | null, total: messages.length }): RuntimeThread {
  return {
    id: 'thread-1', title: 'Thread', messages, messagePage, messageCount: messagePage.total,
    createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z',
    archived: false, lastMessagePreview: '', lastSeq: 1,
  };
}
