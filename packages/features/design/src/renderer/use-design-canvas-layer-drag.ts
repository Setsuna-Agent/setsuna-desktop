import { useEffect, useState, type DragEvent, type MutableRefObject, type RefObject } from 'react';
import type { DesignDocument, DesignEdit } from '../contracts/index.js';
import { planDesignCanvasDrop, type DesignCanvasDropPreview } from './design-canvas-edits.js';
import { activeDesignLayerDrag, designLayerDragType, type DesignLayerDrag } from './design-layer-drop.js';
import type { DesignScene } from './design-layout.js';
import { toCanvasScreen, toCanvasWorld, type CanvasViewport } from './use-design-canvas-gestures.js';

type Preview = Readonly<{ source: DesignLayerDrag }> & DesignCanvasDropPreview;

export function useDesignCanvasLayerDrag({ surface, drag, document, scene, revision, viewport, disabled, isGestureActive, onDrop }: Readonly<{
  surface: RefObject<HTMLDivElement>;
  drag: MutableRefObject<DesignLayerDrag | undefined>;
  document: DesignDocument;
  scene: DesignScene;
  revision: string;
  viewport: CanvasViewport;
  disabled: boolean;
  isGestureActive(): boolean;
  onDrop(id: string, edits: readonly DesignEdit[], revision: string): Promise<boolean>;
}>) {
  const [preview, setPreview] = useState<Preview>();
  const active = preview?.source.revision === revision
    && (preview.phase === 'saving' || (!disabled && drag.current === preview.source)) ? preview : undefined;
  const hoveringSource = active?.phase === 'hover' ? active.source : undefined;
  useEffect(() => {
    const owner = surface.current?.ownerDocument.defaultView;
    if (!owner || !hoveringSource) return;
    function cancel() {
      if (drag.current === hoveringSource) drag.current = undefined;
      setPreview((current) => current?.phase === 'hover' && current.source === hoveringSource ? undefined : current);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || drag.current !== hoveringSource) return;
      event.stopPropagation();
      cancel();
    }
    owner.addEventListener('dragend', cancel, true);
    owner.addEventListener('blur', cancel);
    owner.addEventListener('keydown', onKeyDown, true);
    return () => {
      owner.removeEventListener('dragend', cancel, true);
      owner.removeEventListener('blur', cancel);
      owner.removeEventListener('keydown', onKeyDown, true);
    };
  }, [drag, hoveringSource, surface]);

  function dropAt(event: DragEvent<HTMLDivElement>) {
    if (disabled || isGestureActive()) return;
    const source = activeDesignLayerDrag(event.dataTransfer, drag.current, revision);
    if (!source) return;
    const screen = toCanvasScreen(event.currentTarget, { x: event.clientX, y: event.clientY });
    const center = toCanvasWorld(viewport, screen);
    return { source, drop: planDesignCanvasDrop(document, scene, source.id, center) };
  }

  return {
    preview: active,
    onDragOver(event: DragEvent<HTMLDivElement>) {
      const target = dropAt(event);
      if (!target) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setPreview({ phase: 'hover', ...target });
    },
    onDragLeave(event: DragEvent<HTMLDivElement>) {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setPreview((current) => current?.phase === 'hover' ? undefined : current);
    },
    onDrop(event: DragEvent<HTMLDivElement>) {
      const target = dropAt(event);
      if (!target || event.dataTransfer.getData(designLayerDragType) !== target.source.id) return;
      event.preventDefault();
      drag.current = undefined;
      const { source, drop: { id, edits } } = target;
      if (!edits.length) { setPreview(undefined); return; }
      const pending: Preview = { phase: 'saving', source, id, edits };
      setPreview(pending);
      // Dragend follows drop. Retain the projected landing until the write acknowledges or fails.
      void onDrop(id, edits, source.revision).finally(() => setPreview((current) => current === pending ? undefined : current));
    },
  };
}
