import { Transform } from 'konva/lib/Util.js';
import { designSvgNumberPattern, parseDesignSvgNumber, type DesignSvgMatrix, type DesignSvgViewBox } from '../../contracts/index.js';

const numberWithUnit = new RegExp('^(' + designSvgNumberPattern + ')(px|%|in|cm|mm|q|pt|pc)?$', 'iu');
const pixelsPerUnit: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 };
const numberTokens = new RegExp(designSvgNumberPattern, 'gu');

export function svgNumbers(text: string): number[] {
  if (text.replace(numberTokens, '').replace(/[\s,]/gu, '')) throw new Error('Invalid SVG number list.');
  return [...text.matchAll(numberTokens)].map((match) => parseDesignSvgNumber(Number(match[0])));
}

export function svgLength(text: string | undefined, basis?: number) {
  if (text === undefined) return undefined;
  const match = numberWithUnit.exec(text);
  if (!match || (match[2] === '%' && basis === undefined)) return undefined;
  const unit = match[2]?.toLowerCase() ?? 'px';
  const scale = unit === '%' ? (basis ?? 0) / 100 : pixelsPerUnit[unit];
  return parseDesignSvgNumber(Number(match[1]) * scale);
}

export function svgViewBox(text: string): DesignSvgViewBox {
  const values = svgNumbers(text);
  const [x, y, width, height] = values;
  if (values.length !== 4 || width <= 0 || height <= 0) throw new Error('Invalid SVG viewBox.');
  return { x, y, width, height };
}

export function svgSize(basis: Pick<DesignSvgViewBox, 'width' | 'height'>, explicitWidth?: number, explicitHeight?: number) {
  const width = explicitWidth ?? (explicitHeight === undefined ? basis.width : explicitHeight * basis.width / basis.height);
  const height = explicitHeight ?? (explicitWidth === undefined ? basis.height : explicitWidth * basis.height / basis.width);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid SVG dimensions.');
  return { width, height };
}

// The editor maps a vector's viewBox to its layer bounds. Include the SVG viewport's
// letterbox margins in that box so paths keep their original coordinates and transforms.
export function svgViewport(viewBox: DesignSvgViewBox, naturalWidth: number | undefined, naturalHeight: number | undefined, aspect = 'xMidYMid meet') {
  const { width, height } = svgSize(viewBox, naturalWidth, naturalHeight);
  if (/^(?:defer\s+)?none(?:\s+(?:meet|slice))?$/u.test(aspect)) return { width, height, viewBox, clip: false };
  const align = /^(?:defer\s+)?x(Min|Mid|Max)Y(Min|Mid|Max)(?:\s+(meet|slice))?$/u.exec(aspect);
  if (!align) throw new Error('Invalid SVG preserveAspectRatio.');
  const slice = align[3] === 'slice';
  const scale = (slice ? Math.max : Math.min)(width / viewBox.width, height / viewBox.height);
  const viewportWidth = width / scale;
  const viewportHeight = height / scale;
  const offset = (extra: number, alignment: string) => alignment === 'Min' ? 0 : alignment === 'Max' ? extra : extra / 2;
  return { width, height, clip: slice && (viewportWidth < viewBox.width || viewportHeight < viewBox.height),
    viewBox: { x: viewBox.x - offset(viewportWidth - viewBox.width, align[1]), y: viewBox.y - offset(viewportHeight - viewBox.height, align[2]),
      width: viewportWidth, height: viewportHeight } };
}

