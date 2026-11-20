import type { Shape, ShapeConfig } from 'konva/lib/Shape.js';
import type { RefCallback } from 'react';
import type { DesignFillImage, DesignNode, DesignPaint, DesignStroke } from '../../contracts/index.js';
import { colorWithOpacity, compositeDesignFill, designFills, designStrokeBounds, designStrokePaint, type LayerPaint } from '../design-paint.js';
import type { Bounds } from '../design-geometry.js';
import { designCanvasShaderRef, type DesignShaderRender } from '../shaders/design-canvas-shader.js';
import { designGradientAngle, designGradientGeometry } from './design-gradient-geometry.js';
import { angularGradient, designGradientTile } from './design-gradient-tile.js';

type CanvasFill = Pick<ShapeConfig, 'fill' | 'fillPriority' | 'fillLinearGradientStartPoint' | 'fillLinearGradientEndPoint'
  | 'fillLinearGradientColorStops' | 'fillRadialGradientStartPoint' | 'fillRadialGradientEndPoint'
  | 'fillRadialGradientEndRadius' | 'fillRadialGradientColorStops'
  | 'fillPatternImage' | 'fillPatternScale' | 'fillPatternX' | 'fillPatternY' | 'fillPatternRepeat' | 'opacity' | 'globalCompositeOperation'>
  & { shaderRef?: () => RefCallback<Shape> };
export type CanvasShaderFill = Readonly<{ render: DesignShaderRender; size: Pick<Bounds, 'width' | 'height'> }>;
export type DesignPaintImages = ReadonlyMap<string, HTMLImageElement>;
export const emptyDesignPaintImages: DesignPaintImages = new Map();
type CanvasStroke = Pick<ShapeConfig, 'stroke' | 'strokeWidth' | 'lineJoin' | 'strokeLinearGradientStartPoint'
  | 'strokeLinearGradientEndPoint' | 'strokeLinearGradientColorStops' | 'opacity' | 'globalCompositeOperation'> & { strokePattern?: CanvasPattern };
let paintContext: CanvasRenderingContext2D | null | undefined;

export function visibleDesignFills(node: DesignNode) {
  return designFills(node).filter((fill) => !fill.hidden && fill.opacity !== 0);
}

export function hasLayeredDesignPaint(node: DesignNode) {
  return node.kind !== 'image' && Boolean(node.fills?.some((fill) => !fill.hidden && fill.opacity !== 0
    && (fill.image || fill.shader || fill.blendMode && fill.blendMode !== 'normal')));
}

export function designGradientStops(paint: DesignPaint) {
  return paint.gradient?.stops.map(({ offset, color, opacity }) =>
    ({ offset, color: colorWithOpacity(color, (opacity ?? 1) * (paint.opacity ?? 1)) })).sort((a, b) => a.offset - b.offset) ?? [];
}

function imageTransform(fit: DesignFillImage['fit'], box: Bounds, image: HTMLImageElement) {
  const sx = box.width / image.naturalWidth;
  const sy = box.height / image.naturalHeight;
  const scale = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
  const x = fit === 'stretch' ? sx : scale;
  const y = fit === 'stretch' ? sy : scale;
  return { scale: { x, y }, x: box.x + (box.width - image.naturalWidth * x) / 2, y: box.y + (box.height - image.naturalHeight * y) / 2 };
}

