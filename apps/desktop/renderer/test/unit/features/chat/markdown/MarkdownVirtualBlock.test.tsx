// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownVirtualBlock } from '../../../../../src/features/chat/markdown/MarkdownVirtualBlock.js';
import { MarkdownViewportProvider } from '../../../../../src/features/chat/markdown/MarkdownViewportProvider.js';

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--app-page-scale-inverse');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Markdown virtual block measurements', () => {
  it.each([0.8, 1, 1.25])('preserves the measured footprint across viewport swaps and resizes at zoom %s', (scale) => {
    let notifyIntersection: (target: Element, visible: boolean) => void;
    let notifyResize: () => void;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        notifyIntersection = (target, isIntersecting) => callback(
          [{ target, isIntersecting } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }
      observe() {}
      disconnect() {}
    });
    document.documentElement.style.setProperty('--app-page-scale-inverse', String(1 / scale));
    const view = render(<BlockHarness />);
    const block = view.container.querySelector<HTMLDivElement>('[data-markdown-block]')!;
    // happy-dom has no layout engine. Supply the border box a browser measures
    // with contained child margins, keeping a fractional height under page zoom.
    let height = 212.375;
    vi.spyOn(block, 'getBoundingClientRect').mockImplementation(() => (
      new DOMRect(0, 0, 600 * scale, height * scale)
    ));
    const getComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = getComputedStyle(element);
      if (element.parentElement === block) {
        // These margins are already included in the supplied border box.
        return Object.assign(style, { marginTop: '24px', marginBottom: '12px' });
      }
      return style;
    });

    for (let swap = 0; swap < 3; swap += 1) {
      act(() => { notifyIntersection(block, true); });
      expect(block.textContent).toContain('A paragraph with spacing.');
      if (swap === 1) {
        height = 286.625;
        act(() => { notifyResize(); });
      }
      act(() => { notifyIntersection(block, false); });
      expect(block.textContent).toBe('');
      expect(Number.parseFloat(block.style.height)).toBeCloseTo(height, 5);
    }
  });
});

function BlockHarness() {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef}>
      <MarkdownViewportProvider scrollRef={scrollRef}>
        <MarkdownVirtualBlock
          content="A paragraph with spacing."
          forceRender={false}
          mutable={false}
          virtualized
        />
      </MarkdownViewportProvider>
    </div>
  );
}