export function svgTransform(text: string) {
  const transform = new Transform();
  const commands = /([a-z]+)\s*\(([^()]*)\)/giu;
  if (text.replace(commands, '').replace(/[\s,]/gu, '')) throw new Error('Invalid SVG transform.');
  for (const [, name, values] of text.matchAll(commands)) {
    const parameters = svgNumbers(values);
    const [x, y, end] = parameters;
    const size = parameters.length;
    const radians = x * Math.PI / 180;
    if (name === 'matrix' && size === 6) transform.multiply(new Transform(parameters));
    else if (name === 'translate' && (size === 1 || size === 2)) transform.translate(x, y ?? 0);
    else if (name === 'scale' && (size === 1 || size === 2)) transform.scale(x, y ?? x);
    else if (name === 'rotate' && size === 1) transform.rotate(radians);
    else if (name === 'rotate' && size === 3) transform.translate(y, end).rotate(radians).translate(-y, -end);
    else if (name === 'skewX' && size === 1) transform.skew(Math.tan(radians), 0);
    else if (name === 'skewY' && size === 1) transform.skew(0, Math.tan(radians));
    else throw new Error('Invalid SVG transform.');
  }
  return transform;
}

export function svgMatrix(transform: Transform): DesignSvgMatrix | undefined {
  const [a, b, c, d, e, f] = transform.getMatrix().map(parseDesignSvgNumber);
  return a === 1 && d === 1 && !b && !c && !e && !f ? undefined : [a, b, c, d, e, f];
}

export type SvgAttribute = (name: string) => string | undefined;

export function svgShapePath(tag: string, get: SvgAttribute, viewport: Pick<DesignSvgViewBox, 'width' | 'height'>): string {
  function length(name: string, basis: number, fallback = 0) {
    const value = get(name);
    const parsed = svgLength(value, basis);
    if (value !== undefined && parsed === undefined) throw new Error('Invalid SVG length.');
    return parsed ?? fallback;
  }
  const horizontal = (name: string, fallback?: number) => length(name, viewport.width, fallback);
  const vertical = (name: string, fallback?: number) => length(name, viewport.height, fallback);
  switch (tag) {
    case 'path': return get('d') ?? '';
    case 'line': return 'M' + horizontal('x1') + ' ' + vertical('y1') + 'L' + horizontal('x2') + ' ' + vertical('y2');
    case 'polyline':
    case 'polygon': {
      const points = svgNumbers(get('points') ?? '');
      if (points.length < 4 || points.length % 2) return '';
      const pairs: string[] = [];
      for (let index = 0; index < points.length; index += 2) pairs.push(points[index] + ' ' + points[index + 1]);
      return 'M' + pairs.join('L') + (tag === 'polygon' ? 'Z' : '');
    }
    case 'circle': {
      const radius = length('r', Math.hypot(viewport.width, viewport.height) / Math.SQRT2);
      return ellipsePath(horizontal('cx'), vertical('cy'), radius, radius);
    }
    case 'ellipse': return ellipsePath(horizontal('cx'), vertical('cy'), horizontal('rx'), vertical('ry'));
    case 'rect': {
      const width = horizontal('width');
      const height = vertical('height');
      if (width <= 0 || height <= 0) return '';
      const x = horizontal('x');
      const y = vertical('y');
      const rx = Math.max(0, Math.min(width / 2, horizontal('rx', vertical('ry'))));
      const ry = Math.max(0, Math.min(height / 2, vertical('ry', horizontal('rx'))));
      if (!rx || !ry) return 'M' + x + ' ' + y + 'h' + width + 'v' + height + 'h' + (-width) + 'Z';
      const arc = 'a' + rx + ' ' + ry + ' 0 0 1 ';
      const dx = width - 2 * rx;
      const dy = height - 2 * ry;
      return 'M' + (x + rx) + ' ' + y + 'h' + dx + arc + rx + ' ' + ry + 'v' + dy + arc + (-rx) + ' ' + ry
        + 'h' + (-dx) + arc + (-rx) + ' ' + (-ry) + 'v' + (-dy) + arc + rx + ' ' + (-ry) + 'Z';
    }
    default: return '';
  }
}

function ellipsePath(x: number, y: number, rx: number, ry: number) {
  if (rx <= 0 || ry <= 0) return '';
  const arc = 'A' + rx + ' ' + ry + ' 0 1 0 ';
  return 'M' + (x - rx) + ' ' + y + arc + (x + rx) + ' ' + y + arc + (x - rx) + ' ' + y + 'Z';
}
