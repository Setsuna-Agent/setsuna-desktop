// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatThinkingDisclosure } from '../../../../../src/features/chat/conversation/ChatThinkingDisclosure.js';
import {
  nextStreamingScrollPinned,
  scrollDistanceToBottom,
  useStreamingScrollPin,
} from '../../../../../src/features/chat/conversation/useStreamingScrollPin.js';

vi.mock('../../../../../src/features/chat/markdown/MarkdownRenderer.js', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <p>{content}</p>,
}));

const frames = new Map<number, FrameRequestCallback>();
const observers = new Map<Element, () => void>();

beforeEach(() => {
  let frameId = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      observers.set(target, () => this.callback([], this));
    }
    unobserve(target: Element) { this.targets.delete(target); observers.delete(target); }
    disconnect() { for (const target of this.targets) observers.delete(target); }
  });
});

afterEach(() => {
  cleanup();
  frames.clear();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('streaming overflow scroll pin', () => {
  it('releases immediately when the user scrolls upward and stays released away from the bottom', () => {
    let pinned = nextStreamingScrollPinned(true, { type: 'user-scroll-up' });
    expect(pinned).toBe(false);

    pinned = nextStreamingScrollPinned(pinned, { type: 'scroll-position', distanceToBottom: 2 });
    expect(pinned).toBe(false);
  });

  it('keeps following content growth and accepts fractional bottom positions', () => {
    expect(nextStreamingScrollPinned(true, { type: 'scroll-position', distanceToBottom: 80 })).toBe(true);
    expect(nextStreamingScrollPinned(false, { type: 'scroll-position', distanceToBottom: 0 })).toBe(true);
    expect(nextStreamingScrollPinned(false, { type: 'scroll-position', distanceToBottom: 0.4 })).toBe(true);
    expect(nextStreamingScrollPinned(false, { type: 'scroll-position', distanceToBottom: 2 })).toBe(false);
  });

  it('calculates the remaining scroll distance without returning negative values', () => {
    expect(scrollDistanceToBottom({ clientHeight: 100, scrollHeight: 500, scrollTop: 275 })).toBe(125);
    expect(scrollDistanceToBottom({ clientHeight: 100, scrollHeight: 100, scrollTop: 5 })).toBe(0);
  });

  it('follows delayed content growth without another source update, including completion', () => {
    const view = render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    expect(viewport.scrollTop).toBe(400);

    view.rerender(<ScrollHarness signal="new source" />);
    flushFrames();
    // The source has arrived, but Markdown reveals it in later frames.
    metrics.scrollHeight = 700;
    notifyContentResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(600);

    // A browser scroll/anchor event can arrive before the content observer.
    metrics.scrollHeight = 780;
    fireEvent.scroll(viewport);
    notifyContentResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(680);

    metrics.scrollHeight = 820;
    view.rerender(<ScrollHarness active={false} signal="new source" />);
    notifyContentResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(720);
    view.unmount();
    expect(frames.size).toBe(0);
    expect(observers.size).toBe(0);
  });

  it.each(['wheel', 'keyboard', 'touch'])('lets an upward %s gesture pause follow until the user scrolls back down', (gesture) => {
    const view = render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    view.rerender(<ScrollHarness signal="pending update" />);
    if (gesture === 'wheel') fireEvent.wheel(viewport, { deltaY: -0.5 });
    else if (gesture === 'keyboard') fireEvent.keyDown(viewport, { key: 'ArrowUp' });
    else fireEvent.touchMove(viewport);
    // A subpixel upward movement is still explicit intent to stop following.
    viewport.scrollTop = 399.5;
    fireEvent.scroll(viewport);
    metrics.scrollHeight = 700;
    notifyContentResize();
    view.rerender(<ScrollHarness signal="more source" />);
    flushFrames();
    expect(viewport.scrollTop).toBe(399.5);

    viewport.scrollTop = 599.6;
    fireEvent.scroll(viewport);
    metrics.scrollHeight = 760;
    notifyContentResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(660);
  });

  it('does not reattach at the bottom during a held scrollbar drag', () => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    Object.defineProperties(viewport, {
      offsetWidth: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 292 },
    });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 300, right: 300 } as DOMRect);
    flushFrames();
    fireEvent.pointerDown(viewport, { button: 0, clientX: 298 });
    viewport.scrollTop = 300;
    fireEvent.scroll(viewport);
    viewport.scrollTop = 400;
    fireEvent.scroll(viewport);
    metrics.scrollHeight = 600;
    notifyContentResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(400);

    viewport.scrollTop = 500;
    fireEvent.scroll(viewport);
    fireEvent.pointerUp(document.body);
    metrics.scrollHeight = 700;
    notifyContentResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(600);
  });

  it('opens completed history at the start and resets follow only for a new thinking record', () => {
    const view = render(<ScrollHarness active={false} signal="history" />);
    const viewport = screen.getByTestId('viewport');
    mockScrollMetrics(viewport);
    notifyContentResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(0);
    view.rerender(<ScrollHarness signal="new thinking" stateKey="next" />);
    flushFrames();
    expect(viewport.scrollTop).toBe(400);
  });

  it.each([false, true])('preserves the open thinking viewport when streaming completes (paused: %s)', (paused) => {
    const view = render(<ChatThinkingDisclosure active content="Thinking" scrollStateKey="record" />);
    const disclosure = view.container.querySelector('details')!;
    act(() => { disclosure.open = true; fireEvent(disclosure, new Event('toggle')); });
    const readViewport = () => view.container.querySelector<HTMLDivElement>('.chat-thinking-disclosure__content')!;
    const viewport = readViewport();
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    if (paused) {
      fireEvent.wheel(viewport, { deltaY: -100 });
      viewport.scrollTop = 175;
      fireEvent.scroll(viewport);
    }

    // Completion can reveal the remaining buffered Markdown in the same update.
    metrics.scrollHeight = 700;
    view.rerender(<ChatThinkingDisclosure active={false} content="Completed thinking" scrollStateKey="record" />);
    act(() => { for (const notify of observers.values()) notify(); });
    flushFrames();
    expect(readViewport().scrollTop).toBe(paused ? 175 : 600);
  });
});

function ScrollHarness({ signal, stateKey = 'thinking', active = true }: {
  signal: string; stateKey?: string; active?: boolean;
}) {
  const pin = useStreamingScrollPin(signal, stateKey, active);
  return (
    <div data-testid="viewport" ref={pin.scrollRef} onScroll={pin.handleScroll}
      onWheelCapture={pin.handleWheel} onTouchMoveCapture={pin.handleTouchMove}
      onKeyDownCapture={pin.handleKeyDown} onPointerDownCapture={pin.handlePointerDown}>
      <div data-testid="content" ref={pin.contentRef} />
    </div>
  );
}

function mockScrollMetrics(viewport: HTMLElement) {
  const metrics = { scrollHeight: 500, clientHeight: 100, scrollTop: 0 };
  Object.defineProperties(viewport, {
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (value: number) => { metrics.scrollTop = Math.max(0, Math.min(value, metrics.scrollHeight - metrics.clientHeight)); },
    },
  });
  return metrics;
}

function flushFrames() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(16);
  });
}

function notifyContentResize() {
  act(() => { observers.get(screen.getByTestId('content'))?.(); });
}
