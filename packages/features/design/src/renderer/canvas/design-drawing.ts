import {
  designBrushPresets, designPencilPresets, maxDesignPathAnchors,
  type DesignFreehandStyle, type DesignNode, type DesignPaint, type DesignPathAnchor, type DesignPathGeometry, type DesignVector,
} from '../../contracts/index.js';
import { splitDesignColor } from '../../contracts/design-color.js';
import { type Point } from '../design-geometry.js';
import { designFills, visibleDesignStrokes } from '../design-paint.js';
import { fitDesignPath } from '../vectors/design-vector.js';

export type FreehandTool = 'brush' | 'pencil';
export type DrawingInkTool = FreehandTool | 'pen';
type Preset = DesignFreehandStyle['preset'];
export type DrawingInk = Readonly<{ paint: DesignPaint; width: number; preset?: Preset }>;
export type FreehandInk = DrawingInk & Readonly<{ preset: Preset }>;
export type DrawingSample = Point & Readonly<{ pressure?: number }>;
type DrawingPoints = readonly [DrawingSample, ...DrawingSample[]];
export type DrawingPath = DesignVector & Readonly<{ geometry: DesignPathGeometry }>;
export type DrawingPreview = Readonly<{ id: string; parentId: string | null; node: DrawingPath }>;

export const drawingPresets = { brush: designBrushPresets, pencil: designPencilPresets };
export const minDrawingWidth = 0.5;
export const maxDrawingWidth = 96;
export const defaultDrawingWidths = { pen: 1, brush: 16, pencil: 2 } as const;

export function isFreehandTool(tool: string): tool is FreehandTool {
  return tool === 'brush' || tool === 'pencil';
}

export function isDrawingInkTool(tool: string): tool is DrawingInkTool {
  return tool === 'pen' || isFreehandTool(tool);
}

export function drawingInkTool(preset: Preset): FreehandTool {
  return designBrushPresets.some((value) => value === preset) ? 'brush' : 'pencil';
}

export function clampDrawingWidth(width: number): number {
  return Math.max(minDrawingWidth, Math.min(maxDrawingWidth, width));
}

export function drawingPathNode(anchors: readonly DesignPathAnchor[], closed: boolean, ink: DrawingInk): DrawingPath {
  const { bounds, geometry } = fitDesignPath(anchors, closed);
  const freehand = ink.preset ? { preset: ink.preset, width: ink.width } : undefined;
  return { kind: 'vector', ...bounds, geometry: { ...geometry, ...(freehand ? { freehand } : undefined) },
    ...(freehand && drawingInkTool(freehand.preset) === 'brush'
      ? { fills: [ink.paint] } : { strokes: [{ ...ink.paint, width: ink.width, join: 'round' }] }) };
}

export function sampleDesignInk(node: DesignNode | undefined): DrawingInk | undefined {
  if (node?.kind !== 'vector') return;
  const style = node.geometry.kind === 'path' ? node.geometry.freehand : undefined;
  const brush = style && drawingInkTool(style.preset) === 'brush';
  const stroke = visibleDesignStrokes(node).at(-1);
  const source = brush ? designFills(node).filter(({ hidden, opacity }) => !hidden && opacity !== 0).at(-1) : stroke;
  if (!source || source.image) return;
  const { color, opacity: alpha } = splitDesignColor(source.color);
  const { gradient, blendMode } = source;
  return {
    paint: { color, opacity: (source.opacity ?? 1) * (gradient ? 1 : alpha), blendMode,
      gradient: gradient && { ...gradient, stops: gradient.stops.map(({ offset, color, opacity }) => ({ offset, color, opacity })) } },
    width: clampDrawingWidth(brush ? style.width : stroke?.width ?? defaultDrawingWidths.pencil), preset: style?.preset,
  };
}

export function freehandDesignNode(samples: DrawingPoints, ink: FreehandInk): DrawingPath {
  const brush = drawingInkTool(ink.preset) === 'brush';
  const points = resample(samples, brush ? Math.max(1.5, ink.width / 5) : 2);
  if (brush) {
    const outline = brushOutline(points, ink);
    return drawingPathNode(curveAnchors(outline, true, ink.preset === 'dry' ? 0.055 : 0.15), true, ink);
  }
  const pencil = points.length === 1 ? [points[0], { x: points[0].x + 0.02, y: points[0].y }]
    : points.map((point, index) => {
        if (ink.preset === 'smooth' || index === 0 || index === points.length - 1) return point;
        const normal = sampleNormal(points, index);
        const wave = ink.preset === 'wavy' ? Math.sin(index * 0.82) : 2 * grain(index) - 1;
        const offset = wave * Math.min(ink.width * 0.26, 3);
        return { x: point.x + normal.x * offset, y: point.y + normal.y * offset };
      });
  return drawingPathNode(curveAnchors(pencil, false, ink.preset === 'rough' ? 0.07 : 1 / 6), false, ink);
}

