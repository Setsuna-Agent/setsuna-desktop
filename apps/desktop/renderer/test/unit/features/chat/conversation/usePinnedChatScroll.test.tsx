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
    flushFrames();
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

  it('smooths and accumulates wheel input after idle while streaming stays detached', () => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    clock += 5_000;
    fireEvent.wheel(viewport, { deltaY: -120 });
    expect(viewport.scrollTop).toBe(500);
    flushOneFrame();
    expect(viewport.scrollTop).toBeGreaterThan(380);
    expect(viewport.scrollTop).toBeLessThan(500);
    fireEvent.wheel(viewport, { deltaY: -80 });
    metrics.scrollHeight += 200;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(300);
    expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeTruthy();
  });

  it('cancels wheel momentum when restoring a prepended history anchor', () => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.wheel(viewport, { deltaY: -200 });
    flushOneFrame();
    metrics.scrollHeight += 500;
    fireEvent.click(screen.getByRole('button', { name: 'Restore history anchor' }));
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(900);
    fireEvent.wheel(viewport, { deltaY: -100 });
    flushFrames();
    expect(viewport.scrollTop).toBe(800);
  });

  it.each([1, 0.8])('lets scrollbar dragging take over momentum and restore follow at the bottom at scale %s', (scale) => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    notifyResize();
    flushFrames();
    Object.defineProperties(viewport, {
      offsetWidth: { configurable: true, value: 800 },
      clientWidth: { configurable: true, value: 790 },
    });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 800 * scale, right: 100 + 800 * scale } as DOMRect);

    // Clicking the message area must not release streaming follow.
    fireEvent.pointerDown(viewport, { clientX: 100 + 300 * scale });
    metrics.scrollHeight += 20;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(520);

    fireEvent.wheel(viewport, { deltaY: -200 });
    flushOneFrame();
    const grabbedTop = viewport.scrollTop;
    fireEvent.pointerDown(viewport, { clientX: 100 + 795 * scale });
    flushFrames();
    expect(viewport.scrollTop).toBe(grabbedTop);
    // Native scrollbar dragging writes the scroll position and emits scroll events.
    viewport.scrollTop = grabbedTop - 100;
    fireEvent.scroll(viewport);

    metrics.scrollHeight += 200;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBeCloseTo(grabbedTop - 100);
    fireEvent.pointerUp(document.body);
    fireEvent.wheel(viewport, { deltaY: -20 });
    flushFrames();
    expect(viewport.scrollTop).toBeCloseTo(grabbedTop - 120);

    fireEvent.pointerDown(viewport, { clientX: 100 + 795 * scale });
    viewport.scrollTop = 720;
    fireEvent.scroll(viewport);
    fireEvent.pointerUp(document.body);
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(800);
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull();
  });

  it('keeps a held scrollbar in control across snap-back and resizing until release over the overview', () => {
    const view = render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    mockScrollbarGutter(viewport);
    flushFrames();
    const overview = screen.getByTestId('overview');

    fireEvent.pointerDown(viewport, { clientX: 895, buttons: 1 });
    // Leaving a Windows scrollbar's horizontal drag range can restore its starting position.
    for (const top of [400, 500, 420]) {
      viewport.scrollTop = top;
      fireEvent.scroll(viewport);
      fireEvent.pointerMove(overview, { buttons: 1, clientX: 600 });
      notifyResize();
      view.rerender(<ScrollHarness signal={`drag-${top}`} />);
      flushFrames();
      expect(viewport.scrollTop).toBe(top);
    }
    fireEvent.pointerUp(overview);
    metrics.scrollHeight += 100;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(420);

    fireEvent.pointerDown(viewport, { clientX: 895, buttons: 1 });
    viewport.scrollTop = 600;
    fireEvent.scroll(viewport);
    // Content growth must remain detached even after the held thumb reaches the bottom.
    metrics.scrollHeight += 100;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(600);
    viewport.scrollTop = 700;
    fireEvent.scroll(viewport);
    fireEvent.pointerUp(overview);
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(780);
  });

  it('discards momentum from the previous thread and releases its listeners on unmount', () => {
    const view = render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.wheel(viewport, { deltaY: -200 });
    flushOneFrame();
    metrics.scrollHeight = 1_200;
    view.rerender(<ScrollHarness signal="next-thread" threadId="thread-2" />);
    flushFrames();
    expect(viewport.scrollTop).toBe(700);
    fireEvent.wheel(viewport, { deltaY: -100 });
    view.unmount();
    flushFrames();
    expect(viewport.classList.contains('lenis')).toBe(false);
    expect(fireEvent.wheel(viewport, { deltaY: -100 })).toBe(true);
  });

  it.each(['pointercancel', 'blur'] as const)('releases a cancelled scrollbar gesture on %s without resuming follow', (event) => {
    const view = render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    mockScrollbarGutter(viewport);
    flushFrames();
    fireEvent.pointerDown(viewport, { clientX: 895, buttons: 1 });
    if (event === 'pointercancel') fireEvent.pointerCancel(document.body);
    else fireEvent.blur(window);
    metrics.scrollHeight += 100;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(500);
    fireEvent.wheel(viewport, { deltaY: 100 });
    flushFrames();
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(680);

    fireEvent.pointerDown(viewport, { clientX: 895, buttons: 1 });
    metrics.scrollHeight = 1_200;
    view.rerender(<ScrollHarness signal="next-thread" threadId="thread-2" />);
    fireEvent.pointerUp(document.body);
    flushFrames();
    expect(viewport.scrollTop).toBe(700);
  });

  it('returns to native scrolling when reduced motion changes during a gesture', () => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduce = false;
    Object.defineProperty(preference, 'matches', { get: () => reduce });
    vi.spyOn(window, 'matchMedia').mockReturnValue(preference);
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.wheel(viewport, { deltaY: -200 });
    flushOneFrame();
    const readingPosition = viewport.scrollTop;
    act(() => {
      reduce = true;
      preference.dispatchEvent(new Event('change'));
    });
    flushFrames();
    expect(viewport.scrollTop).toBe(readingPosition);
    expect(fireEvent.wheel(viewport, { deltaY: -100 })).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to message' }));
    expect(viewport.scrollTop).toBe(450);
  });

  it('keeps a programmatic message jump detached even inside the bottom threshold', () => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to message' }));
    flushFrames();
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
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    Object.defineProperty(preference, 'matches', { value: true });
    vi.spyOn(window, 'matchMedia').mockReturnValue(preference);
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
    flushFrames();
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(400);

    fireEvent.wheel(viewport, { deltaY: 180 });
    flushFrames();
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(660);

    fireEvent.wheel(viewport, { deltaY: -200 });
    flushFrames();
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
    flushFrames();
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(740);
  });
});

