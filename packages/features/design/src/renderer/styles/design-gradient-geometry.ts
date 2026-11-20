import type { DesignGradient, DesignGradientAxis, DesignNode } from '../../contracts/index.js';
import { rotatePoint, type Bounds, type Point } from '../design-geometry.js';
import { designStrokeBounds } from '../design-paint.js';
import { designVectorShape } from '../vectors/design-vector.js';

export type DesignGradientTarget = Readonly<{ layerId: string; stack: 'fills' | 'strokes'; index: number }>;
export type DesignGradientGeometry = DesignGradientAxis & Readonly<{ radius: number; radians: number }>;
type Size = Pick<Bounds, 'width' | 'height'>;
const fullTurn = 2 * Math.PI;

export function designGradientGeometry(gradient: DesignGradient, bounds: Bounds): DesignGradientGeometry {
  const { x, y, width, height } = bounds;
  const axis = gradient.axis;
  if (axis) {
    const start = { x: x + axis.start.x * width, y: y + axis.start.y * height };
    const end = { x: x + axis.end.x * width, y: y + axis.end.y * height };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const radius = Math.hypot(dx, dy);
    if (radius > 0 && Number.isFinite(radius)) return { start, end, radius, radians: Math.atan2(dy, dx) };
  }
  const center = { x: x + width / 2, y: y + height / 2 };
  const radians = ((gradient.angle ?? (gradient.kind === 'angular' ? 0 : 90)) - 90) * Math.PI / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const span = gradient.kind === 'linear' ? (Math.abs(dx) * width + Math.abs(dy) * height) / 2 : Math.hypot(width, height) / 2;
  const start = gradient.kind === 'linear' ? { x: center.x - dx * span, y: center.y - dy * span } : center;
  return { start, end: { x: center.x + dx * span, y: center.y + dy * span },
    radius: gradient.kind === 'linear' ? span * 2 : span, radians };
}

export function designGradientPaintSpace(node: DesignNode, { width, height }: Size, { stack, index }: DesignGradientTarget) {
  const vector = node.kind === 'vector' && (node.geometry.kind === 'icon' || node.geometry.kind === 'svg')
    ? designVectorShape(node, width, height) : undefined;
  const shape = vector?.viewBox ?? { x: 0, y: 0, width, height };
  const stroke = stack === 'strokes' ? node.strokes?.[index] : undefined;
  const scale = vector ? Math.max(vector.scaleX, vector.scaleY) : 1;
  const bounds = stroke ? designStrokeBounds(shape, stroke.width / (scale || 1),
    node.kind === 'vector' || node.kind === 'text' ? 'center' : stroke.alignment) : shape;
  return { shape, bounds };
}

export function changeDesignGradientKind(gradient: DesignGradient, kind: DesignGradient['kind']): DesignGradient {
  const { axis } = gradient;
  if (!axis || (kind === 'linear') === (gradient.kind === 'linear')) return { ...gradient, kind };
  const { start, end } = axis;
  return { ...gradient, kind, axis: { end, start: kind === 'linear'
    ? { x: 2 * start.x - end.x, y: 2 * start.y - end.y }
    : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } } };
}

export function designGradientWithAxis(gradient: DesignGradient, { start, end }: DesignGradientAxis, bounds: Bounds): DesignGradient {
  if (bounds.width <= 0 || bounds.height <= 0) return gradient;
  const normalize = (point: Point) => ({ x: (point.x - bounds.x) / bounds.width, y: (point.y - bounds.y) / bounds.height });
  return { ...gradient, axis: { start: normalize(start), end: normalize(end) } };
}

export function designGradientAngle({ radians }: DesignGradientGeometry) {
  const angle = Math.round((radians * 180 / Math.PI + 90) * 100) / 100;
  return (angle + 360) % 360;
}

export function rotateDesignGradient(gradient: DesignGradient, bounds: Bounds, angle: number): DesignGradient {
  if (!gradient.axis) return { ...gradient, angle };
  const { start, end, radians } = designGradientGeometry(gradient, bounds);
  const pivot = gradient.kind === 'linear' ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } : start;
  const turn = angle - 90 - radians * 180 / Math.PI;
  const rotate = (point: Point) => {
    const vector = rotatePoint({ x: point.x - pivot.x, y: point.y - pivot.y }, turn);
    return { x: pivot.x + vector.x, y: pivot.y + vector.y };
  };
  return designGradientWithAxis(gradient, { start: rotate(start), end: rotate(end) }, bounds);
}

export function designGradientStopPoint(geometry: DesignGradientGeometry, angular: boolean, offset: number): Point {
  const { start, end, radius, radians } = geometry;
  if (!angular) return { x: start.x + (end.x - start.x) * offset, y: start.y + (end.y - start.y) * offset };
  const angle = radians + offset * fullTurn;
  return { x: start.x + Math.cos(angle) * radius, y: start.y + Math.sin(angle) * radius };
}

export function designGradientStopOffset(geometry: DesignGradientGeometry, angular: boolean, point: Point, previous: number) {
  const dx = point.x - geometry.start.x;
  const dy = point.y - geometry.start.y;
  let offset = (dx * Math.cos(geometry.radians) + dy * Math.sin(geometry.radians)) / geometry.radius;
  if (angular) {
    const phase = (Math.atan2(dy, dx) - geometry.radians) / fullTurn;
    // Unwrap against the previous position so the seam doesn't flip a stop between 0 and 100.
    offset = phase + Math.round(previous - phase);
  }
  return Math.round(Math.max(0, Math.min(1, offset)) * 100) / 100;
}
