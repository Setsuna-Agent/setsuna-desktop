import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export const CONVERSATION_DEBUG_CANVAS_MIN_ZOOM = 0.45;
export const CONVERSATION_DEBUG_CANVAS_MAX_ZOOM = 1.8;
const CANVAS_ZOOM_STEP = 0.1;

export type ConversationDebugCanvasMetrics = {
  height: number;
  scrollLeft: number;
  scrollTop: number;
  width: number;
};

type CanvasDrag = {
  pointerId: number;
  scrollLeft: number;
  scrollTop: number;
  startX: number;
  startY: number;
};

type ZoomAnchorInput = {
  currentZoom: number;
  nextZoom: number;
  scrollLeft: number;
  scrollTop: number;
  viewportX: number;
  viewportY: number;
};

type HorizontalAreaScrollInput = {
  areaLeft: number;
  areaWidth: number;
  padding?: number;
  viewportWidth: number;
  zoom: number;
};

type CanvasResetViewInput = {
  areaLeft: number;
  areaWidth: number;
  padding?: number;
};

type WheelHorizontalDeltaInput = {
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  pageSize: number;
};

type HorizontalScrollProgressInput = {
  contentWidth: number;
  minThumbWidth?: number;
  scrollLeft: number;
  viewportWidth: number;
};

export type ConversationDebugHorizontalScrollProgress = {
  left: number;
  visible: boolean;
  width: number;
};

export function clampConversationDebugCanvasZoom(value: number): number {
  return Math.min(
    CONVERSATION_DEBUG_CANVAS_MAX_ZOOM,
    Math.max(CONVERSATION_DEBUG_CANVAS_MIN_ZOOM, value),
  );
}

export function conversationDebugZoomAnchorScroll({
  currentZoom,
  nextZoom,
  scrollLeft,
  scrollTop,
  viewportX,
  viewportY,
}: ZoomAnchorInput): { left: number; top: number } {
  const safeCurrentZoom = Math.max(0.01, currentZoom);
  return {
    left: Math.max(0, ((scrollLeft + viewportX) / safeCurrentZoom) * nextZoom - viewportX),
    top: Math.max(0, ((scrollTop + viewportY) / safeCurrentZoom) * nextZoom - viewportY),
  };
}

export function conversationDebugHorizontalAreaScrollLeft({
  areaLeft,
  areaWidth,
  padding = 24,
  viewportWidth,
  zoom,
}: HorizontalAreaScrollInput): number {
  const safeZoom = Math.max(0.01, zoom);
  const scaledLeft = Math.max(0, areaLeft) * safeZoom;
  const scaledWidth = Math.max(0, areaWidth) * safeZoom;
  const availableWidth = Math.max(0, viewportWidth - padding * 2);
  const target = scaledWidth <= availableWidth
    ? scaledLeft - (viewportWidth - scaledWidth) / 2
    : scaledLeft - padding;
  return Math.max(0, target);
}

export function conversationDebugWheelHorizontalDelta({
  deltaMode,
  deltaX,
  deltaY,
  pageSize,
}: WheelHorizontalDeltaInput): number {
  const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (deltaMode === 1) return dominantDelta * 16;
  if (deltaMode === 2) return dominantDelta * pageSize;
  return dominantDelta;
}

export function conversationDebugHorizontalScrollProgress({
  contentWidth,
  minThumbWidth = 32,
  scrollLeft,
  viewportWidth,
}: HorizontalScrollProgressInput): ConversationDebugHorizontalScrollProgress {
  const safeViewportWidth = Math.max(0, viewportWidth);
  const safeContentWidth = Math.max(safeViewportWidth, contentWidth);
  const maxScrollLeft = safeContentWidth - safeViewportWidth;
  if (safeViewportWidth === 0 || maxScrollLeft <= 1) {
    return {
      left: 0,
      visible: false,
      width: safeViewportWidth,
    };
  }
  const width = Math.min(
    safeViewportWidth,
    Math.max(
      minThumbWidth,
      safeViewportWidth * (safeViewportWidth / safeContentWidth),
    ),
  );
  const progress = Math.min(1, Math.max(0, scrollLeft / maxScrollLeft));
  return {
    left: (safeViewportWidth - width) * progress,
    visible: true,
    width,
  };
}

