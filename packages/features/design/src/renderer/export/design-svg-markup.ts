import type { DesignNode, DesignShadow, DesignStroke, DesignSvgPath } from '../../contracts/index.js';
import type { Bounds } from '../design-geometry.js';
import { colorWithOpacity, compositeDesignFill } from '../design-paint.js';
import { designGradientGeometry, hasLayeredDesignPaint, visibleDesignFills, type DesignPaintImages } from '../styles/design-gradients.js';
import { designVectorPathFill } from '../vectors/design-vector.js';

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

export function createDesignSvgDefs(images: DesignPaintImages) {
  const markup: string[] = [];
  let sequence = 0;
  function definition(render: (id: string) => string) {
    const id = `setsuna-design-${++sequence}`;
    markup.push(render(id));
    return `url(#${id})`;
  }
  return {
    markup: () => markup.length ? `<defs>${markup.join('')}</defs>` : '',
    fills(node: DesignNode, bounds: Bounds): readonly SvgFill[] {
      const fills = visibleDesignFills(node);
      if (!hasLayeredDesignPaint(node) && !fills.some(({ gradient }) => gradient)) return [{ fill: compositeDesignFill(node) }];
      return fills.map((fill) => {
        const style = fill.blendMode && fill.blendMode !== 'normal' ? `mix-blend-mode:${fill.blendMode}` : undefined;
        if (fill.image) {
          const image = images.get(fill.image.assetPath);
          if (!image) return { fill: 'none' };
          const preserveAspectRatio = fill.image.fit === 'stretch' ? 'none' : fill.image.fit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
          const pattern = definition((id) => `<pattern${svgAttributes({ id, ...bounds, patternUnits: 'userSpaceOnUse' })}>`
            + `<image${svgAttributes({ width: bounds.width, height: bounds.height, href: image.src, preserveAspectRatio })}/></pattern>`);
          return { fill: pattern, 'fill-opacity': fill.opacity, style };
        }
        if (!fill.gradient) return { fill: colorWithOpacity(fill.color, fill.opacity), style };
        const gradient = fill.gradient;
        const { center, radius, start, end } = designGradientGeometry(gradient, bounds);
        const stops = gradient.stops.map(({ offset, color, opacity }) =>
          `<stop${svgAttributes({ offset, 'stop-color': color, 'stop-opacity': (opacity ?? 1) * (fill.opacity ?? 1) })}/>`).join('');
        const name = gradient.kind === 'linear' ? 'linearGradient' : 'radialGradient';
        const position = gradient.kind === 'linear' ? { x1: start.x, y1: start.y, x2: end.x, y2: end.y }
          : { cx: center.x, cy: center.y, r: radius };
        return { fill: definition((id) => `<${name}${svgAttributes({ id, gradientUnits: 'userSpaceOnUse', ...position })}>${stops}</${name}>`), style };
      });
    },
    clip(paths: readonly DesignSvgPath[]) {
      return definition((id) => `<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${paths.map((path) =>
        svgPathMarkup(path, { 'clip-rule': path.fillRule })).join('')}</clipPath>`);
    },
    outside(paths: readonly DesignSvgPath[], bounds: Bounds, strokeWidth: number) {
      const x = bounds.x - strokeWidth * 2;
      const y = bounds.y - strokeWidth * 2;
      const width = bounds.width + strokeWidth * 4;
      const height = bounds.height + strokeWidth * 4;
      return definition((id) => `<mask${svgAttributes({ id, x, y, width, height, maskUnits: 'userSpaceOnUse' })}>`
        + `<rect${svgAttributes({ x, y, width, height, fill: 'white' })}/>`
        + paths.map((path) => svgPathMarkup(path, { fill: 'black' })).join('') + '</mask>');
    },
    shadow(effect: DesignShadow | undefined) {
      if (!effect || effect.hidden || effect.opacity === 0) return undefined;
      return definition((id) => `<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">`
        + `<feDropShadow${svgAttributes({ dx: effect.x, dy: effect.y, stdDeviation: effect.blur / 2,
          'flood-color': effect.color, 'flood-opacity': effect.opacity ?? 0.38 })}/></filter>`);
    },
  };
}

export function svgPaintedPaths(
  paths: readonly DesignSvgPath[], fills: readonly SvgFill[], strokes: readonly DesignStroke[] = [], strokeScale = 1,
) {
  const outlines = strokes.map((stroke) => svgStrokeAttributes(stroke, strokeScale, 'round'));
  const fallbackInk = outlines.at(-1)?.stroke;
  const first = fills.length && !fills.at(-1)?.style ? outlines.shift() : undefined;
  return [
    ...fills.flatMap((paint, index) => paths.map((path) => svgPathMarkup(path, {
      ...paint, fill: designVectorPathFill(path, paint.fill, fallbackInk),
      ...(index === fills.length - 1 ? first : undefined),
    }))),
    ...outlines.flatMap((stroke) => paths.map((path) => svgPathMarkup(path, { fill: 'none', ...stroke }))),
  ].join('');
}

export function svgStrokeAttributes(stroke: DesignStroke, scale = 1, defaultJoin?: DesignStroke['join']) {
  return { stroke: colorWithOpacity(stroke.color, stroke.opacity),
    'stroke-width': stroke.width / scale, 'stroke-linejoin': stroke.join ?? defaultJoin };
}
