import { Transform, Util } from 'konva/lib/Util.js';
import { maxDesignGradientStops, type DesignFill, type DesignGradientStop } from '../../contracts/document.js';
import type { Bounds } from '../design-geometry.js';
import { svgLength, svgTransform, type SvgAttribute } from './design-svg-shapes.js';

export function svgAttributes(element: Element): SvgAttribute {
  const inline = new Map<string, string>();
  for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    inline.set(declaration.slice(0, separator).trim().toLowerCase(), declaration.slice(separator + 1).replace(/\s*!important\s*$/iu, '').trim());
  }
  return (name) => inline.get(name) ?? element.getAttribute(name)?.trim();
}

function svgColor(value: string, currentColor: string, opacity: number): DesignFill | undefined {
  const normalized = value.toLowerCase();
  if (normalized === 'none') return;
  const color = Util.colorToRGBA(normalized === 'currentcolor' ? currentColor : value);
  if (!color) throw new Error('SVG paint must be a solid color.');
  const alpha = Math.max(0, Math.min(1, color.a * opacity));
  const hex = [color.r, color.g, color.b].map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('');
  return { color: '#' + hex, opacity: alpha === 1 ? undefined : alpha };
}

export function readSvgPaint(root: Element, viewport: Pick<Bounds, 'width' | 'height'>) {
  const definitions = new Map(Array.from(root.getElementsByTagNameNS(root.namespaceURI, 'linearGradient'), (element) => [element.id, element]));
  return (value: string, currentColor: string, opacity: number, bounds: () => Bounds): DesignFill | undefined => {
    if (!value.startsWith('url(')) return svgColor(value, currentColor, opacity);
    const reference = /^url\(\s*['"]?#([^\s'")]+)['"]?\s*\)$/u.exec(value);
    const element = reference && definitions.get(reference[1]);
    if (!element) throw new Error('Expected a local SVG linearGradient reference: ' + value);
    const get = svgAttributes(element);
    const units = get('gradientUnits') ?? 'objectBoundingBox';
    if (!['userSpaceOnUse', 'objectBoundingBox'].includes(units) || (get('spreadMethod') ?? 'pad') !== 'pad'
      || get('href') || get('xlink:href')) throw new Error('Unsupported SVG gradient units, spread method or inheritance.');
    const stops: DesignGradientStop[] = [];
    for (const child of Array.from(element.children)) {
      if (child.localName !== 'stop') continue;
      const attr = svgAttributes(child);
      const color = svgColor(attr('stop-color') ?? 'black', attr('color') ?? get('color') ?? currentColor, svgLength(attr('stop-opacity'), 1) ?? 1);
      if (!color) throw new Error('Invalid SVG gradient stop color.');
      const offset = Math.max(stops.at(-1)?.offset ?? 0, Math.min(1, svgLength(attr('offset'), 1) ?? 0));
      stops.push({ offset, color: color.color, opacity: color.opacity });
      if (stops.length > maxDesignGradientStops) throw new Error('Too many SVG gradient stops.');
    }
    if (!stops.length) return;
    const bbox = units === 'objectBoundingBox';
    function position(axis: 'x' | 'y', end: boolean) {
      const basis = bbox ? 1 : axis === 'x' ? viewport.width : viewport.height;
      const raw = get(axis + (end ? '2' : '1'));
      if (raw === undefined) return end && axis === 'x' ? basis : 0;
      const coordinate = svgLength(raw, basis);
      if (coordinate === undefined) throw new Error('Invalid SVG gradient coordinate: ' + raw);
      return coordinate;
    }
    const start = { x: position('x', false), y: position('y', false) };
    const dx = position('x', true) - start.x;
    const dy = position('y', true) - start.y;
    const last = stops[stops.length - 1];
    if (stops.length === 1 || (!dx && !dy)) return { color: last.color, opacity: opacity * (last.opacity ?? 1) };
    const transform = new Transform();
    if (bbox) {
      const box = bounds();
      if (!box.width || !box.height) return;
      transform.translate(box.x, box.y).scale(box.width, box.height);
    }
    const placement = get('gradientTransform');
    if (placement) transform.multiply(svgTransform(placement));
    if (!transform.isInvertible()) return;
    // A non-uniform scale or skew transforms the gradient's level lines as well as its endpoints.
    const [a, b, c, d] = transform.copy().invert().getMatrix();
    const gx = a * dx + b * dy;
    const gy = c * dx + d * dy;
    const factor = (dx * dx + dy * dy) / (gx * gx + gy * gy);
    const origin = transform.point(start);
    const end = { x: origin.x + gx * factor, y: origin.y + gy * factor };
    return { color: stops[0].color, opacity, gradient: { kind: 'linear', axis: { start: origin, end }, stops } };
  };
}
