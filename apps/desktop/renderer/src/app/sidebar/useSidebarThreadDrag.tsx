import { useNativeDragPreview } from '@setsuna-desktop/renderer-ui';
import type { DragEvent } from 'react';
import type { RuntimeThreadReference } from '@setsuna-desktop/contracts';
import { writeThreadReferenceDrag } from '../../shared/lib/threadReferenceDrag.js';

export function useSidebarThreadDrag(thread: RuntimeThreadReference) {
  const preview = useNativeDragPreview();
  return {
    dragging: preview.dragging,
    onDragStart(event: DragEvent<HTMLButtonElement>) {
      writeThreadReferenceDrag(event.dataTransfer, thread);
      preview.start(event);
    },
    onDragEnd: preview.end,
  };
}
