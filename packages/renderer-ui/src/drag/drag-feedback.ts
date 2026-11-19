// Adapted from beUI's Sortable List (MIT): https://beui.dev/components/motion/sortable-stack
import { animate, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { SPRING_LAYOUT } from '../motion.js';

/** Keep native drag payloads/cross-window drops while giving the drag image a shared raised surface. */
export function useNativeDragPreview({ anchor = 'cursor', liveWithin }: {
  anchor?: 'cursor' | 'source'; liveWithin?: RefObject<HTMLElement>;
} = {}) {
  const [dragging, setDragging] = useState(false);
  const preview = useRef<{ image: HTMLElement; dispose(): void; window: Window } | null>(null);
  const removePreview = useCallback(() => {
    const current = preview.current;
    if (current) {
      current.dispose();
      current.image.remove();
      preview.current = null;
    }
  }, []);
  const end = useCallback(() => {
    removePreview();
    setDragging(false);
  }, [removePreview]);

  useEffect(() => {
    if (!dragging) return;
    const ownerWindow = preview.current?.window;
    if (!ownerWindow) return;
    ownerWindow.addEventListener('dragend', end, true);
    // A live preview may render the drop target itself. Let its handler run before removing it.
    ownerWindow.addEventListener('drop', end);
    ownerWindow.addEventListener('blur', end);
    return () => {
      ownerWindow.removeEventListener('dragend', end, true);
      ownerWindow.removeEventListener('drop', end);
      ownerWindow.removeEventListener('blur', end);
      removePreview();
    };
  }, [dragging, end, removePreview]);

  const start = (event: DragEvent<HTMLElement>, source = event.currentTarget) => {
    end();
    const ownerDocument = source.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    if (!ownerWindow) return;
    const scale = Number.parseFloat(ownerWindow.getComputedStyle(ownerDocument.documentElement)
      .getPropertyValue('--app-page-scale-inverse')) || 1;
    const bounds = source.getBoundingClientRect();
    const aligned = anchor === 'source';
    const image = ownerDocument.createElement('div');
    image.className = 'sd-drag-preview';
    image.dataset.anchor = anchor;
    image.inert = true;
    image.setAttribute('aria-hidden', 'true');
    image.style.left = `${(aligned ? bounds.left : event.clientX + 12) * scale}px`;
    image.style.top = `${(aligned ? bounds.top : event.clientY + 12) * scale}px`;
    image.style.width = `${aligned ? bounds.width * scale : Math.min(bounds.width * scale, 360)}px`;
    const copy = source.cloneNode(true) as HTMLElement;
    // A preview is only a snapshot: no duplicate identities or focusable controls in the document.
    for (const node of [copy, ...Array.from(copy.querySelectorAll('[id]'))]) node.removeAttribute('id');
    copy.removeAttribute('data-dragging');
    copy.classList.remove('is-dragging');
    copy.classList.add('sd-drag-preview__content');
    image.append(copy);
    ownerDocument.body.append(image);
    // The snapshot uses body coordinates, but the grab point is in viewport CSS pixels.
    const x = aligned ? event.clientX - bounds.left : -12;
    const y = aligned ? event.clientY - bounds.top : -12;
    const scope = liveWithin?.current;
    let dispose: () => void;
    if (scope) {
      dispose = trackDragPreview(ownerWindow, scope, image, event.dataTransfer, scale, x, y);
    } else {
      event.dataTransfer.setDragImage(image, aligned ? Math.round(x) : 0, aligned ? Math.round(y) : 0);
      // Chromium captures after dragstart, so hide the DOM copy on the following frame.
      const frame = ownerWindow.requestAnimationFrame(() => { image.hidden = true; });
      dispose = () => ownerWindow.cancelAnimationFrame(frame);
    }
    preview.current = { image, dispose, window: ownerWindow };
    setDragging(true);
  };
  return { dragging, start, end };
}

function trackDragPreview(owner: Window, scope: HTMLElement, image: HTMLElement, transfer: DataTransfer, scale: number, x: number, y: number) {
  // A transparent native image lets other surfaces draw their own live preview.
  const bitmap = image.ownerDocument.createElement('canvas');
  bitmap.width = 1;
  bitmap.height = 1;
  bitmap.className = 'sd-drag-preview__bitmap';
  bitmap.setAttribute('aria-hidden', 'true');
  image.ownerDocument.body.append(bitmap);
  transfer.setDragImage(bitmap, 0, 0);
  const frame = owner.requestAnimationFrame(() => bitmap.remove());
  function follow(event: globalThis.DragEvent) {
    image.hidden = !(event.target instanceof Node && scope.contains(event.target));
    if (image.hidden) return;
    image.style.left = `${(event.clientX - x) * scale}px`;
    image.style.top = `${(event.clientY - y) * scale}px`;
  }
  function leave(event: globalThis.DragEvent) {
    if (!(event.relatedTarget instanceof Node && scope.contains(event.relatedTarget))) image.hidden = true;
  }
  owner.addEventListener('dragenter', follow, true);
  owner.addEventListener('dragover', follow, true);
  owner.addEventListener('dragleave', leave, true);
  return () => {
    owner.cancelAnimationFrame(frame);
    bitmap.remove();
    owner.removeEventListener('dragenter', follow, true);
    owner.removeEventListener('dragover', follow, true);
    owner.removeEventListener('dragleave', leave, true);
  };
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
