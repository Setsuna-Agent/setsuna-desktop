// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageRail } from '../../../../../../src/features/chat/conversation/navigation/ChatMessageRail.js';
import { activeChatMessageIndex, createChatMessageNavigation, type ChatMessageNavigationItem } from '../../../../../../src/features/chat/conversation/navigation/chatMessageNavigation.js';
import { createChatDisplayItems } from '../../../../../../src/features/chat/conversation/chatMessageDisplay.js';

const frames = new Map<number, FrameRequestCallback>();
const resizeCallbacks = new Set<() => void>();
const onScrollToOffset = vi.fn();
const onScrollToBottom = vi.fn();
const items: ChatMessageNavigationItem[] = ['First question', 'First response', 'Latest question', 'Latest response']
  .map((label, index) => ({ id: `${index}`, role: index % 2 ? 'assistant' : 'user', label, description: `${label} preview` }));

beforeEach(() => {
  let frameId = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++frameId, callback); return frameId; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.add(callback); }
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  frames.clear();
  resizeCallbacks.clear();
  onScrollToOffset.mockReset();
  onScrollToBottom.mockReset();
  document.documentElement.style.removeProperty('--app-page-scale-inverse');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('chat message navigation', () => {
  it('keeps anchors stable across assistant segments and uses the visible answer for question previews', () => {
    const messages: RuntimeMessage[] = [
      { id: 'user', turnId: 'turn', role: 'user', content: 'Explain `user_name`', status: 'complete', createdAt: '2026-09-11T00:00:00Z' },
      { id: 'work', turnId: 'turn', role: 'assistant', content: '<think>Hidden reasoning</think>Checking the code', status: 'complete', createdAt: '2026-09-11T00:00:01Z' },
    ];
    const initial = createChatMessageNavigation(createChatDisplayItems(messages));
    const completed = createChatMessageNavigation(createChatDisplayItems([...messages,
      { id: 'answer', turnId: 'turn', role: 'assistant', phase: 'final_answer', content: '**Answer** about `user_name`', status: 'complete', createdAt: '2026-09-11T00:00:02Z' },
    ]));
    expect(completed.map((item) => item.id)).toEqual(initial.map((item) => item.id));
    expect(initial[0].description).toBe('Checking the code');
    expect(completed[0].label).toBe('Explain user_name');
    expect(completed[0].description).toBe('Answer about user_name');
  });

  it('keeps a long reply current while the viewport center is inside it', () => {
    expect(activeChatMessageIndex([
      { id: 'question', top: 0, height: 100 },
      { id: 'reply', top: 140, height: 3000 },
      { id: 'next', top: 3180, height: 100 },
    ], 200, 600, 4000)).toBe(1);
  });

  it('previews on hover and keyboard focus, jumps in scaled coordinates, and resumes follow only for the last tick', () => {
    render(<Harness />);
    mockGeometry(1.25);
    const nav = screen.getByRole('navigation', { name: '消息导航' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons[0].getAttribute('aria-current')).toBe('location');
    fireEvent.pointerEnter(buttons[1]);
    expect(screen.getByRole('tooltip').textContent).toContain('First response preview');
    fireEvent.click(buttons[1]);
    expect(onScrollToOffset).toHaveBeenCalledWith(300);
    expect(onScrollToBottom).not.toHaveBeenCalled();
    fireEvent.pointerLeave(buttons[1].parentElement!);
    act(() => buttons[1].focus());
    fireEvent.keyDown(buttons[1], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[2]);
    expect(screen.getByRole('tooltip').textContent).toContain('Latest question');
    fireEvent.keyDown(buttons[2], { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.keyDown(buttons[2], { key: 'End' });
    expect(document.activeElement).toBe(buttons[3]);
    fireEvent.click(buttons[3]);
    expect(onScrollToBottom).toHaveBeenCalledOnce();
  });

  it('moves a contiguous reading band smoothly and hides navigation when the viewport no longer overflows', () => {
    render(<Harness />);
    const { viewport, metrics } = mockGeometry(1.25);
    const buttons = screen.getAllByRole('button');
    const ticks = buttons.map((button) => button.querySelector('span')!);
    viewport.scrollTop = 500;
    fireEvent.scroll(viewport);
    flushFrames();
    const firstOpacity = Number(ticks[0].style.opacity);
    const lastOpacity = Number(ticks[3].style.opacity);
    expect(firstOpacity).toBeGreaterThan(0.45);
    expect(firstOpacity).toBeLessThan(1);
    expect(lastOpacity).toBeGreaterThan(0.45);
    expect(lastOpacity).toBeLessThan(1);
    viewport.scrollTop = 650;
    fireEvent.scroll(viewport);
    flushFrames();
    expect(Number(ticks[0].style.opacity)).toBeLessThan(firstOpacity);
    expect(Number(ticks[3].style.opacity)).toBeGreaterThan(lastOpacity);
    expect(ticks.slice(1, 3).every((tick) => tick.style.opacity === '1')).toBe(true);
    expect(ticks.every((tick) => tick.style.transform === 'scaleX(0.25)')).toBe(true);
    expect(buttons[2].getAttribute('aria-current')).toBe('location');
    viewport.scrollTop = 1190;
    fireEvent.scroll(viewport);
    flushFrames();
    expect(buttons[3].getAttribute('aria-current')).toBe('location');
    metrics.height = 1700;
    notifyResize();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('updates a streamed preview without replacing the focused message tick', () => {
    const view = render(<Harness />);
    mockGeometry();
    const tick = screen.getAllByRole('button')[3];
    act(() => tick.focus());
    view.rerender(<Harness navigationItems={items.map((item, index) => index === 3 ? { ...item, description: 'New streamed response' } : item)} />);
    expect(document.activeElement).toBe(tick);
    expect(screen.getByRole('tooltip').textContent).toContain('New streamed response');
  });
});

function Harness({ navigationItems = items }: { navigationItems?: ChatMessageNavigationItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  return <>
    <div ref={scrollRef} data-testid="viewport"><div ref={contentRef}>
      {navigationItems.map((item) => <article key={item.id} data-message-id={item.id}>{item.label}</article>)}
    </div></div>
    <ChatMessageRail items={navigationItems} scrollRef={scrollRef} contentRef={contentRef} onScrollToOffset={onScrollToOffset} onScrollToBottom={onScrollToBottom} />
  </>;
}

function mockGeometry(scale = 1) {
  const viewport = screen.getByTestId('viewport');
  const metrics = { height: 400 };
  document.documentElement.style.setProperty('--app-page-scale-inverse', String(1 / scale));
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, get: () => metrics.height },
    clientWidth: { configurable: true, value: 800 },
    scrollHeight: { configurable: true, value: 1600 },
  });
  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => ({ top: 100 * scale, height: metrics.height * scale }) as DOMRect);
  viewport.querySelectorAll<HTMLElement>('article').forEach((node, index) => {
    vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => ({ top: (100 + index * 400 - viewport.scrollTop) * scale, height: 200 * scale }) as DOMRect);
  });
  notifyResize();
  return { viewport, metrics };
}

function notifyResize() {
  act(() => { for (const callback of resizeCallbacks) callback(); });
  flushFrames();
}

function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(16);
  });
}
