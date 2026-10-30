import { useDragReorderPreview } from '@setsuna-desktop/renderer-ui';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { SidebarDropPosition } from './sidebarOrder.js';

const SIDEBAR_DRAG_TYPE = 'application/x-setsuna-sidebar-order';
type DropTarget = { id: string; position: SidebarDropPosition };
type SidebarDrag = { id: string; orderKey: string; target: DropTarget | null };

export function useSidebarReorder(ids: readonly string[], onMove: (source: string, target: string, position: SidebarDropPosition) => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<SidebarDrag | null>(null);
  const [drag, setDrag] = useState<SidebarDrag | null>(null);
  const orderKey = JSON.stringify(ids);
  const active = drag?.orderKey === orderKey ? drag : null;
  const otherIds = ids.filter((id) => id !== active?.id);
  const beforeId = active?.target
    ? active.target.position === 'before' ? active.target.id : otherIds[otherIds.indexOf(active.target.id) + 1] ?? null
    : ids[ids.indexOf(active?.id ?? '') + 1] ?? null;
  useDragReorderPreview(rootRef, {
    draggedId: active?.id ?? null, beforeId, orderKey,
    itemSelector: ':scope > [data-reorder-id]',
  });

  const reset = useCallback(() => { dragRef.current = null; setDrag(null); }, []);
  useEffect(() => { reset(); }, [orderKey, reset]);
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    const ownerWindow = rootRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    ownerWindow.addEventListener('dragend', reset);
    ownerWindow.addEventListener('drop', reset);
    ownerWindow.addEventListener('blur', reset);
    ownerWindow.addEventListener('keydown', escape);
    return () => {
      ownerWindow.removeEventListener('dragend', reset);
      ownerWindow.removeEventListener('drop', reset);
      ownerWindow.removeEventListener('blur', reset);
      ownerWindow.removeEventListener('keydown', escape);
    };
  }, [dragging, reset]);

  const currentDrag = (event: DragEvent<HTMLElement>) => {
    const current = dragRef.current;
    return current?.orderKey === orderKey && Array.from(event.dataTransfer.types).includes(SIDEBAR_DRAG_TYPE)
      ? current : null;
  };
  const positionAt = (event: DragEvent<HTMLElement>): SidebarDropPosition => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };

  return {
    rootRef,
    dragging,
    end: reset,
    start(event: DragEvent<HTMLElement>, id: string, effectAllowed: 'move' | 'copyMove' = 'move') {
      if (!ids.includes(id)) return;
      event.stopPropagation();
      event.dataTransfer.effectAllowed = effectAllowed;
      event.dataTransfer.setData(SIDEBAR_DRAG_TYPE, id);
      dragRef.current = { id, orderKey, target: null };
      setDrag(dragRef.current);
    },
    rowProps(id: string) {
      return {
        'data-reorder-id': id,
        'data-reordering': active?.id === id || undefined,
        onDragOver(event: DragEvent<HTMLDivElement>) {
          const current = currentDrag(event);
          if (!current) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          // The source is a moving placeholder, not a new insertion target.
          if (id === current.id) return;
          const position = positionAt(event);
          if (current.target?.id === id && current.target.position === position) return;
          dragRef.current = { ...current, target: { id, position } };
          setDrag(dragRef.current);
        },
        onDrop(event: DragEvent<HTMLDivElement>) {
          const current = currentDrag(event);
          if (!current) return;
          event.preventDefault();
          event.stopPropagation();
          const target = current.target && (id === current.id || id === current.target.id)
            ? current.target : id === current.id ? null : { id, position: positionAt(event) };
          reset();
          if (target && event.dataTransfer.getData(SIDEBAR_DRAG_TYPE) === current.id) {
            onMove(current.id, target.id, target.position);
          }
        },
      };
    },
  };
}

export type SidebarReorder = ReturnType<typeof useSidebarReorder>;
