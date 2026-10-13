import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { MessageSquare } from 'lucide-react';
import type { RuntimeThreadReference } from '@setsuna-desktop/contracts';
import { writeThreadReferenceDrag } from '../../shared/lib/threadReferenceDrag.js';

export function useSidebarThreadDrag(thread: RuntimeThreadReference) {
  const [preview, setPreview] = useState<{ document: Document; x: number; y: number } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const reset = useCallback(() => setPreview(null), []);

  useEffect(() => {
    const ownerWindow = preview?.document.defaultView;
    if (!ownerWindow) return;
    ownerWindow.addEventListener('dragend', reset, true);
    ownerWindow.addEventListener('drop', reset, true);
    ownerWindow.addEventListener('blur', reset);
    return () => {
      ownerWindow.removeEventListener('dragend', reset, true);
      ownerWindow.removeEventListener('drop', reset, true);
      ownerWindow.removeEventListener('blur', reset);
      if (frameRef.current !== null) ownerWindow.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [preview, reset]);

  return {
    dragging: preview !== null,
    onDragStart(event: DragEvent<HTMLButtonElement>) {
      const ownerDocument = event.currentTarget.ownerDocument;
      writeThreadReferenceDrag(event.dataTransfer, thread);
      // Chromium snapshots the drag image after dragstart. Mount it synchronously,
      // then hide the DOM copy on the next frame while the native image follows the pointer.
      flushSync(() => setPreview({ document: ownerDocument, x: event.clientX + 12, y: event.clientY + 12 }));
      const image = previewRef.current;
      if (image) {
        event.dataTransfer.setDragImage(image, 0, 0);
        frameRef.current = ownerDocument.defaultView?.requestAnimationFrame(() => {
          image.hidden = true;
          frameRef.current = null;
        }) ?? null;
      }
    },
    onDragEnd: reset,
    preview: preview ? createPortal(
      <div ref={previewRef} className="desktop-thread-drag-preview" aria-hidden="true" style={{
        left: `calc(${preview.x}px * var(--app-page-scale-inverse))`,
        top: `calc(${preview.y}px * var(--app-page-scale-inverse))`,
      }}>
        <MessageSquare size={14} />
        <span>{thread.title || thread.id}</span>
      </div>,
      preview.document.body,
    ) : null,
  };
}
