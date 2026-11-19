import type { DesignFill, DesignNode, DesignStroke } from '../contracts/index.js';
import { designColorWithAlpha, designDefaultColor, splitDesignColor } from '../contracts/design-color.js';
import type { Bounds } from './design-geometry.js';

export const defaultDesignStroke: DesignStroke = { color: designDefaultColor, width: 1 };

export type DesignPaintPreview = Readonly<{ revision: string; nodes: ReadonlyMap<string, DesignNode> }>;

export type LayerPaint = Readonly<{
  stroke?: string;
  strokeWidth?: number;
  lineJoin?: DesignStroke['join'];
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
}>;

export function colorWithOpacity(color: string, opacity = 1): string {
  if (opacity === 1) return color;
  return designColorWithAlpha(color, splitDesignColor(color).opacity * opacity);
}

export function designFills(node: DesignNode): readonly DesignFill[] {
  if (node.kind === 'image') return [];
  return node.fills ?? (node.kind === 'text' ? [{ color: designDefaultColor }] : []);
}

export function visibleDesignStrokes(node: DesignNode): readonly DesignStroke[] {
  const strokes = node.strokes?.filter((stroke) => !stroke.hidden && stroke.opacity !== 0) ?? [];
  return defaultDesignStrokeJoin(node) === 'round' ? strokes.map((stroke) => stroke.join ? stroke : { ...stroke, join: 'round' }) : strokes;
}

export function defaultDesignStrokeJoin(node: DesignNode): NonNullable<DesignStroke['join']> {
  return node.kind === 'vector' && node.geometry.kind === 'path' && node.geometry.endMarker === 'arrow' ? 'round' : 'miter';
}

export function designStrokePaint({ color, opacity, width, join }: DesignStroke) {
  return { stroke: colorWithOpacity(color, opacity), strokeWidth: width, lineJoin: join };
}

export function designStrokeNeedsSeparateLayer(stroke: DesignStroke | undefined): boolean {
  return Boolean(stroke && (stroke.gradient || stroke.image || stroke.blendMode && stroke.blendMode !== 'normal'));
}

export function designStrokeOutset(width: number, alignment: DesignStroke['alignment']) {
  return alignment === 'inside' ? 0 : alignment === 'outside' ? width : width / 2;
}

export function designStrokeBounds(bounds: Bounds, width: number, alignment?: DesignStroke['alignment']): Bounds {
  const outset = designStrokeOutset(width, alignment);
  return { x: bounds.x - outset, y: bounds.y - outset, width: bounds.width + outset * 2, height: bounds.height + outset * 2 };
}

// Solid fills share the same geometry. Composite the stack once to keep edge and shadow opacity consistent.
export function compositeDesignFill(node: DesignNode): string {
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const fill of designFills(node)) {
    if (fill.shader) continue;
    const paint = splitDesignColor(fill.color);
    const opacity = fill.hidden ? 0 : paint.opacity * (fill.opacity ?? 1);
    const remaining = 1 - opacity;
    const rgb = Number.parseInt(paint.color.slice(1), 16);
    red = (rgb >> 16) * opacity + red * remaining;
    green = ((rgb >> 8) & 255) * opacity + green * remaining;
    blue = (rgb & 255) * opacity + blue * remaining;
    alpha = opacity + alpha * remaining;
  }
  if (!alpha) return 'transparent';
  return `rgba(${Math.round(red / alpha)}, ${Math.round(green / alpha)}, ${Math.round(blue / alpha)}, ${alpha})`;
}

export function hasDesignCorners(node: DesignNode): node is Extract<DesignNode, { kind: 'frame' | 'rectangle' | 'web' }> {
  return node.kind === 'frame' || node.kind === 'rectangle' || node.kind === 'web';
}

export function layerCornerRadius(node: DesignNode, width: number, height: number): number | number[] {
  if (!hasDesignCorners(node)) return 0;
  const maximum = Math.min(width, height) / 2;
  return node.cornerRadii ? node.cornerRadii.map((radius) => Math.min(radius, maximum)) : Math.min(node.cornerRadius ?? 0, maximum);
}

export function layerPaint(node: DesignNode, stroke: DesignStroke | undefined): LayerPaint {
  const shadow = node.shadow?.hidden ? undefined : node.shadow;
  const paint = shadow && splitDesignColor(shadow.color);
  return {
    ...(stroke ? designStrokePaint(stroke) : undefined),
    shadowColor: paint?.color,
    shadowBlur: shadow?.blur,
    shadowOffsetX: shadow?.x,
    shadowOffsetY: shadow?.y,
    shadowOpacity: shadow && paint ? (shadow.opacity ?? 0.38) * paint.opacity : undefined,
  };
}