function resample(points: DrawingPoints, spacing: number): DrawingSample[] {
  const distances = [0];
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    const previous = points[index - 1];
    distances.push(distances[index - 1] + Math.hypot(point.x - previous.x, point.y - previous.y));
    if (point.x < points[left].x) left = index;
    if (point.x > points[right].x) right = index;
    if (point.y < points[top].y) top = index;
    if (point.y > points[bottom].y) bottom = index;
  }
  const length = distances[distances.length - 1];
  if (length === 0) return [points[0]];
  // Reserve half the path anchor limit for each side of a brush contour.
  const count = Math.min(Math.floor(maxDesignPathAnchors / 2), Math.max(3, Math.ceil(length / spacing) + 1));
  // Uniform samples alone can miss an entire flick that turns back to its starting point.
  const positions = new Set([0, length, distances[left], distances[right], distances[top], distances[bottom]]);
  const interior = count - positions.size;
  for (let index = 1; index <= interior; index++) positions.add(length * index / (interior + 1));
  let segment = 1;
  return [...positions].sort((a, b) => a - b).map((distance) => {
    while (segment < distances.length - 1 && distances[segment] <= distance) segment++;
    const before = points[segment - 1];
    const after = points[segment];
    const span = distances[segment] - distances[segment - 1];
    const amount = span ? (distance - distances[segment - 1]) / span : 0;
    const pressure = before.pressure === undefined && after.pressure === undefined ? undefined
      : (before.pressure ?? 0.5) * (1 - amount) + (after.pressure ?? 0.5) * amount;
    return { x: before.x + (after.x - before.x) * amount, y: before.y + (after.y - before.y) * amount, pressure };
  });
}

function sampleNormal(points: readonly Point[], index: number): Point {
  const before = points[Math.max(0, index - 1)];
  const after = points[Math.min(points.length - 1, index + 1)];
  const x = after.x - before.x;
  const y = after.y - before.y;
  const length = Math.hypot(x, y);
  return length ? { x: -y / length, y: x / length } : { x: 0, y: 1 };
}

function grain(index: number) {
  const noise = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return noise - Math.floor(noise);
}

function brushOutline(points: readonly DrawingSample[], { width, preset }: FreehandInk): Point[] {
  if (points.length === 1) {
    const [{ x, y, pressure }] = points;
    const radius = width / 2 * pressureScale(pressure);
    return [{ x: x + radius, y }, { x, y: y + radius }, { x: x - radius, y }, { x, y: y - radius }];
  }
  const left: Point[] = [];
  const right: Point[] = [];
  points.forEach((point, index) => {
    const normal = sampleNormal(points, index);
    const progress = index / (points.length - 1);
    const taper = Math.min(1, progress * 8, (1 - progress) * 6);
    const shape = preset === 'tapered' ? 0.18 + 0.82 * taper : 1;
    const radius = width / 2 * shape * pressureScale(point.pressure);
    const leftWidth = radius * (preset === 'dry' ? 0.62 + 0.38 * grain(index * 2) : 1);
    const rightWidth = radius * (preset === 'dry' ? 0.62 + 0.38 * grain(index * 2 + 1) : 1);
    left.push({ x: point.x + normal.x * leftWidth, y: point.y + normal.y * leftWidth });
    right.push({ x: point.x - normal.x * rightWidth, y: point.y - normal.y * rightWidth });
  });
  return [...left, ...right.reverse()];
}

function pressureScale(pressure: number | undefined) {
  return pressure === undefined ? 1 : 0.22 + 0.78 * Math.max(0, Math.min(1, pressure));
}

function curveAnchors(points: readonly Point[], closed: boolean, tension: number): DesignPathAnchor[] {
  return points.map((point, index) => {
    const before = points[index - 1] ?? (closed ? points[points.length - 1] : point);
    const after = points[index + 1] ?? (closed ? points[0] : point);
    const x = (after.x - before.x) * tension;
    const y = (after.y - before.y) * tension;
    return { ...point, incoming: closed || index > 0 ? { x: point.x - x, y: point.y - y } : undefined,
      outgoing: closed || index + 1 < points.length ? { x: point.x + x, y: point.y + y } : undefined };
  });
}