function canvasFill(fill: DesignPaint, box: Bounds, images: DesignPaintImages, index: number, shader?: CanvasShaderFill): CanvasFill {
  const blend = fill.blendMode && fill.blendMode !== 'normal' ? { globalCompositeOperation: fill.blendMode } : undefined;
  const shaderPaint = fill.shader;
  if (shaderPaint) return { fill: 'transparent', opacity: fill.opacity, ...blend,
    shaderRef: shader && (() => designCanvasShaderRef({ paint: shaderPaint, index, images, ...shader })) };
  if (fill.image) {
    const image = images.get(fill.image.assetPath);
    if (!image) return { fill: 'transparent' };
    const { x, y, scale } = imageTransform(fill.image.fit, box, image);
    return { fillPriority: 'pattern', fillPatternImage: image, fillPatternRepeat: 'no-repeat', fillPatternScale: scale,
      fillPatternX: x, fillPatternY: y, opacity: fill.opacity, ...blend };
  }
  if (!fill.gradient) return { fill: colorWithOpacity(fill.color, fill.opacity), ...blend };
  const geometry = designGradientGeometry(fill.gradient, box);
  const stops = designGradientStops(fill);
  const { start, end, radius } = geometry;
  if (fill.gradient.kind === 'angular') {
    const context = designPaintContext();
    return { fill: context ? angularGradient(context, geometry, stops) : 'transparent', ...blend };
  }
  if (fill.gradient.kind === 'diamond') {
    const tile = designGradientTile(fill.gradient, stops, box);
    if (!tile) return { fill: 'transparent' };
    // Konva passes this source to createPattern, which also accepts a canvas.
    return { fillPriority: 'pattern', fillPatternImage: tile as unknown as HTMLImageElement, fillPatternRepeat: 'no-repeat',
      fillPatternX: box.x, fillPatternY: box.y, fillPatternScale: { x: box.width / tile.width, y: box.height / tile.height }, ...blend };
  }
  const colors = stops.flatMap(({ offset, color }) => [offset, color]);
  return fill.gradient.kind === 'linear'
    ? { fillPriority: 'linear-gradient', fillLinearGradientStartPoint: start, fillLinearGradientEndPoint: end, fillLinearGradientColorStops: colors, ...blend }
    : { fillPriority: 'radial-gradient', fillRadialGradientStartPoint: start, fillRadialGradientEndPoint: start,
        fillRadialGradientEndRadius: radius, fillRadialGradientColorStops: colors, ...blend };
}

export function designCanvasFillProps({ shaderRef, ...fill }: CanvasFill) {
  return { ...fill, ref: shaderRef?.() };
}

function designPaintContext() {
  return paintContext ??= document.createElement('canvas').getContext('2d');
}

export function designCanvasStroke(stroke: DesignStroke, bounds: Bounds, images: DesignPaintImages): CanvasStroke {
  const base = designStrokePaint(stroke);
  const blend = stroke.blendMode && stroke.blendMode !== 'normal' ? { globalCompositeOperation: stroke.blendMode } : undefined;
  if (stroke.image) {
    const image = images.get(stroke.image.assetPath);
    const pattern = image && designPaintContext()?.createPattern(image, 'no-repeat');
    if (image && pattern) {
      const { x, y, scale } = imageTransform(stroke.image.fit, bounds, image);
      pattern.setTransform({ a: scale.x, d: scale.y, e: x, f: y });
    }
    return { ...base, ...blend, stroke: 'transparent', strokePattern: pattern ?? undefined, opacity: stroke.opacity };
  }
  if (!stroke.gradient) return { ...base, ...blend };
  const geometry = designGradientGeometry(stroke.gradient, bounds);
  const { start, end, radius } = geometry;
  const stops = designGradientStops(stroke);
  if (stroke.gradient.kind === 'linear') {
    return { ...base, ...blend, strokeLinearGradientStartPoint: start, strokeLinearGradientEndPoint: end,
      strokeLinearGradientColorStops: stops.flatMap(({ offset, color }) => [offset, color]) };
  }
  const context = designPaintContext();
  if (stroke.gradient.kind === 'diamond') {
    const tile = designGradientTile(stroke.gradient, stops, bounds);
    const pattern = tile && context?.createPattern(tile, 'no-repeat');
    if (tile && pattern) pattern.setTransform({ a: bounds.width / tile.width, d: bounds.height / tile.height, e: bounds.x, f: bounds.y });
    return { ...base, ...blend, stroke: 'transparent', strokePattern: pattern ?? undefined };
  }
  if (stroke.gradient.kind === 'angular' && context) return { ...base, ...blend, stroke: angularGradient(context, geometry, stops) };
  const gradient = context?.createRadialGradient(start.x, start.y, 0, start.x, start.y, radius);
  for (const { offset, color } of stops) gradient?.addColorStop(offset, color);
  return { ...base, ...blend, stroke: gradient ?? base.stroke };
}

