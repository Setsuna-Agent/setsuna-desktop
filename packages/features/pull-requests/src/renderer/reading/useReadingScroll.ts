import { useCallback, useLayoutEffect, useRef, type UIEvent } from 'react';
import type { PullRequestScrollPosition } from '../session.js';

/** Restore after async content grows; stop immediately when the reader takes over scrolling. */
export function useReadingScroll(
  positions: Map<string, PullRequestScrollPosition>, key: string, ready = true, active = true,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoring = useRef(false);
  const cancel = useRef<() => void>(() => undefined);
  const cancelRestore = useCallback(() => cancel.current(), []);

  useLayoutEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !ready || !active) return;
    const target = positions.get(key) ?? { top: 0, left: 0 };
    const inputEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    const stop = () => {
      restoring.current = false;
      observer.disconnect();
      for (const event of inputEvents) viewport.removeEventListener(event, stop);
    };
    const restore = () => {
      viewport.scrollTop = target.top;
      viewport.scrollLeft = target.left;
      if (Math.abs(viewport.scrollTop - target.top) < 1 && Math.abs(viewport.scrollLeft - target.left) < 1) stop();
    };
    const observer = new ResizeObserver(restore);
    restoring.current = true;
    cancel.current = stop;
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    for (const event of inputEvents) viewport.addEventListener(event, stop, { passive: true });
    restore();
    return stop;
  }, [positions, key, ready, active]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!restoring.current && ready && active) {
      positions.set(key, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
    }
  }, [positions, key, ready, active]);
  return { scrollRef, onScroll, cancelRestore };
}