function ScrollHarness({ signal, threadId = 'thread-1' }: { signal: string; threadId?: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const scroll = usePinnedChatScroll({ contentRef, scrollSignal: signal, showEmptyStarter: false, threadId });
  return (
    <>
      <div ref={scroll.scrollRef} data-testid="viewport" onScroll={scroll.handleScroll} onPointerDownCapture={scroll.handleScrollPointerDown} onKeyDownCapture={scroll.handleScrollKeyDown} onWheelCapture={scroll.handleScrollWheel}>
        <div ref={contentRef}><div ref={scroll.listRef}><input /></div></div>
      </div>
      <aside data-testid="overview">Environment information</aside>
      <button onClick={() => scroll.scrollToOffset(450)}>Jump to message</button>
      <button onClick={() => scroll.scrollToOffset(900, 'auto')}>Restore history anchor</button>
      {scroll.showScrollBottom ? <button onClick={() => scroll.scrollToBottom()}>Scroll to bottom</button> : null}
    </>
  );
}

function mockScrollbarGutter(node: HTMLElement) {
  Object.defineProperties(node, {
    offsetWidth: { configurable: true, value: 800 },
    clientWidth: { configurable: true, value: 790 },
  });
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 800, right: 900 } as DOMRect);
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
    if (typeof options === 'object') {
      node.scrollTop = options.top ?? node.scrollTop;
      fireEvent.scroll(node);
    }
  });
  return metrics;
}

function notifyResize() {
  act(() => { for (const notify of resizeCallbacks) notify(); });
}

function flushFrames() {
  act(() => {
    let frameCount = 0;
    while (frames.size) {
      if (++frameCount > 240) throw new Error('Scroll animation did not settle');
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
