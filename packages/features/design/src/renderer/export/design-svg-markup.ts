import type { DesignNode, DesignPaint, DesignShadow, DesignStroke, DesignSvgPath, DesignText } from '../../contracts/index.js';
import { splitDesignColor } from '../../contracts/design-color.js';
import type { Bounds } from '../design-geometry.js';
import { colorWithOpacity, compositeDesignFill, designStrokeBounds, visibleDesignStrokes } from '../design-paint.js';
import { createPlainDesignText, designHanTextBaselines, designTextStyle } from '../design-text.js';
import { designGradientGeometry } from '../styles/design-gradient-geometry.js';
import { designGradientTile } from '../styles/design-gradient-tile.js';
import { designGradientStops, hasLayeredDesignPaint, visibleDesignFills, type DesignPaintImages } from '../styles/design-gradients.js';
import { designVectorPathFill } from '../vectors/design-vector.js';
import { layoutRichDesignText } from '../text/design-rich-text.js';

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeDesignMarkup = (text: string) => text.replace(/[&<>"']/gu, (match) => entities[match]);
export const svgNumber = (value: number) => Number(value.toFixed(4));

export function svgAttributes(values: Readonly<Record<string, string | number | undefined>>) {
  return Object.entries(values).flatMap(([name, value]) =>
    value === undefined ? [] : [` ${name}="${escapeDesignMarkup(typeof value === 'number' ? String(svgNumber(value)) : value)}"`]).join('');
}

export function svgPathMarkup(path: DesignSvgPath, values: Readonly<Record<string, string | number | undefined>> = {}) {
  return `<path${svgAttributes({
    d: path.data, transform: path.transform ? `matrix(${path.transform.map(svgNumber).join(' ')})` : undefined,
    'fill-rule': path.fillRule, 'stroke-linecap': path.lineCap, 'stroke-dasharray': path.dash?.join(' '),
    'stroke-dashoffset': path.dash?.length ? path.dashOffset : undefined, ...values,
  })}/>`;
}

type SvgFill = Readonly<{ fill: string; 'fill-opacity'?: number; style?: string }>;
type SvgStroke = Readonly<{ stroke: string; 'stroke-width': number; 'stroke-opacity'?: number; 'stroke-linejoin'?: DesignStroke['join']; style?: string }>;

export function createDesignSvgDefs(images: DesignPaintImages) {
  const markup: string[] = [];
  let sequence = 0;
  function definition(render: (id: string) => string) {
    const id = `setsuna-design-${++sequence}`;
    markup.push(render(id));
    return `url(#${id})`;
  }
  function imagePattern(bounds: Bounds, href: string, preserveAspectRatio: string) {
    const viewBox = `0 0 ${svgNumber(bounds.width)} ${svgNumber(bounds.height)}`;
    return definition((id) => `<pattern${svgAttributes({ id, ...bounds, patternUnits: 'userSpaceOnUse', viewBox })}>`
      + `<image${svgAttributes({ width: bounds.width, height: bounds.height, href, preserveAspectRatio })}/></pattern>`);
  }
  function ink(paint: DesignPaint, bounds: Bounds): Readonly<{ color: string; opacity?: number; style?: string }> {
    const style = paint.blendMode && paint.blendMode !== 'normal' ? `mix-blend-mode:${paint.blendMode}` : undefined;
    if (paint.image) {
      const image = images.get(paint.image.assetPath);
      if (!image) return { color: 'none' };
      const preserveAspectRatio = paint.image.fit === 'stretch' ? 'none' : paint.image.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
      return { color: imagePattern(bounds, image.src, preserveAspectRatio), opacity: paint.opacity, style };
    }
    if (!paint.gradient) return { color: colorWithOpacity(paint.color, paint.opacity), style };
    const { gradient } = paint;
    if (gradient.kind === 'angular' || gradient.kind === 'diamond') {
      const tile = designGradientTile(gradient, designGradientStops(paint), bounds, 1024);
      if (!tile) return { color: 'none' };
      return { color: imagePattern(bounds, tile.toDataURL(), 'none'), style };
    }
    const { radius, start, end } = designGradientGeometry(gradient, bounds);
    const stops = gradient.stops.map(({ offset, color, opacity }) => {
      const { color: rgb, opacity: alpha } = splitDesignColor(color);
      return `<stop${svgAttributes({ offset, 'stop-color': rgb, 'stop-opacity': alpha * (opacity ?? 1) * (paint.opacity ?? 1) })}/>`;
    }).join('');
    const name = gradient.kind === 'linear' ? 'linearGradient' : 'radialGradient';
    const position = gradient.kind === 'linear' ? { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
      : { cx: start.x, cy: start.y, r: radius };
    return { color: definition((id) => `<${name}${svgAttributes({ id, gradientUnits: 'userSpaceOnUse', ...position })}>${stops}</${name}>`), style };
  }

  function fills(node: DesignNode, bounds: Bounds): readonly SvgFill[] {
    const paints = visibleDesignFills(node);
    if (!hasLayeredDesignPaint(node) && !paints.some(({ gradient }) => gradient)) return [{ fill: compositeDesignFill(node) }];
    return paints.map((paint) => {
      const { color, opacity, style } = ink(paint, bounds);
      return { fill: color, 'fill-opacity': opacity, style };
    });
  }

  function stroke(paint: DesignStroke, bounds: Bounds, scale = 1, alignment: DesignStroke['alignment'] = 'center'): SvgStroke {
    const width = paint.width / scale;
    const { color, opacity, style } = ink(paint, designStrokeBounds(bounds, width, alignment));
    return { stroke: color, 'stroke-width': alignment === 'center' ? width : width * 2, 'stroke-opacity': opacity,
      'stroke-linejoin': paint.join, style };
  }

  function clip(paths: readonly DesignSvgPath[]) {
    return definition((id) => `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${paths.map((path) =>
      svgPathMarkup(path, { 'clip-rule': path.fillRule })).join('')}</clipPath>`);
  }

  function outside(paths: readonly DesignSvgPath[], bounds: Bounds, width: number) {
    const mask = designStrokeBounds(bounds, width * 2, 'outside');
    return definition((id) => `<mask${svgAttributes({ id, ...mask, maskUnits: 'userSpaceOnUse' })}>`
      + `<rect${svgAttributes({ ...mask, fill: 'white' })}/>`
      + paths.map((path) => svgPathMarkup(path, { fill: 'black' })).join('') + '</mask>');
  }

  return {
    markup: () => markup.length ? `<defs>${markup.join('')}</defs>` : '',
    fills,
    clip,
    strokes(paints: readonly DesignStroke[], bounds: Bounds) {
      return paints.map((paint) => stroke(paint, bounds));
    },
    vector(node: DesignNode, paths: readonly DesignSvgPath[], bounds: Bounds, scale: number) {
      const strokes = visibleDesignStrokes(node);
      const front = strokes.at(-1);
      return svgPaintedPaths(paths, fills(node, bounds), strokes.map((paint) => stroke(paint, bounds, scale)),
        front && colorWithOpacity(front.color, front.opacity));
    },
    outlines(paints: readonly DesignStroke[], paths: readonly DesignSvgPath[], bounds: Bounds) {
      return paints.map((paint) => {
        const align = paint.alignment ?? 'center';
        const attributes = align === 'inside' ? { 'clip-path': clip(paths) }
          : align === 'outside' ? { mask: outside(paths, bounds, paint.width) } : {};
        const { style, ...outline } = stroke(paint, bounds, 1, align);
        return `<g${svgAttributes({ ...attributes, style })}>${paths.map((path) => svgPathMarkup(path, { fill: 'none', ...outline })).join('')}</g>`;
      });
    },
    shadow(effect: DesignShadow | undefined) {
      if (!effect || effect.hidden || effect.opacity === 0) return undefined;
      const paint = splitDesignColor(effect.color);
      return definition((id) => `<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">`
        + `<feDropShadow${svgAttributes({ dx: effect.x, dy: effect.y, stdDeviation: effect.blur / 2,
          'flood-color': paint.color, 'flood-opacity': (effect.opacity ?? 0.38) * paint.opacity })}/></filter>`);
    },
  };
}

export function svgPaintedPaths(
  paths: readonly DesignSvgPath[], fills: readonly SvgFill[], strokes: readonly SvgStroke[] = [], fallbackInk?: string,
) {
  const first = fills.length && !fills.at(-1)?.style && !strokes[0]?.style ? strokes[0] : undefined;
  const outlines = first ? strokes.slice(1) : strokes;
  return [
    ...fills.flatMap((paint, index) => paths.map((path) => svgPathMarkup(path, {
      ...paint, fill: designVectorPathFill(path, paint.fill, fallbackInk),
      ...(index === fills.length - 1 ? first : undefined),
    }))),
    ...outlines.flatMap((stroke) => paths.map((path) => svgPathMarkup(path, { fill: 'none', ...stroke }))),
  ].join('');
}

type SvgTextPiece = { text: string; x: number; y: number; style: ReturnType<typeof designTextStyle>;
  baselineFromCenter?: number; color?: string; wordSpacing?: number };

function svgTextPieces(node: DesignText, width: number): readonly SvgTextPiece[] {
  const baselines = designHanTextBaselines(node.text);
  if (node.runs?.length) return layoutRichDesignText(node, width).pieces.map((piece) => ({
    ...piece, baselineFromCenter: baselines?.(piece.style)?.fromCenter,
  }));
  // Use the canvas engine's line breaks to keep text aligned with the exported layer.
  const shape = createPlainDesignText(node, width);
  const style = designTextStyle(node);
  const baselineFromCenter = baselines?.(style)?.fromCenter;
  try {
    return shape.textArr.map((line, index) => {
      const spare = width - line.width;
      const spaces = style.textAlign === 'justify' && !line.lastInParagraph ? line.text.split(' ').length - 1 : 0;
      return { text: line.text, style, baselineFromCenter, x: style.textAlign === 'right' ? spare : style.textAlign === 'center' ? spare / 2 : 0,
        y: index * style.fontSize * style.lineHeight, wordSpacing: spaces ? spare / spaces : undefined };
    });
  } finally {
    shape.destroy();
  }
}

export function svgDesignText(node: DesignText, width: number, fills: readonly SvgFill[], strokes: readonly SvgStroke[]) {
  const outlines = strokes.map((stroke) => ({ fill: 'none', ...stroke }));
  return svgTextPieces(node, width).map((piece) => {
    const colors = piece.color ? [{ fill: piece.color }] : fills;
    return [...colors, ...outlines].map((paint) => svgTextPiece(piece, paint)).join('');
  }).join('');
}

export function svgDesignTextOutlines(node: DesignText, width: number, strokes: readonly SvgStroke[]) {
  const pieces = svgTextPieces(node, width);
  return strokes.map((stroke) => pieces.map((piece) => svgTextPiece(piece, { fill: 'none', ...stroke })).join(''));
}

function svgTextPiece({ text, x, y, style, baselineFromCenter, wordSpacing }: SvgTextPiece, paint: SvgFill | (SvgStroke & { fill: string })) {
  const blend = paint.style ? `;${paint.style}` : '';
  return `<text${svgAttributes({ ...paint, x, y: y + style.fontSize * style.lineHeight / 2 + (baselineFromCenter ?? 0),
    'dominant-baseline': baselineFromCenter === undefined ? 'central' : 'alphabetic',
    style: `font-family:${style.fontFamily}${blend}`, 'font-size': style.fontSize, 'font-weight': style.fontWeight,
    'font-style': style.fontStyle === 'italic' ? style.fontStyle : undefined,
    'letter-spacing': style.letterSpacing, 'word-spacing': wordSpacing, 'xml:space': 'preserve' })}>${escapeDesignMarkup(text)}</text>`;
}
