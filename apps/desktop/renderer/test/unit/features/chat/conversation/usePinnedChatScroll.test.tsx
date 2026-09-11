// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePinnedChatScroll } from '../../../../../src/features/chat/conversation/ChatWorkspaceScroll.js';

const frames = new Map<number, FrameRequestCallback>();
const resizeCallbacks = new Set<() => void>();
let clock = 0;

beforeEach(() => {
  let frameId = 0;
  clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class implements ResizeObserver {
    private readonly notify: () => void;
    constructor(callback: ResizeObserverCallback) {
      this.notify = () => callback([], this);
      resizeCallbacks.add(this.notify);
    }
    observe() {}
    unobserve() {}
    disconnect() { resizeCallbacks.delete(this.notify); }
  });
});

afterEach(() => {
  cleanup();
  frames.clear();
  resizeCallbacks.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pinned chat scrolling', () => {
  it.each([false, true])('keeps a small upward wheel movement released with intervening layout notification: %s', (notifyBeforeScroll) => {
    const view = render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    expect(viewport.scrollTop).toBe(500);

    // A content commit has already queued a bottom jump when the user takes over.
    view.rerender(<ScrollHarness signal="streaming" />);
    fireEvent.wheel(viewport, { deltaY: -2 });
    if (notifyBeforeScroll) {
      notifyResize();
      fireEvent.scroll(viewport);
      view.rerender(<ScrollHarness signal="layout-before-wheel" />);
    }
    viewport.scrollTop = 498;
    fireEvent.scroll(viewport);
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();

    expect(viewport.scrollTop).toBe(498);
  });

  it('glides toward a growing stream without restarting the pending frame', () => {
    const view = render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    metrics.scrollHeight += 200;
    notifyResize();
    flushOneFrame();
    expect(viewport.scrollTop).toBeGreaterThan(500);
    expect(viewport.scrollTop).toBeLessThan(700);
    const pendingFrame = [...frames.keys()];
    metrics.scrollHeight += 100;
    view.rerender(<ScrollHarness signal="more-text" />);
    notifyResize();
    expect([...frames.keys()]).toEqual(pendingFrame);
    flushFrames();
    expect(viewport.scrollTop).toBe(800);
  });

  it('keeps a programmatic message jump detached even inside the bottom threshold', () => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to message' }));
    fireEvent.scroll(viewport);
    expect(viewport.scrollTop).toBe(450);
    metrics.scrollHeight += 100;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(450);
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
    flushFrames();
    expect(viewport.scrollTop).toBe(600);
  });

  it('snaps without a glide when reduced motion is enabled', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    metrics.scrollHeight += 200;
    notifyResize();
    flushOneFrame();
    expect(viewport.scrollTop).toBe(700);
    expect(frames.size).toBe(0);
  });

  it('does not release follow for arrow keys used inside an input', () => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowUp' });
    metrics.scrollHeight += 100;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(600);
  });

  it('resumes following after scrolling down to the bottom or explicitly returning to it', () => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();

    fireEvent.wheel(viewport, { deltaY: -100 });
    viewport.scrollTop = 400;
    fireEvent.scroll(viewport);
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(400);

    fireEvent.wheel(viewport, { deltaY: 180 });
    viewport.scrollTop = 580;
    fireEvent.scroll(viewport);
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(660);

    fireEvent.wheel(viewport, { deltaY: -200 });
    viewport.scrollTop = 460;
    fireEvent.scroll(viewport);
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
    flushFrames();
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(740);
  });
});

function ScrollHarness({ signal }: { signal: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const scroll = usePinnedChatScroll({ contentRef, scrollSignal: signal, showEmptyStarter: false, threadId: 'thread-1' });
  return (
    <>
      <div ref={scroll.scrollRef} data-testid="viewport" onScroll={scroll.handleScroll} onKeyDownCapture={scroll.handleScrollKeyDown} onWheelCapture={scroll.handleScrollWheel}>
        <div ref={contentRef}><div ref={scroll.listRef}><input /></div></div>
      </div>
      <button onClick={() => scroll.scrollToOffset(450)}>Jump to message</button>
      {scroll.showScrollBottom ? <button onClick={() => scroll.scrollToBottom()}>Scroll to bottom</button> : null}
    </>
  );
}

function mockScrollMetrics(node: HTMLElement) {
  const metrics = { clientHeight: 500, scrollHeight: 1_000, scrollTop: 0 };
  Object.defineProperties(node, {
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => metrics.scrollTop,
      set: (value: number) => { metrics.scrollTop = Math.max(0, Math.min(value, metrics.scrollHeight - metrics.clientHeight)); },
    },
  });
  vi.spyOn(node, 'scrollTo').mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === 'object') node.scrollTop = options.top ?? node.scrollTop;
  });
  return metrics;
}

function notifyResize() {
  act(() => { for (const notify of resizeCallbacks) notify(); });
}

function flushFrames() {
  act(() => {
    while (frames.size) {
      const pending = [...frames.values()];
      frames.clear();
      clock += 16;
      for (const callback of pending) callback(clock);
    }
  });
}

function flushOneFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    clock += 16;
    for (const callback of pending) callback(clock);
  });
}
