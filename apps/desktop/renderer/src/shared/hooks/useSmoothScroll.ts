import Lenis from 'lenis';
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/** Contained Lenis scrolling, as used by beUI's Scroll Animation component. */
export function useSmoothScroll({
  scrollRef,
  contentRef,
  enabled,
  resetKey,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  resetKey: string | null;
}) {
  const controllerRef = useRef<{ lenis: Lenis; requestFrame: () => void; cancelFrame: () => void } | null>(null);

  useLayoutEffect(() => {
    const wrapper = scrollRef.current;
    const content = contentRef.current;
    if (!enabled || !wrapper || !content) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const destroy = () => {
      controllerRef.current?.cancelFrame();
      controllerRef.current?.lenis.destroy();
      controllerRef.current = null;
    };
    const syncPreference = () => {
      destroy();
      if (reducedMotion.matches) return;
      const lenis = new Lenis({
        wrapper,
        content,
        lerp: 0.1,
        smoothWheel: true,
        syncTouch: false,
        allowNestedScroll: true,
        // Streaming changes the limit before ResizeObserver's debounced measurement.
        naiveDimensions: true,
        autoResize: false,
      });
      let frame: number | null = null;
      const tick = (time: number) => {
        frame = null;
        lenis.raf(time);
        if (lenis.isScrolling === 'smooth') frame = window.requestAnimationFrame(tick);
      };
      const requestFrame = () => {
        if (frame !== null) return;
        // Seed the clock after idle so the first frame cannot consume the whole glide.
        lenis.raf(performance.now());
        frame = window.requestAnimationFrame(tick);
      };
      const cancelFrame = () => {
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
      };
      // Keep the desktop idle between gestures instead of running a permanent RAF loop.
      lenis.on('virtual-scroll', requestFrame);
      controllerRef.current = { lenis, requestFrame, cancelFrame };
    };
    syncPreference();
    reducedMotion.addEventListener('change', syncPreference);
    return () => {
      reducedMotion.removeEventListener('change', syncPreference);
      destroy();
    };
  }, [contentRef, enabled, resetKey, scrollRef]);

  const cancelSmoothScroll = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.cancelFrame();
    // Stop/start cancels momentum and rebases Lenis onto the native position.
    controller.lenis.stop();
    controller.lenis.start();
  }, []);

  const setScrollPosition = useCallback((top: number, behavior: ScrollBehavior = 'smooth') => {
    const node = scrollRef.current;
    if (!node) return;
    const controller = controllerRef.current;
    if (behavior !== 'smooth' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cancelSmoothScroll();
      node.scrollTop = top;
      controller?.lenis.resize();
    } else if (controller) {
      controller.requestFrame();
      controller.lenis.scrollTo(top);
    } else {
      node.scrollTo({ top, behavior });
    }
  }, [cancelSmoothScroll, scrollRef]);

  return { cancelSmoothScroll, setScrollPosition };
}
