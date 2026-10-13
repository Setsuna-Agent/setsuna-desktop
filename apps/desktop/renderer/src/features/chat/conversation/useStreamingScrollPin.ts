import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
  type RefObject,
} from 'react';
import { useStreamingScrollPinController } from './StreamingScrollPinProvider.js';

// scrollTop can be fractional while scrollHeight/clientHeight are rounded.
const streamingScrollBottomTolerancePx = 1;

type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

export type StreamingScrollPinAction =
  | { type: 'user-scroll-up' }
  | { type: 'scroll-position'; distanceToBottom: number };

export function scrollDistanceToBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

export function nextStreamingScrollPinned(current: boolean, action: StreamingScrollPinAction): boolean {
  if (action.type === 'user-scroll-up') return false;
  return current || action.distanceToBottom <= streamingScrollBottomTolerancePx;
}

/**
 * 在用户主动控制滚动前，始终让流式溢出面板停留在底部。
 * 完全滚回底部后会重新启用自动跟随。
 */
export function useStreamingScrollPin(updateSignal: string, stateKey: string, initiallyPinned = true): {
  contentRef: RefObject<HTMLDivElement>;
  handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleScroll: (event: ReactUIEvent<HTMLDivElement>) => void;
  handleTouchMove: (event: ReactTouchEvent<HTMLDivElement>) => void;
  handleWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  scrollRef: RefObject<HTMLDivElement>;
} {
  const persistedPin = useStreamingScrollPinController();
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(initiallyPinned && persistedPin.getPinned(stateKey));
  const stateKeyRef = useRef(stateKey);
  const lastScrollTopRef = useRef(0);
  const scrollbarDragRef = useRef(false);
  const scheduledFrameRef = useRef<number | null>(null);
  const scheduleTokenRef = useRef(0);

  const setPinned = useCallback((pinned: boolean) => {
    pinnedRef.current = pinned;
    persistedPin.setPinned(stateKey, pinned);
  }, [persistedPin, stateKey]);

  const cancelScheduledScroll = useCallback(() => {
    scheduleTokenRef.current += 1;
    if (scheduledFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(scheduledFrameRef.current);
    }
    scheduledFrameRef.current = null;
  }, []);

  const releaseForUser = useCallback(() => {
    setPinned(nextStreamingScrollPinned(pinnedRef.current, { type: 'user-scroll-up' }));
    lastScrollTopRef.current = scrollRef.current?.scrollTop ?? 0;
    cancelScheduledScroll();
  }, [cancelScheduledScroll, setPinned]);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node || !pinnedRef.current) return;
    node.scrollTop = node.scrollHeight;
    lastScrollTopRef.current = node.scrollTop;
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    if (!pinnedRef.current) return;
    scrollToBottom();
    if (typeof window === 'undefined') return;

    const token = scheduleTokenRef.current + 1;
    scheduleTokenRef.current = token;
    if (scheduledFrameRef.current !== null) window.cancelAnimationFrame(scheduledFrameRef.current);
    scheduledFrameRef.current = window.requestAnimationFrame(() => {
      scheduledFrameRef.current = null;
      if (token !== scheduleTokenRef.current || !pinnedRef.current) return;
      scrollToBottom();
    });
  }, [scrollToBottom]);

  const handleScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    const movingTowardBottom = node.scrollTop > lastScrollTopRef.current;
    lastScrollTopRef.current = node.scrollTop;
    if (scrollbarDragRef.current) return;
    // Content growth and browser anchoring also emit scroll. Only a user gesture
    // releases follow; an upward move must not reattach within the rounding tolerance.
    if (!pinnedRef.current && movingTowardBottom) {
      setPinned(nextStreamingScrollPinned(false, {
        type: 'scroll-position',
        distanceToBottom: scrollDistanceToBottom(node),
      }));
    }
    if (pinnedRef.current) scheduleScrollToBottom();
  }, [scheduleScrollToBottom, setPinned]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && event.deltaY < 0) releaseForUser();
  }, [releaseForUser]);

  const handleTouchMove = useCallback((_event: ReactTouchEvent<HTMLDivElement>) => {
    releaseForUser();
  }, [releaseForUser]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (event.target !== node || event.button !== 0 || node.scrollHeight <= node.clientHeight) return;
    const bounds = node.getBoundingClientRect();
    const scale = node.offsetWidth > 0 ? bounds.width / node.offsetWidth : 1;
    const contentRight = bounds.left + (node.clientLeft + node.clientWidth) * scale;
    if (event.clientX < contentRight || event.clientX >= bounds.right) return;
    scrollbarDragRef.current = true;
    releaseForUser();
  }, [releaseForUser]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
      releaseForUser();
    }
  }, [releaseForUser]);

  useLayoutEffect(() => {
    // Completion keeps the same viewport and reading position; only a new
    // thinking record uses initiallyPinned to choose its starting behavior.
    if (stateKeyRef.current === stateKey) return;
    cancelScheduledScroll();
    stateKeyRef.current = stateKey;
    scrollbarDragRef.current = false;
    pinnedRef.current = initiallyPinned && persistedPin.getPinned(stateKey);
    lastScrollTopRef.current = scrollRef.current?.scrollTop ?? 0;
  }, [cancelScheduledScroll, initiallyPinned, persistedPin, stateKey]);

  useLayoutEffect(() => {
    if (pinnedRef.current) scheduleScrollToBottom();
  }, [scheduleScrollToBottom, stateKey, updateSignal]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    const content = contentRef.current;
    if (!node || !content || typeof ResizeObserver === 'undefined') return;
    // Smoothed Markdown and async code/images change height after the source
    // update. Observe the content too: the capped viewport may not resize at all.
    const observer = new ResizeObserver(scheduleScrollToBottom);
    observer.observe(node);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scheduleScrollToBottom]);

  useEffect(() => {
    const finishDrag = (event: Event) => {
      if (!scrollbarDragRef.current) return;
      scrollbarDragRef.current = false;
      const node = scrollRef.current;
      if (!node || event.type !== 'pointerup') return;
      setPinned(nextStreamingScrollPinned(false, {
        type: 'scroll-position', distanceToBottom: scrollDistanceToBottom(node),
      }));
      if (pinnedRef.current) scheduleScrollToBottom();
    };
    window.addEventListener('pointerup', finishDrag, true);
    window.addEventListener('pointercancel', finishDrag, true);
    window.addEventListener('blur', finishDrag);
    return () => {
      window.removeEventListener('pointerup', finishDrag, true);
      window.removeEventListener('pointercancel', finishDrag, true);
      window.removeEventListener('blur', finishDrag);
    };
  }, [scheduleScrollToBottom, setPinned]);

  useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  return {
    contentRef,
    handleKeyDown,
    handlePointerDown,
    handleScroll,
    handleTouchMove,
    handleWheel,
    scrollRef,
  };
}
