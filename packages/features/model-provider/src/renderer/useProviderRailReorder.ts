import type { ProviderConfigState } from '@setsuna-desktop/contracts';
import { useDragReorderPreview, useNativeDragPreview } from '@setsuna-desktop/renderer-ui';
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

const PROVIDER_DRAG_TYPE = 'application/x-setsuna-model-provider';
type DropTarget = { id: string; position: 'before' | 'after' };
type ProviderDrag = { id: string; orderKey: string; target: DropTarget | null };

export function useProviderRailReorder({ providers, visibleProviders, onReorder }: {
  providers: readonly ProviderConfigState[];
  visibleProviders: readonly ProviderConfigState[];
  onReorder(providers: ProviderConfigState[]): void;
}) {
  const listRef = useRef<HTMLElement>(null);
  const dragRef = useRef<ProviderDrag | null>(null);
  const [drag, setDrag] = useState<ProviderDrag | null>(null);
  const nativePreview = useNativeDragPreview();
  // A changed list or search invalidates the original insertion target, but field edits do not.
  const visibleIds = visibleProviders.map((provider) => provider.id);
  const orderKey = JSON.stringify([providers.map((provider) => provider.id), visibleIds]);
  const active = drag?.orderKey === orderKey ? drag : null;
  const dragging = active !== null;
  const others = visibleIds.filter((id) => id !== active?.id);
  const beforeId = active?.target
    ? active.target.position === 'before' ? active.target.id : others[others.indexOf(active.target.id) + 1] ?? null
    : visibleIds[visibleIds.indexOf(active?.id ?? '') + 1] ?? null;
  useDragReorderPreview(listRef, { draggedId: active?.id ?? null, beforeId, orderKey });

  const reset = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
  }, []);
  useEffect(() => { reset(); }, [orderKey, reset]);
  useEffect(() => {
    if (!dragging) return;
    window.addEventListener('blur', reset);
    return () => window.removeEventListener('blur', reset);
  }, [dragging, reset]);

  const isInternal = (event: DragEvent<HTMLElement>) => dragRef.current?.orderKey === orderKey
    && Array.from(event.dataTransfer.types).includes(PROVIDER_DRAG_TYPE);
  const position = (event: DragEvent<HTMLElement>): DropTarget['position'] => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  };
  const previewTarget = (target: DropTarget) => {
    const current = dragRef.current;
    if (!current || current.id === target.id
      || (current.target?.id === target.id && current.target.position === target.position)) return;
    dragRef.current = { ...current, target };
    setDrag(dragRef.current);
  };
  const commit = (id: string, target: DropTarget) => {
    if (id === target.id) return;
    const source = providers.find((provider) => provider.id === id);
    const next = providers.filter((provider) => provider.id !== id);
    const index = next.findIndex((provider) => provider.id === target.id);
    if (!source || index < 0) return;
    // Move within the full list so filtered-out providers and their drafts are retained.
    next.splice(index + (target.position === 'after' ? 1 : 0), 0, source);
    if (next.some((provider, index) => provider.id !== providers[index]?.id)) onReorder(next);
  };
  const drop = (event: DragEvent<HTMLElement>, fallback?: DropTarget) => {
    if (!isInternal(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = dragRef.current!;
    const target = current.target ?? fallback;
    const payload = event.dataTransfer.getData(PROVIDER_DRAG_TYPE);
    reset();
    nativePreview.end();
    if (target && payload === current.id) commit(current.id, target);
  };

  return {
    listRef,
    listProps: {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!isInternal(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        // Also allow dropping into the gaps or empty space below the last service.
        const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-reorder-id]') ?? [])
          .filter((row) => row.dataset.reorderId !== dragRef.current?.id);
        const next = rows.find((row) => {
          const bounds = row.getBoundingClientRect();
          return event.clientY < bounds.top + bounds.height / 2;
        });
        const target = next ?? rows.at(-1);
        if (target) previewTarget({ id: target.dataset.reorderId!, position: next ? 'before' : 'after' });
      },
      onDrop: (event: DragEvent<HTMLElement>) => drop(event),
    },
    itemProps(id: string) {
      return {
        draggable: visibleIds.length > 1,
        'data-reorder-id': id,
        'data-dragging': active?.id === id || undefined,
        'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
        onDragStart(event: DragEvent<HTMLButtonElement>) {
          if (visibleIds.length < 2) { event.preventDefault(); return; }
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(PROVIDER_DRAG_TYPE, id);
          nativePreview.start(event);
          dragRef.current = { id, orderKey, target: null };
          setDrag(dragRef.current);
        },
        onDragOver(event: DragEvent<HTMLButtonElement>) {
          if (!isInternal(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          // The moving placeholder keeps the last insertion target, like the app sidebar.
          previewTarget({ id, position: position(event) });
        },
        onDrop: (event: DragEvent<HTMLButtonElement>) => drop(event, { id, position: position(event) }),
        onDragEnd() { nativePreview.end(); reset(); },
        onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
          if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const offset = event.key === 'ArrowUp' ? -1 : 1;
          const targetId = visibleIds[visibleIds.indexOf(id) + offset];
          if (targetId) commit(id, { id: targetId, position: offset < 0 ? 'before' : 'after' });
        },
      };
    },
  };
}
