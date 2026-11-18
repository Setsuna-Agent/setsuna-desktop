import type { ShapeConfig } from 'konva/lib/Shape.js';
import type { DesignFill, DesignGradient, DesignNode, DesignStroke } from '../../contracts/index.js';
import { colorWithOpacity, compositeDesignFill, designFills, designStrokePaint, type LayerPaint } from '../design-paint.js';
import type { Bounds } from '../design-geometry.js';

export type CanvasFill = { fill?: string } & Pick<ShapeConfig, 'fillPriority' | 'fillLinearGradientStartPoint' | 'fillLinearGradientEndPoint'
  | 'fillLinearGradientColorStops' | 'fillRadialGradientStartPoint' | 'fillRadialGradientEndPoint'
  | 'fillRadialGradientEndRadius' | 'fillRadialGradientColorStops'
  | 'fillPatternImage' | 'fillPatternScale' | 'fillPatternX' | 'fillPatternY' | 'fillPatternRepeat' | 'opacity' | 'globalCompositeOperation'>;
export type DesignPaintImages = ReadonlyMap<string, HTMLImageElement>;
export const emptyDesignPaintImages: DesignPaintImages = new Map();

export function designGradientGeometry(gradient: DesignGradient, { x, y, width, height }: Bounds) {
  const center = { x: x + width / 2, y: y + height / 2 };
  const radians = (gradient.angle ?? 90) * Math.PI / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const span = (Math.abs(dx) * width + Math.abs(dy) * height) / 2;
  return { center, radius: Math.hypot(width, height) / 2,
    start: { x: center.x - dx * span, y: center.y - dy * span }, end: { x: center.x + dx * span, y: center.y + dy * span } };
}

export function visibleDesignFills(node: DesignNode) {
  return designFills(node).filter((fill) => !fill.hidden && fill.opacity !== 0);
}

export function hasLayeredDesignPaint(node: DesignNode) {
  return node.kind !== 'image' && Boolean(node.fills?.some((fill) => !fill.hidden && fill.opacity !== 0
    && (fill.image || fill.blendMode && fill.blendMode !== 'normal')));
}

export function designGradientStops(fill: DesignFill) {
  return fill.gradient?.stops.map(({ offset, color, opacity }) =>
    ({ offset, color: colorWithOpacity(color, (opacity ?? 1) * (fill.opacity ?? 1)) })) ?? [];
}

function canvasFill(fill: DesignFill, box: Bounds, images: DesignPaintImages): CanvasFill {
  const blend = fill.blendMode && fill.blendMode !== 'normal' ? { globalCompositeOperation: fill.blendMode } : undefined;
  if (fill.image) {
    const image = images.get(fill.image.assetPath);
    if (!image) return { fill: 'transparent' };
    const { x, y, width, height } = box;
    const sx = width / image.naturalWidth;
    const sy = height / image.naturalHeight;
    const scale = fill.image.fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
    const fillPatternScale = fill.image.fit === 'stretch' ? { x: sx, y: sy } : { x: scale, y: scale };
    return { fillPriority: 'pattern', fillPatternImage: image, fillPatternRepeat: 'no-repeat', fillPatternScale,
      fillPatternX: x + (width - image.naturalWidth * fillPatternScale.x) / 2,
      fillPatternY: y + (height - image.naturalHeight * fillPatternScale.y) / 2, opacity: fill.opacity, ...blend };
  }
  if (!fill.gradient) return { fill: colorWithOpacity(fill.color, fill.opacity), ...blend };
  const { center, radius, start, end } = designGradientGeometry(fill.gradient, box);
  const stops = designGradientStops(fill).flatMap(({ offset, color }) => [offset, color]);
  return fill.gradient.kind === 'linear'
    ? { fillPriority: 'linear-gradient', fillLinearGradientStartPoint: start, fillLinearGradientEndPoint: end, fillLinearGradientColorStops: stops, ...blend }
    : { fillPriority: 'radial-gradient', fillRadialGradientStartPoint: center, fillRadialGradientEndPoint: center,
        fillRadialGradientEndRadius: radius, fillRadialGradientColorStops: stops, ...blend };
}

export function designCanvasFills(node: DesignNode, box: Bounds, images = emptyDesignPaintImages): CanvasFill[] {
  const visible = visibleDesignFills(node);
  return visible.some((fill) => fill.gradient) || hasLayeredDesignPaint(node) && visible.length > 0
    ? visible.map((fill) => canvasFill(fill, box, images)) : [{ fill: compositeDesignFill(node) }];
}

export function designPaintAt(paint: LayerPaint, index: number, length: number): LayerPaint {
  if (length === 1) return paint;
  const { stroke, strokeWidth, lineJoin, ...shadow } = paint;
  if (!index) return shadow;
  return index === length - 1 ? { stroke, strokeWidth, lineJoin } : {};
}

export function designCanvasPaintLayers(fills: readonly CanvasFill[], paint: LayerPaint, outlines: readonly DesignStroke[]):
  (CanvasFill & LayerPaint & { fillEnabled?: boolean })[] {
  return [
    ...fills.map((fill, index) => ({ ...fill, ...designPaintAt(paint, index, fills.length) })),
    ...outlines.map((stroke) => ({ ...designStrokePaint(stroke), fillEnabled: false })),
  ];
}

export function designCssBackground(node: DesignNode) {
  const visible = visibleDesignFills(node);
  if (!visible.some(({ gradient }) => gradient)) return compositeDesignFill(node);
  return visible.reverse().map((fill) => {
    if (!fill.gradient) {
      const color = colorWithOpacity(fill.color, fill.opacity);
      return `linear-gradient(${color}, ${color})`;
    }
    return designCssFill(fill);
  }).join(', ');
}

export function designCssFill(fill: DesignFill) {
  if (!fill.gradient) return colorWithOpacity(fill.color, fill.opacity);
  const stops = designGradientStops(fill).map(({ offset, color }) => `${color} ${offset * 100}%`).join(', ');
  return fill.gradient.kind === 'linear' ? `linear-gradient(${fill.gradient.angle ?? 90}deg, ${stops})`
    : `radial-gradient(circle farthest-corner at center, ${stops})`;
}
