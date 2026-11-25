import type Konva from 'konva';
import { useCallback, useRef, type RefObject } from 'react';
import type { Point } from '../design-geometry.js';

export function deferDesignCanvasHits(layer: Konva.Layer) {
  const { batchDraw, drawHit, getIntersection } = layer;
  let dirty = true;

  layer.batchDraw = function () {
    dirty = true;
    return batchDraw.call(this);
  };
  layer.drawHit = function (canvas, top) {
    if (canvas || top) return drawHit.call(this, canvas, top);
    dirty = true;
    return this;
  };
  layer.getIntersection = function (point) {
    // Konva also looks up a shape to dispatch its own wheel and hover events.
    // The editor handles those on the canvas surface without needing a fresh hit graph.
    return dirty ? null : getIntersection.call(this, point);
  };

  return {
    refresh() {
      if (!dirty) return;
      drawHit.call(layer);
      dirty = false;
    },
    dispose() {
      layer.batchDraw = batchDraw;
      layer.drawHit = drawHit;
      layer.getIntersection = getIntersection;
    },
  };
}

export function useDesignCanvasHitTest(stage: RefObject<Konva.Stage>) {
  const hits = useRef<ReturnType<typeof deferDesignCanvasHits>>();
  const bind = useCallback((layer: Konva.Layer | null) => {
    hits.current?.dispose();
    hits.current = layer ? deferDesignCanvasHits(layer) : undefined;
  }, []);
  const hitTest = useCallback((point: Point) => {
    hits.current?.refresh();
    return stage.current?.getIntersection(point) ?? null;
  }, [stage]);
  return { bind, hitTest };
}
