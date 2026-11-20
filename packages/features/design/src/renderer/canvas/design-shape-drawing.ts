import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DrawingTool } from '../use-design-canvas-gestures.js';
import { defaultDesignStroke } from '../design-paint.js';
import { defaultDesignPolygonSides, type DesignNode, type DesignVectorGeometry } from '../../contracts/index.js';
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

export function drawnDesignLayer(drawingTool: DrawingTool, size: Bounds, parentId: string | null, click: boolean,
  geometry: DesignVectorGeometry | undefined, t: RendererTranslate, outlined = true): DesignNode {
  const strokes = outlined ? [defaultDesignStroke] : undefined;
  if (drawingTool === 'web' || drawingTool === 'script') return {
    ...size, kind: drawingTool, name: t(`feature.design.${drawingTool}`), strokes,
    width: click ? (drawingTool === 'web' ? 720 : 240) : size.width,
    height: click ? (drawingTool === 'web' ? 480 : 160) : size.height,
  };
  if (drawingTool === 'frame') return {
    ...size, kind: 'frame', name: t(parentId === null ? 'feature.design.artboard' : 'feature.design.frame'),
    width: click ? (parentId === null ? 960 : 280) : size.width,
    height: click ? (parentId === null ? 600 : 160) : size.height, childIds: [], strokes,
  };
  if (drawingTool === 'text') {
    const { height: _height, ...placement } = size;
    return { ...placement, kind: 'text', width: click ? 216 : Math.max(24, size.width),
      widthMode: click ? 'hug' : 'fixed', fontSize: 24, text: t('feature.design.text') };
  }
  const shape = { ...(click && !isSegmentDrawingTool(drawingTool) ? { ...size, width: 128, height: 96 } : size), strokes };
  if (geometry) return { ...shape, kind: 'vector', geometry,
    name: drawingTool === 'polygon' ? undefined : t(`feature.design.tool.${drawingTool}`) };
  return drawingTool === 'ellipse'
    ? { kind: 'ellipse', ...shape }
    : { kind: 'rectangle', ...shape, cornerRadius: 0 };
}
