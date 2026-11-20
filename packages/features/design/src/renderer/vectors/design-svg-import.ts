import { MAX_DESIGN_SVG_BYTES } from '@setsuna-desktop/contracts';
import { Path } from 'konva/lib/shapes/Path.js';
import { Transform } from 'konva/lib/Util.js';
import {
  maxDesignSvgPaths, parseDesignSvgPathData,
  type DesignEdit, type DesignFill, type DesignStroke, type DesignSvgGeometry, type DesignSvgPath, type DesignSvgViewBox,
} from '../../contracts/index.js';
import { unionBounds, type Bounds, type Point } from '../design-geometry.js';
import { centerDesignLayer } from '../design-insertion.js';
import type { DesignLayerBox } from '../design-layout.js';
import { svgLength, svgMatrix, svgNumbers, svgShapePath, svgSize, svgTransform, svgViewBox, svgViewport, type SvgAttribute } from './design-svg-shapes.js';
import { readSvgPaint, svgAttributes } from './design-svg-paint.js';
import { designGradientWithAxis } from '../styles/design-gradient-geometry.js';
import { designStrokeBounds } from '../design-paint.js';
import type { DesignSvgSource } from './design-svg-source.js';

type PathStyle = Pick<DesignSvgPath, 'fillRule' | 'lineCap' | 'dash' | 'dashOffset'>;
type VectorPaint = Readonly<{ fills: readonly DesignFill[]; stroke?: DesignStroke; opacity: number }>;
type SvgPart = Readonly<{ path: DesignSvgPath; paint: VectorPaint; name?: string }>;
type SvgAsset = Readonly<{ name?: string; viewBox: DesignSvgViewBox; width: number; height: number; clip: boolean; parts: readonly SvgPart[]; icon?: string }>;
type SvgPresentation = PathStyle & Readonly<{
  fill: string; stroke: string; color: string; fillOpacity: number; strokeOpacity: number; strokeWidth: number;
  opacity: number; join: DesignStroke['join']; visibility: string;
}>;

const svgNamespace = 'http://www.w3.org/2000/svg';
const containers = new Set(['g', 'a']);
const metadata = new Set(['defs', 'linearGradient', 'title', 'desc', 'metadata', 'script', 'foreignObject']);
const shapes = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
const unsupportedEffects = ['clip-path', 'mask', 'filter', 'marker', 'marker-start', 'marker-mid', 'marker-end'] as const;

