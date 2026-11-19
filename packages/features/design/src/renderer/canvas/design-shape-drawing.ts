import { defaultDesignPolygonSides, type DesignVectorGeometry } from '../../contracts/index.js';
import type { Bounds, Point } from '../design-geometry.js';
import { fitDesignPath } from '../vectors/design-vector.js';

export type VectorDrawingTool = 'polygon' | 'line' | 'arrow' | 'star';

const starGeometry = fitDesignPath(Array.from({ length: 10 }, (_, index) => {
  const angle = index * Math.PI / 5 - Math.PI / 2;
  const radius = index % 2 === 0 ? 1 : 0.45;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}), true).geometry;

export function isSegmentDrawingTool(tool: string): tool is 'line' | 'arrow' {
  return tool === 'line' || tool === 'arrow';
}

export function designDrawnVector(tool: string, { bounds, start, end }: Readonly<{ bounds: Bounds; start: Point; end: Point }>,
  click: boolean): Readonly<{ bounds: Bounds; geometry: DesignVectorGeometry }> | undefined {
  if (tool === 'polygon') return { bounds, geometry: { kind: 'polygon', sides: defaultDesignPolygonSides } };
  if (tool === 'star') return { bounds, geometry: starGeometry };
  if (!isSegmentDrawingTool(tool)) return;

  const tip = click ? { x: start.x + 96, y: start.y } : end;
  if (tip.x === start.x && tip.y === start.y) return;
  const { bounds: shaft, geometry } = fitDesignPath([start, tip], false);
  return { bounds: shaft, geometry: tool === 'arrow' ? { ...geometry, endMarker: 'arrow' } : geometry };
}
