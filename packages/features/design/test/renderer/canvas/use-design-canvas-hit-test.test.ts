import type Konva from 'konva';
import { expect, it, vi } from 'vitest';
import { deferDesignCanvasHits } from '../../../src/renderer/canvas/use-design-canvas-hit-test.js';

it('picks the layer at its new position before the next canvas draw', () => {
  const shape = {};
  let layerX = 10;
  let paintedX: number | undefined;
  const drawHit = vi.fn(() => { paintedX = layerX; return layer; });
  const layer = {
    batchDraw: () => layer,
    drawHit,
    getIntersection: ({ x }: { x: number }) => x === paintedX ? shape : null,
  } as unknown as Konva.Layer;
  const hits = deferDesignCanvasHits(layer);
  try {
    layer.drawHit();
    expect(drawHit).not.toHaveBeenCalled();
    hits.refresh();
    expect(layer.getIntersection({ x: 10, y: 0 })).toBe(shape);

    layerX = 50;
    layer.batchDraw();
    expect(layer.getIntersection({ x: 10, y: 0 })).toBeNull();
    hits.refresh();
    expect(layer.getIntersection({ x: 50, y: 0 })).toBe(shape);
    expect(layer.getIntersection({ x: 10, y: 0 })).toBeNull();
  } finally {
    hits.dispose();
  }
});
