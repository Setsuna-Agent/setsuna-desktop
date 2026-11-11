import { useNativeDragPreview } from '@setsuna-desktop/renderer-ui';
import type { DragEvent } from 'react';
import type { RuntimeThreadReference } from '@setsuna-desktop/contracts';
import { writeThreadReferenceDrag } from '../../shared/lib/threadReferenceDrag.js';
import type { SidebarReorder } from './useSidebarReorder.js';

export function useSidebarThreadDrag(thread: RuntimeThreadReference, reorder?: SidebarReorder, reorderId = thread.id) {
  const preview = useNativeDragPreview();
  return {
    dragging: preview.dragging,
    onDragStart(event: DragEvent<HTMLButtonElement>) {
      writeThreadReferenceDrag(event.dataTransfer, thread);
      reorder?.start(event, reorderId, 'copyMove');
      preview.start(event);
    },
    onDragEnd() { preview.end(); reorder?.end(); },
  };
}
