import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

/** A draggable scrollbar over a native scroll viewport, without reserving layout width. */
export function ScrollOverlay({ disabled = false, scrollRef, scrollSignal = '' }: { disabled?: boolean; scrollRef: RefObject<HTMLDivElement | null>; scrollSignal?: string }) {
  const dragRef = useRef<{
    scrollRange: number;
    startScrollTop: number;
    startY: number;
    thumbRange: number;
  } | null>(null);
  const [metrics, setMetrics] = useState({
    height: 0,
    thumbHeight: 0,
    thumbTop: 0,
    top: 0,
    visible: false,
  });
  const updateMetrics = useCallback(() => {
    const node = scrollRef.current;
    if (!node || disabled) {
      setMetrics((current) => (current.visible ? { height: 0, thumbHeight: 0, thumbTop: 0, top: 0, visible: false } : current));
      return;
    }
    const height = node.clientHeight;
    const scrollHeight = node.scrollHeight;
    const visible = height > 0 && scrollHeight > height + 1;
    const thumbHeight = visible ? Math.min(height, Math.max(36, Math.round((height / scrollHeight) * height))) : 0;
    const thumbRange = Math.max(0, height - thumbHeight);
    const scrollRange = Math.max(0, scrollHeight - height);
    const thumbTop = scrollRange > 0 ? Math.round((node.scrollTop / scrollRange) * thumbRange) : 0;
    const next = {
      height,
      thumbHeight,
      thumbTop,
      top: node.offsetTop,
      visible,
    };
    setMetrics((current) => (current.height === next.height && current.thumbHeight === next.thumbHeight && current.thumbTop === next.thumbTop && current.top === next.top && current.visible === next.visible ? current : next));
  }, [disabled, scrollRef]);

  useLayoutEffect(() => {
    updateMetrics();
    const node = scrollRef.current;
    if (!node || disabled) return undefined;
    node.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMetrics);
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      observer?.disconnect();
    };
  }, [disabled, scrollRef, scrollSignal, updateMetrics]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = scrollRef.current;
      if (!node || !metrics.visible) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        scrollRange: Math.max(0, node.scrollHeight - node.clientHeight),
        startScrollTop: node.scrollTop,
        startY: event.clientY,
        thumbRange: Math.max(1, metrics.height - metrics.thumbHeight),
      };
    },
    [metrics.height, metrics.thumbHeight, metrics.visible, scrollRef],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = scrollRef.current;
      const drag = dragRef.current;
      if (!node || !drag) return;
      const delta = event.clientY - drag.startY;
      node.scrollTop = drag.startScrollTop + (delta / drag.thumbRange) * drag.scrollRange;
    },
    [scrollRef],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  if (!metrics.visible) return null;

  return (
    <div className="sd-scrollbar-overlay" aria-hidden="true" style={{ height: metrics.height, top: metrics.top }}>
      <div className="sd-scrollbar-overlay__thumb" style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }} onPointerCancel={handlePointerUp} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
    </div>
  );
}
