import { useState } from 'react';
import { containsBounds, type Bounds } from '../design-geometry.js';

const movementBuffer = 64;
export const designCanvasCullingPadding = 96;

export function useDesignCanvasRenderRange(required: Bounds, scale: number): Bounds {
  const padding = movementBuffer / scale;
  const next = { x: required.x - padding, y: required.y - padding,
    width: required.width + padding * 2, height: required.height + padding * 2 };
  const [rendered, setRendered] = useState<Bounds>(next);
  // Keep the mounted tree across small moves and zooms, including the existing culling margin.
  // Shrink it again after zooming in so a previously fitted draft cannot keep every layer mounted.
  if (containsBounds(rendered, required) && rendered.width <= next.width * 1.5 && rendered.height <= next.height * 1.5) return rendered;
  setRendered(next);
  return next;
}
