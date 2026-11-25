import {
  designBlendModes, designTextAlignments, maxDesignFills, maxDesignGradientStops, maxDesignStrokes,
  type DesignGradient, type DesignLayout, type DesignPaint, type DesignQuad, type DesignShadow, type DesignStroke, type DesignTypography,
} from '../../../contracts/document.js';
import { designDefaultColor } from '../../../contracts/design-color.js';
import { isDesignFontName, isDesignFontWeight } from '../../../contracts/design-fonts.js';
import { rotatePoint } from '../../design-geometry.js';
import { penNumber, penObject, penOpacity, penPositive, penSpacing, type PenObject, type ReadPenValue } from './values.js';

export function penLayout(node: PenObject, read: ReadPenValue): DesignLayout | undefined {
  if (node.type === 'group' || node.layout === 'none') return;
  const { alignItems, justifyContent } = node;
  const padding = read(node.padding);
  const paddingOptions = Array.isArray(padding) ? padding.map((side) => penSpacing(read(side))) : [];
  const [top, right, bottom, left] = paddingOptions;
  return {
    direction: node.layout === 'vertical' ? 'vertical' : 'horizontal', gap: penSpacing(read(node.gap)), padding: penSpacing(padding),
    ...(paddingOptions.length === 2 ? { paddingY: top, paddingX: right } : undefined),
    ...(paddingOptions.length === 4 ? { paddingSides: [top, right, bottom, left] } : undefined),
    align: alignItems === 'center' || alignItems === 'end' ? alignItems : 'start',
    justify: justifyContent === 'space_between' ? 'space-between' : justifyContent === 'space_around' ? 'space-around'
      : justifyContent === 'center' || justifyContent === 'end' ? justifyContent : undefined,
  };
}

export function penCorners(value: unknown, read: ReadPenValue): { cornerRadius: number; cornerRadii?: DesignQuad } {
  if (!Array.isArray(value) || value.length !== 4) return { cornerRadius: penSpacing(read(value)) };
  const [topLeft, topRight, bottomRight, bottomLeft] = value.map((corner) => penSpacing(read(corner)));
  return { cornerRadius: 0, cornerRadii: [topLeft, topRight, bottomRight, bottomLeft] };
}

export function penTypography(node: PenObject, read: ReadPenValue): DesignTypography {
  const family = read(node.fontFamily);
  const weight = read(node.fontWeight);
  const fontWeight = weight === 'normal' ? 400 : weight === 'bold' ? 700 : typeof weight === 'string' ? Number(weight) : weight;
  const style = read(node.fontStyle);
  return {
    fontSize: penPositive(read(node.fontSize)) ?? 16,
    fontFamily: isDesignFontName(family) ? family : undefined,
    fontWeight: isDesignFontWeight(fontWeight) ? fontWeight : undefined,
    fontStyle: style === 'italic' || style === 'oblique' ? 'italic' : undefined,
    lineHeight: penPositive(read(node.lineHeight)), letterSpacing: penNumber(read(node.letterSpacing)),
    textAlign: designTextAlignments.find((alignment) => alignment === node.textAlign),
  };
}

function penColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/iu.test(value)) return value;
  if (/^#[\da-f]{3,4}$/iu.test(value)) return '#' + [...value.slice(1)].map((digit) => digit.repeat(2)).join('');
}

function toList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function penGradient(paint: PenObject, read: ReadPenValue): DesignGradient | undefined {
  if (!Array.isArray(paint.colors)) return;
  const stops = paint.colors.slice(0, maxDesignGradientStops).flatMap((entry) => {
    const stop = penObject(entry);
    const color = penColor(read(stop?.color));
    const offset = penOpacity(read(stop?.position));
    return color !== undefined && offset !== undefined ? [{ color, offset }] : [];
  });
  if (stops.length < 2) return;
  const kind = paint.gradientType === 'radial' || paint.gradientType === 'angular' ? paint.gradientType : 'linear';
  const center = penObject(paint.center);
  const x = penNumber(read(center?.x)) ?? 0.5;
  const y = penNumber(read(center?.y)) ?? 0.5;
  const rotation = penNumber(read(paint.rotation)) ?? 0;
  const radius = (penPositive(read(penObject(paint.size)?.height)) ?? 1) / 2;
  const direction = rotatePoint({ x: 0, y: -radius }, -rotation);
  const start = kind === 'linear' ? { x: x - direction.x, y: y - direction.y } : { x, y };
  const end = { x: x + direction.x, y: y + direction.y };
  return { kind, stops, axis: start.x === end.x && start.y === end.y ? undefined : { start, end } };
}

function penPaints(value: unknown, read: ReadPenValue, limit: number): DesignPaint[] {
  return toList(value).slice(0, limit).flatMap((item) => {
    const entry = penObject(item);
    if (!entry) {
      const color = penColor(read(item));
      return color ? [{ color }] : [];
    }
    const gradient = entry.type === 'gradient' ? penGradient(entry, read) : undefined;
    const color = entry.type === 'color' ? penColor(read(entry.color)) : gradient && designDefaultColor;
    if (!color) return [];
    const blendMode = typeof entry.blendMode === 'string' ? entry.blendMode.replace(/[A-Z]/gu, (letter) => '-' + letter.toLowerCase()) : undefined;
    return [{ color, gradient, blendMode: designBlendModes.find((mode) => mode === blendMode),
      hidden: read(entry.enabled) === false || undefined, opacity: penOpacity(read(entry.opacity)) }];
  });
}

export function penFills(value: unknown, read: ReadPenValue) {
  return value === undefined ? undefined : penPaints(value, read, maxDesignFills);
}

export function penStrokes(node: PenObject, read: ReadPenValue): DesignStroke[] | undefined {
  if (node.stroke === undefined) return;
  const legacy = penObject(node.stroke);
  const paints = penPaints(legacy?.fill ?? node.stroke, read, maxDesignStrokes);
  const thickness = read(node.strokeWidth ?? legacy?.thickness);
  const sides = penObject(thickness);
  const width = sides ? Math.max(...['top', 'right', 'bottom', 'left'].map((side) => penSpacing(read(sides[side])))) : penNumber(thickness) ?? 1;
  if (width <= 0) return;
  const align = node.strokeAlignment ?? legacy?.align;
  const alignment = align === 'inner' || align === 'inside' ? 'inside' : align === 'outer' || align === 'outside' ? 'outside' : 'center';
  const join = node.strokeLinejoin ?? legacy?.join;
  return paints.map((paint) => ({ ...paint, width, alignment, join: join === 'bevel' || join === 'round' ? join : undefined }));
}

export function penShadow(value: unknown, read: ReadPenValue): DesignShadow | undefined {
  for (const item of toList(value)) {
    const effect = penObject(item);
    if (effect?.type !== 'shadow' || effect.shadowType === 'inner' || read(effect.enabled) === false) continue;
    const offset = penObject(effect.offset);
    return { color: penColor(read(effect.color)) ?? '#00000040', opacity: 1, blur: penSpacing(read(effect.blur)),
      x: penNumber(read(offset?.x)) ?? 0, y: penNumber(read(offset?.y)) ?? 0 };
  }
}
