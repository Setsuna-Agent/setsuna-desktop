import { shellSidebarPluginEntrySlot } from '@setsuna-desktop/renderer-contracts/shell';
import { useDragReorderPreview, useNativeDragPreview } from '@setsuna-desktop/renderer-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useToast } from '../../../app/providers/ToastProvider.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useRendererOwnedSlots, useRendererPluginRuntime } from '../../renderer-plugins/RendererKernelProvider.js';
import { createRendererLayoutPreferenceController } from '../../renderer-plugins/layout-preference-controller.js';
import { createRendererLayoutPreferenceStore } from '../../renderer-plugins/layout-preferences.js';
import { reorderListPreferences, type ListDropPosition } from '../../renderer-plugins/reorder-list-preferences.js';

const APP_DRAG_TYPE = 'application/x-setsuna-sidebar-app';

export function usePluginAppOrder() {
  const runtime = useRendererPluginRuntime();
  const slots = useRendererOwnedSlots();
  const entryIds = slots.listEntryIds(shellSidebarPluginEntrySlot);
  const controller = useMemo(() => createRendererLayoutPreferenceController(
    runtime, createRendererLayoutPreferenceStore(window.localStorage),
  ), [runtime]);
  const toast = useToast();
  const { t } = useI18n();
  const sourceRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const originOrder = useRef<string | null>(null);
  const nativePreview = useNativeDragPreview();
  const pendingRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; position: ListDropPosition } | null>(null);
  const orderKey = JSON.stringify(entryIds);
  const activeId = originOrder.current === orderKey ? draggingId : null;
  const otherIds = entryIds.filter((id) => id !== activeId);
  const beforeId = target
    ? target.position === 'before' ? target.id : otherIds[otherIds.indexOf(target.id) + 1] ?? null
    : entryIds[entryIds.indexOf(activeId ?? '') + 1] ?? null;
  useDragReorderPreview(rootRef, { draggedId: activeId, beforeId, orderKey });
  const reset = useCallback(() => {
    sourceRef.current = null;
    originOrder.current = null;
    setDraggingId(null);
    setTarget(null);
  }, []);
  useEffect(() => {
    if (originOrder.current !== null && originOrder.current !== orderKey) reset();
  }, [orderKey, reset]);
  const isInternalDrag = (event: DragEvent<HTMLButtonElement>) => (
    sourceRef.current !== null && entryIds.includes(sourceRef.current)
    && Array.from(event.dataTransfer.types).includes(APP_DRAG_TYPE)
  );
  const dropPosition = (event: DragEvent<HTMLButtonElement>): ListDropPosition => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  };
  const drop = async (event: DragEvent<HTMLButtonElement>, targetId: string) => {
    if (!isInternalDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = sourceRef.current!;
    const payload = event.dataTransfer.getData(APP_DRAG_TYPE);
    const dropTarget = target ?? { id: targetId, position: dropPosition(event) };
    reset();
    if (pendingRef.current || payload !== sourceId) return;
    const next = reorderListPreferences(controller.get(), shellSidebarPluginEntrySlot.id, entryIds, sourceId, dropTarget.id, dropTarget.position);
    if (!next) return;
    pendingRef.current = true;
    try {
      // The existing controller rolls back the displayed order if persistence fails.
      await controller.update(next);
    } catch {
      toast.error(t('pluginUi.orderSaveFailed'));
    } finally {
      pendingRef.current = false;
    }
  };

  return {
    rootRef,
    dragging: draggingId !== null,
    buttonProps: (id: string) => ({
      draggable: entryIds.length > 1,
      'data-reorder-id': id,
      'data-dragging': draggingId === id || undefined,
      onDragStart: (event: DragEvent<HTMLButtonElement>) => {
        if (pendingRef.current || !entryIds.includes(id)) { event.preventDefault(); return; }
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(APP_DRAG_TYPE, id);
        nativePreview.start(event);
        originOrder.current = orderKey;
        sourceRef.current = id;
        setDraggingId(id);
      },
      onDragOver: (event: DragEvent<HTMLButtonElement>) => {
        if (!isInternalDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        // Dropping over the moving placeholder keeps the last valid insertion position.
        if (sourceRef.current === id) return;
        const position = dropPosition(event);
        setTarget((current) => current?.id === id && current.position === position ? current : { id, position });
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => { void drop(event, id); },
      onDragEnd: () => { nativePreview.end(); reset(); },
    }),
  };
}
