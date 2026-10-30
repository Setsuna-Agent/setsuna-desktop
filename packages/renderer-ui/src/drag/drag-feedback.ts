// Adapted from beUI's Sortable List (MIT): https://beui.dev/components/motion/sortable-stack
import { animate, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { SPRING_LAYOUT } from '../motion.js';

/** Keep native drag payloads/cross-window drops while giving the drag image a shared raised surface. */
export function useNativeDragPreview() {
  const [dragging, setDragging] = useState(false);
  const preview = useRef<{ image: HTMLElement; frame: number; window: Window } | null>(null);
  const end = useCallback(() => {
    const current = preview.current;
    if (current) {
      current.window.cancelAnimationFrame(current.frame);
      current.image.remove();
      preview.current = null;
    }
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const ownerWindow = preview.current?.window;
    if (!ownerWindow) return;
    ownerWindow.addEventListener('dragend', end, true);
    ownerWindow.addEventListener('drop', end, true);
    ownerWindow.addEventListener('blur', end);
    return () => {
      ownerWindow.removeEventListener('dragend', end, true);
      ownerWindow.removeEventListener('drop', end, true);
      ownerWindow.removeEventListener('blur', end);
      const current = preview.current;
      if (current) {
        current.window.cancelAnimationFrame(current.frame);
        current.image.remove();
        preview.current = null;
      }
    };
  }, [dragging, end]);

  const start = (event: DragEvent<HTMLElement>, source = event.currentTarget) => {
    end();
    const ownerDocument = source.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) return;
    const scale = Number.parseFloat(ownerWindow.getComputedStyle(ownerDocument.documentElement)
      .getPropertyValue('--app-page-scale-inverse')) || 1;
    const image = ownerDocument.createElement('div');
    image.className = 'sd-drag-preview';
    image.inert = true;
    image.setAttribute('aria-hidden', 'true');
    image.style.left = `${(event.clientX + 12) * scale}px`;
    image.style.top = `${(event.clientY + 12) * scale}px`;
    image.style.width = `${Math.min(source.getBoundingClientRect().width * scale, 360)}px`;
    const copy = source.cloneNode(true) as HTMLElement;
    // A preview is only a snapshot: no duplicate identities or focusable controls in the document.
    for (const node of [copy, ...Array.from(copy.querySelectorAll('[id]'))]) node.removeAttribute('id');
    copy.removeAttribute('data-dragging');
    copy.classList.remove('is-dragging');
    copy.classList.add('sd-drag-preview__content');
    image.append(copy);
    ownerDocument.body.append(image);
    event.dataTransfer.setDragImage(image, 0, 0);
    // Chromium captures after dragstart, so hide the DOM copy on the following frame.
    const frame = ownerWindow.requestAnimationFrame(() => { image.hidden = true; });
    preview.current = { image, frame, window: ownerWindow };
    setDragging(true);
  };
  return { dragging, start, end };
}

/** Preview a vertical reorder without changing the persisted order or remounting native drag sources. */
export function useDragReorderPreview(
  root: RefObject<HTMLElement>,
  { draggedId, beforeId, orderKey, itemSelector = '[data-reorder-id]' }: {
    draggedId: string | null; beforeId?: string | null; orderKey: string; itemSelector?: string;
  },
) {
  const reduce = useReducedMotion();
  const animations = useRef(new Map<HTMLElement, AnimationPlaybackControls>());
  const previousOrder = useRef(orderKey);
  const hadPreview = useRef(false);

  useLayoutEffect(() => {
    const committed = previousOrder.current !== orderKey;
    previousOrder.current = orderKey;
    if (!draggedId && !hadPreview.current) return;
    // Nested sortable groups can limit measurement to their own direct children.
    const rows = Array.from(root.current?.querySelectorAll<HTMLElement>(itemSelector) ?? []);
    const source = rows.find((row) => row.dataset.reorderId === draggedId);
    hadPreview.current = Boolean(source);
    for (const [row, animation] of animations.current) {
      if (rows.includes(row)) continue;
      animation.stop();
      animations.current.delete(row);
    }
    const ordered = rows.filter((row) => row !== source);
    if (source) {
      const index = beforeId == null ? ordered.length : ordered.findIndex((row) => row.dataset.reorderId === beforeId);
      ordered.splice(index < 0 ? ordered.length : index, 0, source);
    }
    const gap = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop - rows[0].offsetHeight : 0;
    let top = rows[0]?.offsetTop ?? 0;
    for (const row of source ? ordered : rows) {
      const y = source ? top - row.offsetTop : 0;
      top += row.offsetHeight + gap;
      animations.current.get(row)?.stop();
      animations.current.set(row, animate(row, { y }, reduce || committed ? { duration: 0 } : SPRING_LAYOUT));
    }
  }, [root, draggedId, beforeId, orderKey, itemSelector, reduce]);

  useEffect(() => {
    const active = animations.current;
    return () => {
      for (const [row, animation] of active) {
        animation.stop();
        row.style.removeProperty('transform');
      }
      active.clear();
    };
  }, []);
}
