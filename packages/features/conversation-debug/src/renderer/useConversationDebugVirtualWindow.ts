import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';

export type FixedVirtualWindow = {
  endIndex: number;
  startIndex: number;
  totalSize: number;
};

type FixedVirtualWindowInput = {
  itemCount: number;
  itemSize: number;
  overscan?: number;
  paddingEnd?: number;
  paddingStart?: number;
  scrollOffset: number;
  viewportSize: number;
};

type VirtualViewportMetrics = {
  scrollOffset: number;
  viewportSize: number;
};

export function calculateFixedVirtualWindow({
  itemCount,
  itemSize,
  overscan = 5,
  paddingEnd = 0,
  paddingStart = 0,
  scrollOffset,
  viewportSize,
}: FixedVirtualWindowInput): FixedVirtualWindow {
  const count = Math.max(0, Math.floor(itemCount));
  const size = Math.max(1, itemSize);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const safePaddingStart = Math.max(0, paddingStart);
  const totalSize = safePaddingStart + count * size + Math.max(0, paddingEnd);
  if (!count) return { endIndex: 0, startIndex: 0, totalSize };

  const contentOffset = Math.max(0, scrollOffset - safePaddingStart);
  const firstVisible = Math.min(count - 1, Math.floor(contentOffset / size));
  const visibleEndOffset = Math.max(
    contentOffset + size,
    Math.max(0, scrollOffset) + Math.max(0, viewportSize) - safePaddingStart,
  );
  const lastVisibleExclusive = Math.min(
    count,
    Math.max(firstVisible + 1, Math.ceil(visibleEndOffset / size)),
  );
  return {
    endIndex: Math.min(count, lastVisibleExclusive + safeOverscan),
    startIndex: Math.max(0, firstVisible - safeOverscan),
    totalSize,
  };
}

export function useConversationDebugVirtualWindow({
  itemCount,
  itemSize,
  overscan,
  paddingEnd,
  paddingStart,
}: Omit<FixedVirtualWindowInput, 'scrollOffset' | 'viewportSize'>): FixedVirtualWindow & {
  viewportRef: RefObject<HTMLDivElement>;
} {
  const viewportRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState<VirtualViewportMetrics>({
    scrollOffset: 0,
    viewportSize: 0,
  });

  const measure = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const next = {
        scrollOffset: viewport.scrollTop,
        viewportSize: viewport.clientHeight,
      };
      setMetrics((current) => (
        current.scrollOffset === next.scrollOffset
        && current.viewportSize === next.viewportSize
          ? current
          : next
      ));
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    viewport.addEventListener('scroll', measure, { passive: true });
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measure);
    resizeObserver?.observe(viewport);
    measure();
    return () => {
      viewport.removeEventListener('scroll', measure);
      resizeObserver?.disconnect();
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [measure]);

  const virtualWindow = useMemo(
    () => calculateFixedVirtualWindow({
      itemCount,
      itemSize,
      overscan,
      paddingEnd,
      paddingStart,
      scrollOffset: metrics.scrollOffset,
      viewportSize: metrics.viewportSize,
    }),
    [
      itemCount,
      itemSize,
      metrics.scrollOffset,
      metrics.viewportSize,
      overscan,
      paddingEnd,
      paddingStart,
    ],
  );
  return { ...virtualWindow, viewportRef };
}