export async function readDesignSvg(source: DesignSvgSource): Promise<SvgAsset> {
  if ('file' in source && source.file.size > MAX_DESIGN_SVG_BYTES) throw new Error('SVG source is too large.');
  const markup = 'file' in source ? await source.file.text() : source.markup;
  if (markup.length > MAX_DESIGN_SVG_BYTES || /<!DOCTYPE\b|<!ENTITY\b|<\?xml-stylesheet\b/iu.test(markup)) {
    throw new Error('Invalid SVG source.');
  }
  // Read an inert XML tree. Only parsed geometry and local paint definitions can leave the importer.
  const xml = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = xml.documentElement;
  function isSvgElement(element: Element) {
    return !element.namespaceURI || element.namespaceURI === svgNamespace;
  }
  if (root?.localName !== 'svg' || !isSvgElement(root) || xml.querySelector('parsererror, style')) throw new Error('Invalid SVG.');
  const get = svgAttributes(root);
  const naturalWidth = svgLength(get('width'));
  const naturalHeight = svgLength(get('height'));
  const viewBoxText = get('viewBox');
  const viewport = viewBoxText ? svgViewBox(viewBoxText) : naturalWidth && naturalWidth > 0 && naturalHeight && naturalHeight > 0
    ? { x: 0, y: 0, width: naturalWidth, height: naturalHeight } : undefined;
  const lengthBasis = viewport ?? { width: 300, height: 150 };
  const baseColor = 'icon' in source ? source.color : '#000000';
  const paint = readSvgPaint(root, lengthBasis);
  const parts: SvgPart[] = [];
  const initial: SvgPresentation = {
    fill: '#000000', stroke: 'none', color: baseColor, fillOpacity: 1, strokeOpacity: 1, strokeWidth: 1,
    opacity: 1, join: 'miter', visibility: 'visible',
  };

  function visit(element: Element, inherited: SvgPresentation, parentTransform: Transform, depth: number) {
    if (depth > 48) throw new Error('SVG is nested too deeply.');
    const tag = element.localName;
    if (!isSvgElement(element) || metadata.has(tag)) return;
    const attribute = svgAttributes(element);
    if (attribute('display') === 'none') return;
    if (unsupportedEffects.some((property) => attribute(property) && attribute(property) !== 'none')) throw new Error('Unsupported SVG effect.');
    const style = svgPresentation(attribute, inherited, lengthBasis);
    if (!style.opacity) return;
    const local = attribute('transform');
    const transform = local && local !== 'none' ? parentTransform.copy().multiply(svgTransform(local)) : parentTransform;
    if (!transform.isInvertible()) return;
    if (element === root || containers.has(tag)) {
      for (const child of Array.from(element.children)) visit(child, style, transform, depth + 1);
      return;
    }
    if (!shapes.has(tag)) throw new Error('Unsupported SVG element.');
    if (style.visibility !== 'visible') return;
    const sourcePath = svgShapePath(tag, attribute, lengthBasis).trim();
    if (!sourcePath) return;
    const data = parseDesignSvgPathData(sourcePath);
    let bounds: Bounds | undefined;
    const pathBox = () => bounds ??= svgPathBounds({ data });
    const fill = tag === 'line' ? undefined : paint(style.fill, style.color, style.fillOpacity, pathBox);
    const ink = style.strokeWidth ? paint(style.stroke, style.color, style.strokeOpacity, pathBox) : undefined;
    if (!fill && !ink) return;
    const commands = Path.parsePathData(data);
    if (!commands.some((command) => command.command !== 'M' && command.command !== 'z')
      || !commands.every((command) => command.points.every(Number.isFinite))) throw new Error('Invalid SVG path.');
    if (parts.length >= maxDesignSvgPaths) throw new Error('SVG has too many paths.');
    const { fillRule, lineCap, dash, dashOffset } = style;
    parts.push({
      path: { data, transform: svgMatrix(transform), fillRule, lineCap, dash, dashOffset },
      paint: { opacity: style.opacity, fills: fill ? [fill] : [], stroke: ink && { ...ink, width: style.strokeWidth, join: style.join } },
      name: element.getAttribute('id')?.trim().slice(0, 120) || tag + ' ' + (parts.length + 1),
    });
  }

  visit(root, initial, new Transform(), 0);
  if (!parts.length) throw new Error('SVG contains no visible paths.');
  const viewBox = viewport ?? svgPartBox(unionBounds(parts.map(({ path }) => svgPathBounds(path)))!);
  const explicitName = 'file' in source ? source.file.name.replace(/\.svg$/iu, '') : 'icon' in source ? source.name : undefined;
  const title = Array.from(root.children).find((element) => element.localName === 'title')?.textContent;
  return { name: (explicitName?.trim() || title?.trim())?.slice(0, 120),
    ...svgViewport(viewBox, naturalWidth, naturalHeight, get('preserveAspectRatio')), parts, icon: 'icon' in source ? source.icon : undefined };
}

export function designSvgGeometry(asset: SvgAsset): DesignSvgGeometry {
  // Lucide's filled dots share the outline color, so the glyph stays editable as one layer.
  const paths = asset.parts.map(({ path, paint }) => asset.icon && paint.fills.length ? { ...path, fillFromStroke: true } : path);
  return { kind: 'svg', viewBox: asset.viewBox, paths, icon: asset.icon };
}

export type DesignSvgPlacement = Partial<Bounds> & { strokes?: readonly DesignStroke[]; absolute?: boolean; name?: string };

