import { designFrameFill, designTextFill, type DesignFill, type DesignNode, type DesignStroke } from '../contracts/index.js';

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
  const channel = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `${color}${channel}`;
}

export function designFills(node: DesignNode): readonly DesignFill[] {
  return node.kind === 'image' ? [] : node.fills ?? [{ color: node.kind === 'text' ? designTextFill : designFrameFill }];
}

export function visibleDesignStrokes(node: DesignNode): readonly DesignStroke[] {
  return node.strokes?.filter((stroke) => !stroke.hidden && stroke.opacity !== 0) ?? [];
}

export function designStrokePaint({ color, opacity, width, join }: DesignStroke) {
  return { stroke: colorWithOpacity(color, opacity), strokeWidth: width, lineJoin: join };
}

// Solid fills share the same geometry. Composite the stack once to keep edge and shadow opacity consistent.
export function compositeDesignFill(node: DesignNode): string {
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const fill of designFills(node)) {
    const opacity = fill.hidden ? 0 : fill.opacity ?? 1;
    const remaining = 1 - opacity;
    const rgb = Number.parseInt(fill.color.slice(1), 16);
    red = (rgb >> 16) * opacity + red * remaining;
    green = ((rgb >> 8) & 255) * opacity + green * remaining;
    blue = (rgb & 255) * opacity + blue * remaining;
    alpha = opacity + alpha * remaining;
  }
  if (!alpha) return 'transparent';
  return `rgba(${Math.round(red / alpha)}, ${Math.round(green / alpha)}, ${Math.round(blue / alpha)}, ${alpha})`;
}

export function layerCornerRadius(node: DesignNode, width: number, height: number): number | number[] {
  if (node.kind !== 'frame' && node.kind !== 'rectangle') return 0;
  const maximum = Math.min(width, height) / 2;
  return node.cornerRadii ? node.cornerRadii.map((radius) => Math.min(radius, maximum)) : Math.min(node.cornerRadius ?? 0, maximum);
}

export function layerPaint(node: DesignNode, stroke: DesignStroke | undefined): LayerPaint {
  const shadow = node.shadow?.hidden ? undefined : node.shadow;
  return {
    ...(stroke ? designStrokePaint(stroke) : undefined),
    shadowColor: shadow?.color,
    shadowBlur: shadow?.blur,
    shadowOffsetX: shadow?.x,
    shadowOffsetY: shadow?.y,
    shadowOpacity: shadow ? shadow.opacity ?? 0.38 : undefined,
  };
}
