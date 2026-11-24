import type { Bounds, Point } from '../design-geometry.js';

export const designToolWindowEdges = ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
export type DesignToolWindowGrip = (typeof designToolWindowEdges)[number] | 'move';
type Size = Pick<Bounds, 'width' | 'height'>;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function constrainDesignToolWindow(frame: Bounds, viewport: Bounds): Bounds {
  const width = Math.min(frame.width, viewport.width);
  const height = Math.min(frame.height, viewport.height);
  return {
    x: clamp(frame.x, viewport.x, viewport.x + viewport.width - width),
    y: clamp(frame.y, viewport.y, viewport.y + viewport.height - height),
    width,
    height,
  };
}

function resizeAxis(origin: number, size: number, delta: number, start: number, end: number, minimum: number, edge: -1 | 0 | 1) {
  const minSize = Math.min(minimum, size);
  if (edge < 0) {
    const fixedEdge = origin + size;
    const next = clamp(origin + delta, start, fixedEdge - minSize);
    return [next, fixedEdge - next] as const;
  }
  if (edge > 0) return [origin, clamp(size + delta, minSize, end - origin)] as const;
  return [origin, size] as const;
}

export function adjustDesignToolWindow(frame: Bounds, grip: DesignToolWindowGrip, delta: Point, viewport: Bounds, minimum: Size): Bounds {
  if (grip === 'move') return constrainDesignToolWindow({ ...frame, x: frame.x + delta.x, y: frame.y + delta.y }, viewport);

  // Resizing a leading edge keeps its opposite edge fixed, including at the minimum size.
  const start = constrainDesignToolWindow(frame, viewport);
  const horizontal = grip.includes('left') ? -1 : grip.includes('right') ? 1 : 0;
  const vertical = grip.includes('top') ? -1 : grip.includes('bottom') ? 1 : 0;
  const [x, width] = resizeAxis(start.x, start.width, delta.x, viewport.x, viewport.x + viewport.width, minimum.width, horizontal);
  const [y, height] = resizeAxis(start.y, start.height, delta.y, viewport.y, viewport.y + viewport.height, minimum.height, vertical);
  return { x, y, width, height };
}
