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
    expect(fireEvent.wheel(viewport, { deltaY: -2 })).toBe(true);
    if (notifyBeforeScroll) {
      notifyResize();
      fireEvent.scroll(viewport);
      view.rerender(<ScrollHarness signal="layout-before-wheel" />);
    }
    viewport.scrollTop -= 2;
    fireEvent.scroll(viewport);
    flushFrames();
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();

    expect(viewport.scrollTop).toBe(498);
  });

  it('follows the latest streaming height while an update is already pending', () => {
    const view = render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    metrics.scrollHeight += 200;
    notifyResize();
    flushOneFrame();
    metrics.scrollHeight += 100;
    view.rerender(<ScrollHarness signal="more-text" />);
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(800);
  });

  it('lets native wheel input interrupt message navigation and keeps streaming detached', () => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to message' }));
    flushOneFrame();
    const readingPosition = viewport.scrollTop;
    scrollWithWheel(viewport, -120);
    scrollWithWheel(viewport, -80);
    metrics.scrollHeight += 200;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(readingPosition - 200);
    expect(screen.getByRole('button', { name: 'Scroll to bottom' })).toBeTruthy();
  });

  it('cancels pending navigation when restoring a prepended history anchor', () => {
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to message' }));
    flushOneFrame();
    metrics.scrollHeight += 500;
    fireEvent.click(screen.getByRole('button', { name: 'Restore history anchor' }));
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(900);
    scrollWithWheel(viewport, -100);
    flushFrames();
    expect(viewport.scrollTop).toBe(800);
  });

  it.each([1, 0.8])('lets scrollbar dragging interrupt navigation and restore follow at the bottom at scale %s', (scale) => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Jump to message' }));
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
    scrollWithWheel(viewport, -20);
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

  it('discards pending navigation when switching threads or unmounting', () => {
    const view = render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    const metrics = mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to message' }));
    flushOneFrame();
    metrics.scrollHeight = 1_200;
    view.rerender(<ScrollHarness signal="next-thread" threadId="thread-2" />);
    flushFrames();
    expect(viewport.scrollTop).toBe(700);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to message' }));
    view.unmount();
    flushFrames();
    expect(viewport.scrollTop).toBe(700);
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
    scrollWithWheel(viewport, 100);
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

  it('cancels pending navigation when reduced motion changes', () => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduce = false;
    Object.defineProperty(preference, 'matches', { get: () => reduce });
    vi.spyOn(window, 'matchMedia').mockReturnValue(preference);
    render(<ScrollHarness signal="initial" />);
    const viewport = screen.getByTestId('viewport');
    mockScrollMetrics(viewport);
    flushFrames();
    fireEvent.click(screen.getByRole('button', { name: 'Jump to message' }));
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

    scrollWithWheel(viewport, -100);
    flushFrames();
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(400);

    scrollWithWheel(viewport, 180);
    flushFrames();
    metrics.scrollHeight += 80;
    notifyResize();
    flushFrames();
    expect(viewport.scrollTop).toBe(660);

    scrollWithWheel(viewport, -200);
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

function scrollWithWheel(node: HTMLElement, deltaY: number) {
  expect(fireEvent.wheel(node, { deltaY })).toBe(true);
  // happy-dom does not perform the browser's default wheel scrolling.
  node.scrollTop += deltaY;
  fireEvent.scroll(node);
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
