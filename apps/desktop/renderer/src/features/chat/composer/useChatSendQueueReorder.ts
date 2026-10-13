import type { RuntimeQueuedTurnInput } from '@setsuna-desktop/contracts';
import { useDragReorderPreview, useNativeDragPreview } from '@setsuna-desktop/renderer-ui';
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

const QUEUED_INPUT_DRAG_TYPE = 'application/x-setsuna-queued-input';

type QueueDrag = {
  inputId: string;
  beforeId: string | null;
  orderKey: string;
};

export function useChatSendQueueReorder({
  disabled,
  items,
  onReorder,
}: {
  disabled: boolean;
  items: RuntimeQueuedTurnInput[];
  onReorder: (inputIds: string[]) => Promise<boolean>;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const dragRef = useRef<QueueDrag | null>(null);
  const pointerYRef = useRef<number | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const [drag, setDrag] = useState<QueueDrag | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDrop, setPendingDrop] = useState<QueueDrag | null>(null);
  const nativePreview = useNativeDragPreview();
  const inputIds = items.map((item) => item.id);
  const orderKey = JSON.stringify(inputIds);
  const reorderDisabled = disabled || saving || items.length < 2;
  const activeDrag = !disabled && drag?.orderKey === orderKey ? drag : null;
  const draggedInputId = activeDrag?.inputId ?? null;
  const previewDrag = activeDrag ?? (pendingDrop?.orderKey === orderKey ? pendingDrop : null);
  useDragReorderPreview(listRef, {
    draggedId: previewDrag?.inputId ?? null,
    beforeId: previewDrag?.beforeId,
    orderKey,
  });

  const clearDrag = useCallback(() => {
    if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = null;
    dragRef.current = null;
    pointerYRef.current = null;
    setDrag(null);
  }, []);

  const updateTarget = useCallback((clientY: number) => {
    const current = dragRef.current;
    if (!current || !listRef.current) return;
    const rows = Array.from(listRef.current.children) as HTMLElement[];
    const beforeId = rows.find((row) => {
      if (row.dataset.queueId === current.inputId) return false;
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    })?.dataset.queueId ?? null;
    dragRef.current = current.beforeId === beforeId ? current : { ...current, beforeId };
    setDrag(dragRef.current);
  }, []);

  useEffect(() => {
    clearDrag();
    return clearDrag;
  }, [clearDrag, disabled, orderKey]);

  useEffect(() => {
    if (!draggedInputId) return;
    let frame = 0;
    const scroll = () => {
      const list = listRef.current;
      const y = pointerYRef.current;
      if (list && y !== null) {
        const rect = list.getBoundingClientRect();
        const edge = Math.min(24, rect.height / 3);
        const distance = y < rect.top + edge
          ? y - rect.top - edge
          : y > rect.bottom - edge ? y - rect.bottom + edge : 0;
        const previousTop = list.scrollTop;
        list.scrollTop += Math.max(-8, Math.min(8, distance / 3));
        if (list.scrollTop !== previousTop) updateTarget(y);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [draggedInputId, updateTarget]);

  const commit = async (nextIds: string[], drop: QueueDrag | null = null) => {
    if (reorderDisabled || savingRef.current || nextIds.every((id, index) => id === inputIds[index])) return;
    savingRef.current = true;
    setPendingDrop(drop);
    setSaving(true);
    try {
      await onReorder(nextIds);
    } finally {
      savingRef.current = false;
      setPendingDrop(null);
      setSaving(false);
    }
  };

  return {
    listRef,
    saving,
    draggedInputId,
    previewInputId: previewDrag?.inputId ?? null,
    reorderDisabled,
    handleProps(inputId: string) {
      return {
        draggable: !reorderDisabled,
        disabled: reorderDisabled,
        onDragStart(event: DragEvent<HTMLButtonElement>) {
          if (reorderDisabled || savingRef.current) {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(QUEUED_INPUT_DRAG_TYPE, inputId);
          const row = event.currentTarget.closest('li');
          if (row) nativePreview.start(event, row);
          dragRef.current = { inputId, beforeId: inputIds[inputIds.indexOf(inputId) + 1] ?? null, orderKey };
          // Chromium snapshots setDragImage after dragstart; dim the source only after that frame.
          previewFrameRef.current = requestAnimationFrame(() => {
            previewFrameRef.current = null;
            setDrag(dragRef.current);
          });
        },
        onDragEnd() { nativePreview.end(); clearDrag(); },
        onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
          if (event.key === 'Escape') {
            clearDrag();
            return;
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          event.stopPropagation();
          const index = inputIds.indexOf(inputId);
          const target = index + (event.key === 'ArrowUp' ? -1 : 1);
          if (reorderDisabled || index < 0 || target < 0 || target >= inputIds.length) return;
          const nextIds = [...inputIds];
          nextIds.splice(index, 1);
          nextIds.splice(target, 0, inputId);
          void commit(nextIds);
        },
      };
    },
    listProps: {
      onDragOver(event: DragEvent<HTMLOListElement>) {
        const current = dragRef.current;
        if (reorderDisabled || !current || current.orderKey !== orderKey) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        pointerYRef.current = event.clientY;
        updateTarget(event.clientY);
      },
      onDragLeave(event: DragEvent<HTMLOListElement>) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        pointerYRef.current = null;
        setDrag(null);
      },
      onDrop(event: DragEvent<HTMLOListElement>) {
        const current = dragRef.current;
        if (!current) return;
        event.preventDefault();
        event.stopPropagation();
        clearDrag();
        // A send/delete or another window's reorder invalidates the drag's original queue.
        if (reorderDisabled || current.orderKey !== orderKey) return;
        const nextIds = inputIds.filter((id) => id !== current.inputId);
        const beforeIndex = current.beforeId === null ? nextIds.length : nextIds.indexOf(current.beforeId);
        if (beforeIndex < 0) return;
        nextIds.splice(beforeIndex, 0, current.inputId);
        void commit(nextIds, current);
      },
    },
  };
}
