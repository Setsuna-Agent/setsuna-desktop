// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScrollOverlay } from '../../../../src/shared/ui/ScrollOverlay.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('tracks native scroll and content resizing, supports dragging, and disappears when content fits', () => {
  const resizeCallbacks = new Set<() => void>();
  vi.stubGlobal('ResizeObserver', class {
    private readonly notify: () => void;
    constructor(callback: () => void) { this.notify = callback; resizeCallbacks.add(callback); }
    observe() {}
    disconnect() { resizeCallbacks.delete(this.notify); }
  });
  const dimensions = { height: 200, scrollHeight: 800 };
  function Surface() {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    return <div>
      <div ref={(node) => {
        scrollRef.current = node;
        if (!node) return;
        Object.defineProperties(node, {
          clientHeight: { configurable: true, get: () => dimensions.height },
          scrollHeight: { configurable: true, get: () => dimensions.scrollHeight },
        });
      }} data-testid="viewport"><div /></div>
      <ScrollOverlay scrollRef={scrollRef} />
    </div>;
  }
  const view = render(<Surface />);
  const viewport = view.getByTestId('viewport');
  const thumb = view.container.querySelector<HTMLDivElement>('.sd-scrollbar-overlay__thumb')!;
  expect(thumb.style.height).toBe('50px');
  expect(viewport.contains(thumb)).toBe(false);
  viewport.scrollTop = 300;
  fireEvent.scroll(viewport);
  expect(thumb.style.transform).toBe('translateY(75px)');

  Object.assign(thumb, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  fireEvent.pointerDown(thumb, { pointerId: 1, clientY: 100 });
  fireEvent.pointerMove(thumb, { pointerId: 1, clientY: 125 });
  expect(viewport.scrollTop).toBe(400);
  fireEvent.pointerUp(thumb, { pointerId: 1 });
  fireEvent.pointerMove(thumb, { pointerId: 1, clientY: 150 });
  expect(viewport.scrollTop).toBe(400);

  dimensions.height = 100;
  dimensions.scrollHeight = 400;
  viewport.scrollTop = 100;
  act(() => { resizeCallbacks.forEach((notify) => notify()); });
  expect(thumb.style.height).toBe('36px');
  expect(thumb.style.transform).toBe('translateY(21px)');
  dimensions.scrollHeight = 80;
  act(() => { resizeCallbacks.forEach((notify) => notify()); });
  expect(view.container.querySelector('.sd-scrollbar-overlay')).toBeNull();
  view.unmount();
  expect(resizeCallbacks.size).toBe(0);
});