export function useConversationDebugCanvasNavigation() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<CanvasDrag | null>(null);
  const measureFrameRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);
  const zoomRef = useRef(1);
  const [isPanning, setIsPanning] = useState(false);
  const [metrics, setMetrics] = useState<ConversationDebugCanvasMetrics>({
    height: 0,
    scrollLeft: 0,
    scrollTop: 0,
    width: 0,
  });
  const [zoom, setZoom] = useState(1);

  const measure = useCallback(() => {
    if (measureFrameRef.current !== null) return;
    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const next = {
        height: viewport.clientHeight,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
        width: viewport.clientWidth,
      };
      setMetrics((current) => (
        current.height === next.height
        && current.scrollLeft === next.scrollLeft
        && current.scrollTop === next.scrollTop
        && current.width === next.width
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
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current);
        measureFrameRef.current = null;
      }
    };
  }, [measure]);

  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    const viewport = viewportRef.current;
    if (!pending || !viewport) return;
    pendingScrollRef.current = null;
    viewport.scrollLeft = pending.left;
    viewport.scrollTop = pending.top;
    measure();
  }, [measure, zoom]);

  const setZoomAround = useCallback((
    requestedZoom: number,
    viewportX: number,
    viewportY: number,
  ) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const currentZoom = zoomRef.current;
    const nextZoom = clampConversationDebugCanvasZoom(requestedZoom);
    if (nextZoom === currentZoom) return;
    const currentScroll = pendingScrollRef.current ?? {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    pendingScrollRef.current = conversationDebugZoomAnchorScroll({
      currentZoom,
      nextZoom,
      scrollLeft: currentScroll.left,
      scrollTop: currentScroll.top,
      viewportX,
      viewportY,
    });
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setZoomAround(
      zoomRef.current + delta,
      viewport.clientWidth / 2,
      viewport.clientHeight / 2,
    );
  }, [setZoomAround]);

  const resetView = useCallback((target?: CanvasResetViewInput) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    pendingScrollRef.current = {
      left: target
        ? conversationDebugHorizontalAreaScrollLeft({
            areaLeft: target.areaLeft,
            areaWidth: target.areaWidth,
            padding: target.padding,
            viewportWidth: viewport.clientWidth,
            zoom: 1,
          })
        : 0,
      top: 0,
    };
    if (zoomRef.current === 1) {
      const pending = pendingScrollRef.current;
      pendingScrollRef.current = null;
      viewport.scrollLeft = pending.left;
      viewport.scrollTop = pending.top;
      measure();
      return;
    }
    zoomRef.current = 1;
    setZoom(1);
  }, [measure]);

  const navigateToHorizontalArea = useCallback((
    areaLeft: number,
    areaWidth: number,
    padding?: number,
  ) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      behavior: 'smooth',
      left: conversationDebugHorizontalAreaScrollLeft({
        areaLeft,
        areaWidth,
        padding,
        viewportWidth: viewport.clientWidth,
        zoom: zoomRef.current,
      }),
      top: viewport.scrollTop,
    });
  }, []);

  const handleWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    viewport.scrollLeft += conversationDebugWheelHorizontalDelta({
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      pageSize: viewport.clientWidth,
    });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    // Keep wheel gestures on the graph's horizontal timeline instead of
    // allowing the scroll container to consume them as vertical movement.
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isCanvasInteractiveTarget(event.target)) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      startX: event.clientX,
      startY: event.clientY,
    };
    setIsPanning(true);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX);
    viewport.scrollTop = drag.scrollTop - (event.clientY - drag.startY);
  }, []);

  const endPointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);
  const zoomIn = useCallback(() => zoomBy(CANVAS_ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(-CANVAS_ZOOM_STEP), [zoomBy]);

  return {
    canZoomIn: zoom < CONVERSATION_DEBUG_CANVAS_MAX_ZOOM,
    canZoomOut: zoom > CONVERSATION_DEBUG_CANVAS_MIN_ZOOM,
    handleLostPointerCapture: endPointerDrag,
    handlePointerCancel: endPointerDrag,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: endPointerDrag,
    isPanning,
    metrics,
    navigateToHorizontalArea,
    resetView,
    viewportRef,
    zoom,
    zoomIn,
    zoomOut,
  };
}

function isCanvasInteractiveTarget(target: EventTarget): boolean {
  return target instanceof Element
    && Boolean(target.closest('button, a, input, select, textarea, [role="button"]'));
}