export function insertDesignSvg(asset: SvgAsset, parentId: string | null, center: Point, frame: DesignLayerBox | undefined,
  fallbackName: string, options: DesignSvgPlacement = {}) {
  const { viewBox, parts } = asset;
  const { width, height } = svgSize(asset, options.width, options.height);
  const scaleX = width / viewBox.width;
  const scaleY = height / viewBox.height;
  const centered = centerDesignLayer(center, { width, height }, frame);
  const placement = { x: options.x ?? centered.x, y: options.y ?? centered.y, width, height, absolute: options.absolute };
  const name = options.name ?? asset.name ?? fallbackName;
  const id = crypto.randomUUID();
  const paint = parts[0].paint;

  function layer(bounds: Bounds, geometry: DesignSvgGeometry, style: VectorPaint, layerName?: string) {
    // SVG paint axes are path-local; the editor stores them relative to the vector viewBox.
    function relativePaint(fill: DesignFill, paintBounds = geometry.viewBox): DesignFill {
      const gradient = fill.gradient;
      return gradient?.axis ? { ...fill, gradient: designGradientWithAxis(gradient, gradient.axis, paintBounds) } : fill;
    }
    return {
      ...bounds, kind: 'vector' as const, name: layerName, geometry,
      fills: style.fills.map((fill) => relativePaint(fill)), opacity: style.opacity === 1 ? undefined : style.opacity,
      strokes: options.strokes ?? (style.stroke && [{ ...style.stroke, ...relativePaint(style.stroke, designStrokeBounds(geometry.viewBox, style.stroke.width)), width: style.stroke.width * Math.max(scaleX, scaleY) }]),
    };
  }

  const paintKey = JSON.stringify(paint);
  const edits: DesignEdit[] = [];
  if (!asset.clip && (asset.icon || parts.every((part) => JSON.stringify(part.paint) === paintKey))) {
    const style = asset.icon ? { ...paint, fills: [] } : paint;
    edits.push({ kind: 'insert', nodeId: id, parentId, node: layer(placement, designSvgGeometry(asset), style, name) });
  } else {
    edits.push({ kind: 'insert', nodeId: id, parentId, node: { ...placement, kind: 'frame', name, childIds: [], group: true, clip: asset.clip, fills: [] } });
    for (const part of parts) {
      const box = svgPartBox(svgPathBounds(part.path));
      const bounds = { x: (box.x - viewBox.x) * scaleX, y: (box.y - viewBox.y) * scaleY, width: box.width * scaleX, height: box.height * scaleY };
      edits.push({ kind: 'insert', nodeId: crypto.randomUUID(), parentId: id,
        node: layer(bounds, { kind: 'svg', viewBox: box, paths: [part.path] }, part.paint, part.name) });
    }
  }
  return { id, edits };
}

function svgPathBounds(path: DesignSvgPath): Bounds {
  const shape = new Path({ data: path.data });
  try {
    const bounds = shape.getSelfRect();
    return path.transform ? new Transform([...path.transform])._getTransformedRect(bounds) : bounds;
  } finally {
    shape.destroy();
  }
}

function svgPartBox(bounds: Bounds): DesignSvgViewBox {
  return { ...bounds, width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1) };
}

function svgPresentation(get: SvgAttribute, parent: SvgPresentation, viewport: Pick<DesignSvgViewBox, 'width' | 'height'>): SvgPresentation {
  function inherit(name: string, inherited: string) {
    const value = get(name);
    return value && value !== 'inherit' ? value : inherited;
  }
  function opacity(name: string, inherited: number) {
    return Math.max(0, Math.min(1, svgLength(get(name), 1) ?? inherited));
  }
  const widthBasis = Math.hypot(viewport.width, viewport.height) / Math.SQRT2;
  const join = get('stroke-linejoin');
  const cap = get('stroke-linecap');
  const fillRule = get('fill-rule');
  const dash = get('stroke-dasharray');
  const dashValues = dash && dash !== 'none' && dash !== 'inherit' ? svgNumbers(dash) : undefined;
  if (dashValues && (dashValues.length > 32 || dashValues.some((value) => value < 0))) throw new Error('Invalid SVG dash pattern.');
  const color = inherit('color', parent.color);
  return {
    color: color.toLowerCase() === 'currentcolor' ? parent.color : color,
    fill: inherit('fill', parent.fill), stroke: inherit('stroke', parent.stroke),
    fillOpacity: opacity('fill-opacity', parent.fillOpacity), strokeOpacity: opacity('stroke-opacity', parent.strokeOpacity),
    opacity: parent.opacity * opacity('opacity', 1),
    strokeWidth: Math.max(0, svgLength(get('stroke-width'), widthBasis) ?? parent.strokeWidth),
    join: join === 'round' || join === 'bevel' || join === 'miter' ? join : parent.join,
    lineCap: cap === 'round' || cap === 'square' || cap === 'butt' ? cap : parent.lineCap,
    fillRule: fillRule === 'evenodd' || fillRule === 'nonzero' ? fillRule : parent.fillRule,
    dash: dash === 'none' ? undefined : dashValues ?? parent.dash,
    dashOffset: svgLength(get('stroke-dashoffset'), widthBasis) ?? parent.dashOffset,
    visibility: inherit('visibility', parent.visibility),
  };
}
