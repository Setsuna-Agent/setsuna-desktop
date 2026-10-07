import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

const DEFAULT_WIDTH = 400;
const MIN_PANEL_WIDTH = 280;
const MIN_PAGE_WIDTH = 320;

type PanelResizeDrag = {
  handle: HTMLButtonElement;
  pointerId: number;
  startX: number;
  startWidth: number;
  scaleInverse: number;
};

export function useBrowserExtensionPanelResize(active: boolean, contentRef: RefObject<HTMLDivElement | null>) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<PanelResizeDrag | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_WIDTH);
  const [availableWidth, setAvailableWidth] = useState(DEFAULT_WIDTH * 2);
  const [resizing, setResizing] = useState(false);
  const maxWidth = Math.floor(availableWidth - Math.min(MIN_PAGE_WIDTH, availableWidth / 2));
  const minWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
  const clampWidth = (value: number) => Math.round(Math.max(minWidth, Math.min(maxWidth, value)));
  const width = clampWidth(preferredWidth);

  const finishResize = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    document.body.classList.remove('browser-extension-panel-resizing');
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    setResizing(false);
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const content = contentRef.current;
    const container = content?.parentElement;
    if (!active || !panel || !content || !container) return;

    const measure = () => {
      // Only the page and this panel share the space; pinned records keep their own width.
      const available = Math.min(container.clientWidth, content.offsetWidth + panel.offsetWidth);
      if (available > 0) setAvailableWidth(available);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    return () => {
      observer.disconnect();
      finishResize();
    };
  }, [active, contentRef, finishResize]);

  useEffect(() => {
    if (!resizing) return;
    window.addEventListener('blur', finishResize);
    return () => window.removeEventListener('blur', finishResize);
  }, [finishResize, resizing]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    const panel = panelRef.current;
    if (event.button !== 0 || !panel || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      handle: event.currentTarget,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      scaleInverse: panel.offsetWidth / panel.getBoundingClientRect().width,
    };
    // Native webviews must not take pointer events while the divider crosses them.
    document.body.classList.add('browser-extension-panel-resizing');
    setResizing(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPreferredWidth(clampWidth(drag.startWidth + (drag.startX - event.clientX) * drag.scaleInverse));
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    onPointerMove(event);
    finishResize();
  };

  const onPointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) finishResize();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextWidth: number;
    if (event.key === 'ArrowLeft') nextWidth = width + 16;
    else if (event.key === 'ArrowRight') nextWidth = width - 16;
    else if (event.key === 'Home') nextWidth = minWidth;
    else if (event.key === 'End') nextWidth = maxWidth;
    else return;
    event.preventDefault();
    setPreferredWidth(clampWidth(nextWidth));
  };

  return {
    panelRef, width, minWidth, maxWidth, resizing,
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel, onKeyDown },
  };
}
