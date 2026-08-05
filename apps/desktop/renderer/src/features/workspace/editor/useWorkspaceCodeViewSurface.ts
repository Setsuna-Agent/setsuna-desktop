import type { CodeViewLayout } from '@pierre/diffs/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';

const WORKSPACE_CODE_VIEW_HEIGHT_PROPERTY = '--setsuna-workspace-code-view-height';
const PIERRE_CODE_SCROLLER_SELECTOR = '[data-code]';

export const workspaceCodeViewLayout = {
  gap: 0,
  paddingBottom: 0,
  paddingTop: 0,
} satisfies CodeViewLayout;

export const workspaceCodeViewUnsafeCSS = `
  :host,
  [data-file],
  [data-code] {
    min-height: var(${WORKSPACE_CODE_VIEW_HEIGHT_PROPERTY}, 0px);
  }

  [data-code] {
    align-content: start;
    padding: 0 0 var(--chat-scrollbar-width, 8px);
    scrollbar-width: none;
  }

  [data-code]::-webkit-scrollbar {
    display: none;
  }
`;

export type WorkspaceCodeViewSurface = {
  codeViewContainerRef: (container: HTMLDivElement | null) => void;
  horizontalScrollbarRef: RefObject<HTMLDivElement>;
  horizontalScrollbarTrackRef: RefObject<HTMLDivElement>;
};

/**
 * Pierre virtualizes against its own scroll root, while a short single-file
 * item otherwise keeps its content height. Expose the viewport's measured
 * height to the item's shadow root so short files fill the panel and long
 * files can continue growing and virtualizing normally. Pierre's horizontal
 * scroller lives at the end of that virtualized file, so mirror it to a
 * viewport-pinned scrollbar without changing the library's scroll model.
 */
export function useWorkspaceCodeViewSurface(): WorkspaceCodeViewSurface {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const horizontalScrollbarRef = useRef<HTMLDivElement>(null);
  const horizontalScrollbarTrackRef = useRef<HTMLDivElement>(null);
  const codeViewContainerRef = useCallback((nextContainer: HTMLDivElement | null) => {
    setContainer(nextContainer);
  }, []);

  useEffect(() => {
    const scrollbar = horizontalScrollbarRef.current;
    const scrollbarTrack = horizontalScrollbarTrackRef.current;
    if (!container || !scrollbar || !scrollbarTrack) return undefined;

    let animationFrame: number | undefined;
    let codeScroller: HTMLElement | null = null;
    let observedShadowRoot: ShadowRoot | null = null;
    let codeResizeObserver: ResizeObserver | undefined;
    let shadowObserver: MutationObserver | undefined;

    const syncContainerHeight = () => {
      const nextHeight = `${container.clientHeight}px`;
      if (container.style.getPropertyValue(WORKSPACE_CODE_VIEW_HEIGHT_PROPERTY) === nextHeight) return;
      container.style.setProperty(WORKSPACE_CODE_VIEW_HEIGHT_PROPERTY, nextHeight);
    };

    const syncScrollbarMetrics = () => {
      animationFrame = undefined;
      if (!codeScroller) {
        scrollbar.removeAttribute('data-visible');
        scrollbarTrack.style.width = '0px';
        return;
      }

      const horizontalRange = Math.max(codeScroller.scrollWidth - codeScroller.clientWidth, 0);
      if (horizontalRange <= 1) {
        scrollbar.removeAttribute('data-visible');
        scrollbarTrack.style.width = '0px';
        scrollbar.scrollLeft = 0;
        return;
      }

      scrollbar.setAttribute('data-visible', 'true');
      scrollbarTrack.style.width = `${scrollbar.clientWidth + horizontalRange}px`;
      if (Math.abs(scrollbar.scrollLeft - codeScroller.scrollLeft) > 0.5) {
        scrollbar.scrollLeft = codeScroller.scrollLeft;
      }
    };

    const scheduleScrollbarSync = () => {
      if (animationFrame !== undefined) return;
      animationFrame = window.requestAnimationFrame(syncScrollbarMetrics);
    };

    const handleScrollbarScroll = () => {
      if (!codeScroller || Math.abs(codeScroller.scrollLeft - scrollbar.scrollLeft) <= 0.5) return;
      codeScroller.scrollLeft = scrollbar.scrollLeft;
    };

    const handleCodeScroll = () => {
      if (!codeScroller || Math.abs(scrollbar.scrollLeft - codeScroller.scrollLeft) <= 0.5) return;
      scrollbar.scrollLeft = codeScroller.scrollLeft;
    };

    const bindCodeScroller = () => {
      const pierreHost = container.querySelector<HTMLElement>('diffs-container');
      const nextShadowRoot = pierreHost?.shadowRoot ?? null;

      if (nextShadowRoot !== observedShadowRoot) {
        shadowObserver?.disconnect();
        observedShadowRoot = nextShadowRoot;
        if (observedShadowRoot && typeof MutationObserver !== 'undefined') {
          shadowObserver = new MutationObserver(bindCodeScroller);
          shadowObserver.observe(observedShadowRoot, {
            attributes: true,
            attributeFilter: ['style'],
            childList: true,
            characterData: true,
            subtree: true,
          });
        }
      }

      const nextCodeScroller = observedShadowRoot
        ?.querySelector<HTMLElement>(PIERRE_CODE_SCROLLER_SELECTOR) ?? null;
      if (nextCodeScroller === codeScroller) {
        scheduleScrollbarSync();
        return;
      }

      codeScroller?.removeEventListener('scroll', handleCodeScroll);
      codeResizeObserver?.disconnect();
      codeResizeObserver = undefined;
      codeScroller = nextCodeScroller;

      if (codeScroller) {
        codeScroller.addEventListener('scroll', handleCodeScroll, { passive: true });
        if (typeof ResizeObserver !== 'undefined') {
          codeResizeObserver = new ResizeObserver(scheduleScrollbarSync);
          codeResizeObserver.observe(codeScroller);
        }
      }
      scheduleScrollbarSync();
    };

    scrollbar.addEventListener('scroll', handleScrollbarScroll, { passive: true });
    syncContainerHeight();
    bindCodeScroller();

    const containerObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
        syncContainerHeight();
        scheduleScrollbarSync();
      });
    containerObserver?.observe(container);

    const pierreObserver = typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(bindCodeScroller);
    pierreObserver?.observe(container, { childList: true, subtree: true });

    return () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      scrollbar.removeEventListener('scroll', handleScrollbarScroll);
      codeScroller?.removeEventListener('scroll', handleCodeScroll);
      codeResizeObserver?.disconnect();
      shadowObserver?.disconnect();
      pierreObserver?.disconnect();
      containerObserver?.disconnect();
    };
  }, [container]);

  return useMemo(() => ({
    codeViewContainerRef,
    horizontalScrollbarRef,
    horizontalScrollbarTrackRef,
  }), [codeViewContainerRef]);
}
