import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useStreamingScrollPinController } from './StreamingScrollPinProvider.js';

const streamingScrollBottomTolerancePx = 0;

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

export function nextStreamingScrollPinned(_current: boolean, action: StreamingScrollPinAction): boolean {
  if (action.type === 'user-scroll-up') return false;
  return action.distanceToBottom <= streamingScrollBottomTolerancePx;
}

/**
 * 在用户主动控制滚动前，始终让流式溢出面板停留在底部。
 * 完全滚回底部后会重新启用自动跟随。
 */
export function useStreamingScrollPin(updateSignal: string, stateKey: string): {
  handlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleScroll: (event: ReactUIEvent<HTMLDivElement>) => void;
  handleTouchMove: (event: ReactTouchEvent<HTMLDivElement>) => void;
  handleWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  scrollRef: RefObject<HTMLDivElement>;
} {
  const persistedPin = useStreamingScrollPinController();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(persistedPin.getPinned(stateKey));
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
    cancelScheduledScroll();
  }, [cancelScheduledScroll, setPinned]);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node || !pinnedRef.current) return;
    node.scrollTop = node.scrollHeight;
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
    setPinned(nextStreamingScrollPinned(pinnedRef.current, {
      type: 'scroll-position',
      distanceToBottom: scrollDistanceToBottom(event.currentTarget),
    }));
  }, [setPinned]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) releaseForUser();
  }, [releaseForUser]);

  const handleTouchMove = useCallback((_event: ReactTouchEvent<HTMLDivElement>) => {
    releaseForUser();
  }, [releaseForUser]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (node.scrollHeight <= node.clientHeight) return;
    const scrollbarHitWidth = Math.max(12, node.offsetWidth - node.clientWidth);
    if (event.clientX >= node.getBoundingClientRect().right - scrollbarHitWidth) releaseForUser();
  }, [releaseForUser]);

  useLayoutEffect(() => {
    pinnedRef.current = persistedPin.getPinned(stateKey);
  }, [persistedPin, stateKey]);

  useLayoutEffect(() => {
    if (pinnedRef.current) scheduleScrollToBottom();
  }, [scheduleScrollToBottom, updateSignal]);

  useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  return {
    handlePointerDown,
    handleScroll,
    handleTouchMove,
    handleWheel,
    scrollRef,
  };
}
