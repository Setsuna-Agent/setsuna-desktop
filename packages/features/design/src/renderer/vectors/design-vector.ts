import type { DesignNode, DesignPathAnchor, DesignPathGeometry, DesignSvgPath, DesignSvgViewBox, DesignVector, DesignVectorGeometry } from '../../contracts/index.js';
import { type Bounds, type Point, roundDesignValue } from '../design-geometry.js';
import { designIconPaths, designIconSize } from './design-icon-paths.js';

export function isDesignPath(node: DesignNode | undefined): node is DesignVector & { geometry: DesignPathGeometry } {
  return node?.kind === 'vector' && node.geometry.kind === 'path';
}

export function designLucideIcon(geometry: DesignVectorGeometry): string | undefined {
  return geometry.kind === 'icon' || geometry.kind === 'svg' ? geometry.icon : undefined;
}

export function designVectorPathFill(path: DesignSvgPath, fill: string, stroke: string | undefined) {
  return path.fillFromStroke && fill === 'transparent' ? stroke ?? fill : fill;
}

export function mapPathAnchors(anchors: readonly DesignPathAnchor[], transform: (point: Point) => Point): DesignPathAnchor[] {
  return anchors.map((anchor) => ({
    ...transform(anchor), incoming: anchor.incoming && transform(anchor.incoming), outgoing: anchor.outgoing && transform(anchor.outgoing),
  }));
}

export function designPathData(anchors: readonly DesignPathAnchor[], closed = false) {
  if (!anchors.length) return '';
  const coordinates = ({ x, y }: Point) => `${Number(x.toFixed(4))} ${Number(y.toFixed(4))}`;
  const commands = [`M${coordinates(anchors[0])}`];
  for (let index = 0; index < anchors.length - (closed ? 0 : 1); index++) {
    const from = anchors[index];
    const to = anchors[(index + 1) % anchors.length];
    if (from.outgoing || to.incoming) commands.push(`C${coordinates(from.outgoing ?? from)} ${coordinates(to.incoming ?? to)} ${coordinates(to)}`);
    else if (index < anchors.length - 1) commands.push(`L${coordinates(to)}`);
  }
  if (closed) commands.push('Z');
  return commands.join(' ');
}

export function designPolygonPath(width: number, height: number, sides: number) {
  const vertices = Array.from({ length: sides }, (_, index) => {
    const angle = index * Math.PI * 2 / sides - Math.PI / 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  const { x, y, width: spanX, height: spanY } = pointBounds(vertices);
  return designPathData(vertices.map((point) => ({ x: (point.x - x) * width / spanX, y: (point.y - y) * height / spanY })), true);
}

export function designVectorShape(geometry: DesignVectorGeometry, width: number, height: number): Readonly<{
  viewBox: DesignSvgViewBox;
  paths: readonly DesignSvgPath[];
  scaleX: number;
  scaleY: number;
}> {
  if (geometry.kind === 'svg') return { ...geometry, scaleX: width / geometry.viewBox.width, scaleY: height / geometry.viewBox.height };
  if (geometry.kind === 'icon') return {
    viewBox: { x: 0, y: 0, width: designIconSize, height: designIconSize },
    paths: [{ data: designIconPaths[geometry.icon], lineCap: 'round' }],
    scaleX: width / designIconSize, scaleY: height / designIconSize,
  };
  const data = geometry.kind === 'polygon' ? designPolygonPath(width, height, geometry.sides)
    : designPathData(mapPathAnchors(geometry.anchors, ({ x, y }) => ({ x: x * width, y: y * height })), geometry.closed);
  return { viewBox: { x: 0, y: 0, width, height }, paths: [{ data, lineCap: 'round' }], scaleX: 1, scaleY: 1 };
}

export function fitDesignPath(anchors: readonly DesignPathAnchor[], closed: boolean): Readonly<{ bounds: Bounds; geometry: DesignPathGeometry }> {
  const bounds = pathBounds(anchors, closed);
  const { x, y } = bounds;
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  return {
    bounds: { x: roundDesignValue(x), y: roundDesignValue(y), width: roundDesignValue(width), height: roundDesignValue(height) },
    geometry: { kind: 'path', closed, anchors: mapPathAnchors(anchors, (point) => ({ x: (point.x - x) / width, y: (point.y - y) / height })) },
  };
}

function pointBounds(points: readonly Point[]): Bounds {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function pathBounds(anchors: readonly DesignPathAnchor[], closed: boolean): Bounds {
  const points: Point[] = [...anchors];
  for (let index = 0; index < anchors.length - (closed ? 0 : 1); index++) {
    const start = anchors[index];
    const end = anchors[(index + 1) % anchors.length];
    if (!start.outgoing && !end.incoming) continue;
    const from = start.outgoing ?? start;
    const to = end.incoming ?? end;
    const extrema = [...cubicExtrema(start.x, from.x, to.x, end.x), ...cubicExtrema(start.y, from.y, to.y, end.y)];
    for (const t of extrema) {
      const u = 1 - t;
      const at = (a: number, b: number, c: number, d: number) => u ** 3 * a + 3 * u ** 2 * t * b + 3 * u * t ** 2 * c + t ** 3 * d;
      points.push({ x: at(start.x, from.x, to.x, end.x), y: at(start.y, from.y, to.y, end.y) });
    }
  }
  return pointBounds(points);
}

function cubicExtrema(start: number, from: number, to: number, end: number): number[] {
  // The derivative's roots are the interior extrema of a cubic Bézier segment.
  const a = -start + 3 * from - 3 * to + end;
  const b = 2 * (start - 2 * from + to);
  const c = from - start;
  const discriminant = b * b - 4 * a * c;
  const roots = Math.abs(a) < 1e-9 ? [-c / b]
    : discriminant >= 0 ? [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)] : [];
  return roots.filter((t) => t > 0 && t < 1);
}