export function designStrokePatternRef(pattern: CanvasPattern | undefined): RefCallback<Shape> | undefined {
  if (!pattern) return;
  let restore: (() => void) | undefined;
  return (shape) => {
    restore?.();
    restore = undefined;
    if (!shape) return;
    // Konva accepts gradients as stroke values. Apply patterns at the stroke draw step to retain its path and glyph handling.
    const draw = shape._strokeFunc;
    shape._strokeFunc = function (context) {
      context.setAttr('strokeStyle', pattern);
      draw.call(this, context);
    };
    restore = () => { shape._strokeFunc = draw; };
  };
}

export function designCanvasFills(node: DesignNode, box: Bounds, images = emptyDesignPaintImages, shader?: CanvasShaderFill): CanvasFill[] {
  const fills = designFills(node);
  if (!visibleDesignFills(node).some((fill) => fill.gradient) && !hasLayeredDesignPaint(node)) return [{ fill: compositeDesignFill(node) }];
  return fills.flatMap((fill, index) => fill.hidden || fill.opacity === 0 ? [] : [canvasFill(fill, box, images, index, shader)]);
}

export function designPaintAt(paint: LayerPaint, index: number, length: number): LayerPaint {
  if (length === 1) return paint;
  const { stroke, strokeWidth, lineJoin, ...shadow } = paint;
  if (!index) return shadow;
  return index === length - 1 ? { stroke, strokeWidth, lineJoin } : {};
}

export function designCanvasPaintLayers(fills: readonly CanvasFill[], paint: LayerPaint, outlines: readonly DesignStroke[], box: Bounds, images: DesignPaintImages, scale = 1):
  (CanvasFill & Omit<LayerPaint, 'stroke'> & CanvasStroke & { fillEnabled?: boolean })[] {
  return [
    ...fills.map((fill, index) => ({ ...fill, ...designPaintAt(paint, index, fills.length) })),
    ...outlines.map((stroke) => ({ ...designCanvasStroke(stroke, designStrokeBounds(box, stroke.width / scale), images), fillEnabled: false })),
  ];
}

type PaintSize = Pick<Bounds, 'width' | 'height'>;

export function designCssBackground(node: DesignNode, size: PaintSize) {
  const visible = visibleDesignFills(node);
  if (!visible.some(({ gradient }) => gradient)) return compositeDesignFill(node);
  return visible.reverse().map((fill) => {
    if (!fill.gradient) {
      const color = colorWithOpacity(fill.color, fill.opacity);
      return `linear-gradient(${color}, ${color})`;
    }
    return designCssFill(fill, size);
  }).join(', ');
}

export function designCssFill(fill: DesignPaint, size: PaintSize = { width: 14, height: 14 }) {
  const { gradient } = fill;
  if (!gradient) return colorWithOpacity(fill.color, fill.opacity);
  if (size.width <= 0 || size.height <= 0) return 'transparent';
  const stops = designGradientStops(fill);
  const css = stops.map(({ offset, color }) => `${color} ${offset * 100}%`).join(', ');
  if (gradient.kind === 'linear' && !gradient.axis) return `linear-gradient(${gradient.angle ?? 90}deg, ${css})`;
  if (gradient.kind === 'radial' && !gradient.axis) return `radial-gradient(circle farthest-corner at center, ${css})`;
  if (gradient.kind === 'diamond') {
    const tile = designGradientTile(gradient, stops, size, Math.min(1024, Math.ceil(Math.max(size.width, size.height))));
    return tile ? `center / 100% 100% no-repeat url("${tile.toDataURL()}")` : 'transparent';
  }
  const geometry = designGradientGeometry(gradient, { ...size, x: 0, y: 0 });
  const { start, radius, radians } = geometry;
  const center = `${start.x / size.width * 100}% ${start.y / size.height * 100}%`;
  const angle = designGradientAngle(geometry);
  if (gradient.kind === 'angular') return `conic-gradient(from ${angle}deg at ${center}, ${css})`;
  if (gradient.kind === 'radial') return `radial-gradient(circle ${radius}px at ${center}, ${css})`;
  // CSS spans the box at this angle. Place the edited axis within that span.
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const length = Math.abs(dx) * size.width + Math.abs(dy) * size.height;
  const origin = (start.x - size.width / 2) * dx + (start.y - size.height / 2) * dy + length / 2;
  const positioned = stops.map(({ offset, color }) => `${color} ${(origin + radius * offset) / length * 100}%`).join(', ');
  return `linear-gradient(${angle}deg, ${positioned})`;
}
