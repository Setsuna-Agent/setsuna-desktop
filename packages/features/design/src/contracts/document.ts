import { isValidWorkspaceEntryName, MAX_DESIGN_SVG_BYTES } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { designResourceParts, parseDesignId as nodeId, parseDesignLibraryPath, parseDesignResourceId } from './design-resource-id.js';
import {
  designIconNames, maxDesignPathAnchors, maxDesignPolygonSides, maxDesignSvgPaths, minDesignPolygonSides,
  parseDesignSvgNumber, parseDesignSvgPathData,
  type DesignPathAnchor, type DesignSvgGeometry, type DesignSvgMatrix, type DesignSvgPath, type DesignVectorGeometry,
} from './vector-geometry.js';

type Position = Readonly<{ x: number; y: number }>;
export type DesignSizeMode = 'fixed' | 'hug' | 'fill';
export type DesignQuad = readonly [number, number, number, number];

export type DesignLayout = Readonly<{
  direction: 'horizontal' | 'vertical';
  gap: number;
  padding: number;
  paddingX?: number;
  paddingY?: number;
  paddingSides?: DesignQuad;
  wrap?: boolean;
  align: 'start' | 'center' | 'end';
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
}>;

export type DesignStroke = Readonly<{
  color: string;
  styleId?: string;
  width: number;
  opacity?: number;
  hidden?: boolean;
  alignment?: 'inside' | 'center' | 'outside';
  join?: 'miter' | 'round' | 'bevel';
}>;
export type DesignShadow = Readonly<{ color: string; styleId?: string; blur: number; x: number; y: number; opacity?: number; hidden?: boolean }>;

export type DesignGradientStop = Readonly<{ offset: number; color: string; opacity?: number; styleId?: string }>;
export type DesignGradient = Readonly<{ kind: 'linear' | 'radial'; angle?: number; stops: readonly DesignGradientStop[] }>;
export const designFillImageFits = ['cover', 'contain', 'stretch'] as const;
export type DesignFillImage = Readonly<{ assetPath: string; fit: (typeof designFillImageFits)[number] }>;
export const designBlendModes = ['normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen', 'color-dodge', 'overlay',
  'soft-light', 'hard-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const;
export type DesignBlendMode = (typeof designBlendModes)[number];
export type DesignFill = Readonly<{
  color: string; styleId?: string; opacity?: number; hidden?: boolean;
  gradient?: DesignGradient; image?: DesignFillImage; blendMode?: DesignBlendMode;
}>;
export const maxDesignFills = 32;
export const maxDesignStrokes = 32;
export const designFrameFill = '#ffffff';
export const designTextFill = '#1c1f26';
type Fill = Readonly<{ fills?: readonly DesignFill[] }>;
export const designFontFamilies = ['system', 'sans', 'serif', 'mono'] as const;
export const designFontWeights = [300, 400, 500, 600, 700, 800] as const;
export const designTextAlignments = ['left', 'center', 'right', 'justify'] as const;
export const designImageFits = ['cover', 'contain'] as const;

export type DesignTypography = Readonly<{
  fontSize: number;
  fontFamily?: string;
  fontWeight?: (typeof designFontWeights)[number];
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: (typeof designTextAlignments)[number];
}>;
export type DesignTextRun = Readonly<{
  start: number; end: number;
  color?: string; styleId?: string;
  fontFamily?: string; fontSize?: number; fontWeight?: DesignTypography['fontWeight'];
}>;
export type DesignStyle =
  | Readonly<{ kind: 'color'; name: string; color: string }>
  | Readonly<{ kind: 'text'; name: string; typography: DesignTypography }>;

export type DesignInteraction =
  | Readonly<{ kind: 'navigate' | 'overlay'; targetId: string }>
  | Readonly<{ kind: 'back' | 'close' }>;

export type DesignContentOverride = Readonly<{ kind: 'text'; text: string }> | Readonly<{ kind: 'image'; assetPath: string }>;

type Layer = Position & Readonly<{
  name?: string;
  width: number;
  widthMode?: DesignSizeMode;
  minWidth?: number;
  maxWidth?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  opacity?: number;
  hidden?: boolean;
  locked?: boolean;
  absolute?: boolean;
  strokes?: readonly DesignStroke[];
  shadow?: DesignShadow;
  interaction?: DesignInteraction;
  componentSlot?: string;
}>;

type Box = Layer & Readonly<{
  height: number;
  heightMode?: DesignSizeMode;
}>;

export type DesignFrame = Box & Fill & Readonly<{
  kind: 'frame';
  cornerRadius?: number;
  cornerRadii?: DesignQuad;
  clip?: boolean;
  group?: boolean;
  layout?: DesignLayout;
  childIds: readonly string[];
  component?: boolean;
  componentSet?: string;
  variantName?: string;
  instanceOf?: string;
  maskId?: string;
  contentOverrides?: Readonly<Record<string, DesignContentOverride>>;
}>;

export type DesignText = Layer & Fill & DesignTypography & Readonly<{
  kind: 'text';
  text: string;
  textStyleId?: string;
  runs?: readonly DesignTextRun[];
}>;

export type DesignRectangle = Box & Fill & Readonly<{
  kind: 'rectangle';
  cornerRadius: number;
  cornerRadii?: DesignQuad;
}>;

export type DesignEllipse = Box & Fill & Readonly<{ kind: 'ellipse' }>;
export type DesignImage = Box & Readonly<{
  kind: 'image'; assetPath: string; fit?: (typeof designImageFits)[number]; crop?: Position;
}>;
export type DesignVector = Box & Fill & Readonly<{ kind: 'vector'; geometry: DesignVectorGeometry }>;
export type DesignNode = DesignFrame | DesignText | DesignRectangle | DesignEllipse | DesignImage | DesignVector;
export type DesignLibraryLinks = Readonly<Record<string, string>>;
export const maxDesignTreeDepth = 48;
export const maxExpandedDesignLayers = 20_000;
export const designDocumentVersion = 5;

export type DesignDocument = Readonly<{
  schemaVersion: typeof designDocumentVersion;
  documentId: string;
  rootIds: readonly string[];
  nodes: Readonly<Record<string, DesignNode>>;
  styles?: Readonly<Record<string, DesignStyle>>;
  libraries?: DesignLibraryLinks;
}>;

export type DesignEdit =
  | Readonly<{ kind: 'insert'; nodeId: string; parentId: string | null; node: DesignNode }>
  | (Position & Readonly<{ kind: 'move'; nodeId: string }>)
  | Readonly<{ kind: 'updateText'; nodeId: string; text: string }>
  | Readonly<{ kind: 'update'; nodeId: string; node: DesignNode }>
  | Readonly<{ kind: 'reorder'; nodeId: string; beforeId: string | null }>
  | Readonly<{ kind: 'reparent'; nodeId: string; parentId: string | null; beforeId: string | null }>
  | Readonly<{ kind: 'remove'; nodeId: string }>
  | Readonly<{ kind: 'setStyle'; styleId: string; style: DesignStyle | null }>
  | Readonly<{ kind: 'linkLibrary'; documentId: string; path: string }>;

export const designDocumentCodec = defineRuntimeCodec<DesignDocument>((input) => {
  const value = record(input);
  if (![1, 2, 3, 4, designDocumentVersion].some((version) => version === value.schemaVersion)) {
    throw new Error('Unsupported design document version.');
  }
  const nodes = Object.fromEntries(Object.entries(record(value.nodes)).map(([id, node]) => [nodeId(id), parseNode(node)]));
  const document = { schemaVersion: designDocumentVersion, documentId: nodeId(value.documentId), rootIds: idList(value.rootIds), nodes,
    styles: optional(value.styles, (value) => Object.fromEntries(Object.entries(record(value)).map(([id, style]) => [nodeId(id), parseDesignStyle(style)]))),
    libraries: optional(value.libraries, (value) => Object.fromEntries(Object.entries(record(value)).map(([id, path]) => [nodeId(id), parseDesignLibraryPath(path)]))) } as const;
  if (document.libraries && Object.hasOwn(document.libraries, document.documentId)) throw new Error('A draft cannot link to itself.');
  indexDesignParents(document);
  validateDesignComponents(document);
  return document;
});

export function indexDesignParents({ nodes, rootIds }: DesignDocument): ReadonlyMap<string, string | null> {
  const parents = new Map<string, string | null>();
  const visit = (id: string, parentId: string | null, depth: number) => {
    if (!Object.hasOwn(nodes, id) || parents.has(id) || depth > maxDesignTreeDepth) {
      throw new Error('Invalid design layer hierarchy.');
    }
    const node = nodes[id];
    parents.set(id, parentId);
    if (node.kind === 'frame') node.childIds.forEach((childId) => visit(childId, id, depth + 1));
  };
  rootIds.forEach((id) => visit(id, null, 0));
  if (parents.size !== Object.keys(nodes).length) throw new Error('Design document contains unattached layers.');
  return parents;
}

export function validateDesignComponents({ nodes, rootIds, libraries }: DesignDocument): void {
  if (!Object.values(nodes).some((node) => node.kind === 'frame' && node.instanceOf)) return;
  const active = new Set<string>();
  const sizes = new Map<string, { depth: number; count: number }>();
  // Memoize expanded sizes to reject nested references before the renderer materializes them.
  function measure(id: string, pathDepth: number): { depth: number; count: number } {
    if (active.has(id) || pathDepth > 96) throw new Error('Invalid component nesting.');
    const cached = sizes.get(id);
    if (cached) return cached;
    active.add(id);
    const node = nodes[id];
    let size = { depth: 0, count: 1 };
    if (node.kind === 'frame' && node.instanceOf) {
      if (node.component || node.childIds.length) throw new Error('A component instance cannot contain authored layers.');
      const linked = designResourceParts(node.instanceOf);
      if (linked) {
        if (!libraries || !Object.hasOwn(libraries, linked.documentId)) throw new Error('A shared component requires a linked design library.');
      } else {
        const source = Object.hasOwn(nodes, node.instanceOf) ? nodes[node.instanceOf] : undefined;
        if (source?.kind !== 'frame' || !source.component || source.instanceOf) throw new Error('A component instance requires an existing source.');
        size = measure(node.instanceOf, pathDepth + 1);
      }
    } else if (node.kind === 'frame') {
      for (const child of node.childIds) {
        const nested = measure(child, pathDepth + 1);
        size = { depth: Math.max(size.depth, 1 + nested.depth), count: size.count + nested.count };
      }
    }
    if (size.depth > maxDesignTreeDepth || size.count > maxExpandedDesignLayers) throw new Error('This component expands into too many layers.');
    active.delete(id);
    sizes.set(id, size);
    return size;
  }
  const count = rootIds.reduce((total, id) => total + measure(id, 0).count, 0);
  if (count > Math.max(maxExpandedDesignLayers, Object.keys(nodes).length)) throw new Error('This document expands into too many layers.');
}

export function parseDesignEdit(input: unknown): DesignEdit {
  const value = record(input);
  if (value.kind === 'setStyle') return { kind: 'setStyle', styleId: nodeId(value.styleId), style: value.style === null ? null : parseDesignStyle(value.style) };
  if (value.kind === 'linkLibrary') return { kind: 'linkLibrary', documentId: nodeId(value.documentId), path: parseDesignLibraryPath(value.path) };
  const id = nodeId(value.nodeId);
  switch (value.kind) {
    case 'insert':
      return { kind: 'insert', nodeId: id, parentId: nullableId(value.parentId), node: parseNode(value.node) };
    case 'move':
      return { kind: 'move', nodeId: id, ...position(value) };
    case 'updateText':
      return { kind: 'updateText', nodeId: id, text: text(value.text) };
    case 'update':
      return { kind: 'update', nodeId: id, node: parseNode(value.node) };
    case 'reorder':
      return { kind: 'reorder', nodeId: id, beforeId: nullableId(value.beforeId) };
    case 'reparent':
      return { kind: 'reparent', nodeId: id, parentId: nullableId(value.parentId), beforeId: nullableId(value.beforeId) };
    case 'remove':
      return { kind: 'remove', nodeId: id };
    default:
      throw new Error('Unsupported design edit.');
  }
}

function parseNode(input: unknown): DesignNode {
  const value = record(input);
  const minWidth = optional(value.minWidth, spacing);
  const maxWidth = optional(value.maxWidth, dimension);
  if (minWidth !== undefined && maxWidth !== undefined && minWidth > maxWidth) throw new Error('Invalid layer width limits.');
  const layer = { ...position(value), width: dimension(value.width),
    name: optional(value.name, text),
    widthMode: optional(value.widthMode, sizeMode), minWidth, maxWidth,
    rotation: optional(value.rotation, degrees),
    flipX: optional(value.flipX, flag),
    flipY: optional(value.flipY, flag),
    opacity: optional(value.opacity, unitInterval),
    hidden: optional(value.hidden, flag),
    locked: optional(value.locked, flag),
    absolute: optional(value.absolute, flag),
    strokes: parseStrokes(value),
    shadow: optional(value.shadow, parseShadow),
    interaction: optional(value.interaction, parseInteraction), componentSlot: optional(value.componentSlot, nodeId),
  };
  const paint = { fills: parseFills(value) };
  if (value.kind === 'text') {
    const content = text(value.text);
    return { ...layer, ...paint, ...parseTypography(value), kind: 'text', text: content,
      textStyleId: optional(value.textStyleId, parseDesignResourceId), runs: optional(value.runs, (runs) => parseTextRuns(runs, content.length)) };
  }
  const box = { ...layer, height: dimension(value.height), heightMode: optional(value.heightMode, sizeMode) };
  switch (value.kind) {
    case 'frame': {
      const instanceOf = optional(value.instanceOf, parseDesignResourceId);
      if (!instanceOf && value.contentOverrides !== undefined) throw new Error('Content overrides require a component instance.');
      return { ...box, ...paint, kind: 'frame', childIds: idList(value.childIds),
        component: optional(value.component, flag),
        componentSet: optional(value.componentSet, nodeId), variantName: optional(value.variantName, shortName), maskId: optional(value.maskId, nodeId),
        instanceOf, contentOverrides: optional(value.contentOverrides, parseContentOverrides),
        cornerRadius: optional(value.cornerRadius, spacing),
        cornerRadii: optional(value.cornerRadii, quad),
        clip: optional(value.clip, flag),
        group: optional(value.group, flag),
        layout: optional(value.layout, parseLayout) };
    }
    case 'rectangle':
      return { ...box, ...paint, kind: 'rectangle', cornerRadius: spacing(value.cornerRadius),
        cornerRadii: optional(value.cornerRadii, quad) };
    case 'ellipse':
      return { ...box, ...paint, kind: 'ellipse' };
    case 'image':
      return { ...box, kind: 'image', assetPath: parseAssetPath(value.assetPath), fit: option(value.fit, designImageFits),
        crop: optional(value.crop, (input) => { const { x, y } = record(input); return { x: unitInterval(x), y: unitInterval(y) }; }) };
    case 'vector':
      return { ...box, ...paint, kind: 'vector', geometry: parseVectorGeometry(value.geometry) };
    default:
      throw new Error('Unsupported design layer type.');
  }
}

function parseVectorGeometry(input: unknown): DesignVectorGeometry {
  const value = record(input);
  if (value.kind === 'polygon') {
    const sides = coordinate(value.sides);
    if (Number.isInteger(sides) && sides >= minDesignPolygonSides && sides <= maxDesignPolygonSides) return { kind: 'polygon', sides };
  } else if (value.kind === 'icon') {
    const icon = option(value.icon, designIconNames);
    if (icon) return { kind: 'icon', icon };
  } else if (value.kind === 'svg') {
    return parseSvgGeometry(value);
  } else if (value.kind === 'path') {
    const closed = flag(value.closed);
    if (Array.isArray(value.anchors) && value.anchors.length >= (closed ? 3 : 2) && value.anchors.length <= maxDesignPathAnchors) {
      return { kind: 'path', closed, anchors: value.anchors.map(parsePathAnchor) };
    }
  }
  throw new Error('Invalid design vector geometry.');
}

function parseSvgGeometry(value: Record<string, unknown>): DesignSvgGeometry {
  const { x, y, width, height } = record(value.viewBox);
  const viewBox = { x: parseDesignSvgNumber(x), y: parseDesignSvgNumber(y),
    width: dimension(parseDesignSvgNumber(width)), height: dimension(parseDesignSvgNumber(height)) };
  if (!Array.isArray(value.paths) || !value.paths.length || value.paths.length > maxDesignSvgPaths) throw new Error('Invalid SVG path count.');
  let length = 0;
  const paths = value.paths.map((input): DesignSvgPath => {
    const path = record(input);
    const data = parseDesignSvgPathData(path.data);
    length += data.length;
    if (length > MAX_DESIGN_SVG_BYTES) throw new Error('SVG path data is too large.');
    return { data, fillRule: option(path.fillRule, ['nonzero', 'evenodd']), fillFromStroke: optional(path.fillFromStroke, flag),
      lineCap: option(path.lineCap, ['butt', 'round', 'square']),
      transform: optional(path.transform, parseSvgMatrix), dash: optional(path.dash, (dash) => {
        if (!Array.isArray(dash) || dash.length > 32) throw new Error('Invalid SVG dash pattern.');
        return dash.map((distance) => spacing(parseDesignSvgNumber(distance)));
      }), dashOffset: optional(path.dashOffset, parseDesignSvgNumber) };
  });
  const icon = optional(value.icon, (name) => {
    if (typeof name === 'string' && name.length <= 128 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) return name;
    throw new Error('Invalid Lucide icon name.');
  });
  return { kind: 'svg', viewBox, paths, icon };
}

function parseSvgMatrix(input: unknown): DesignSvgMatrix {
  if (!Array.isArray(input) || input.length !== 6) throw new Error('Invalid SVG transform.');
  const [a, b, c, d, e, f] = input.map(parseDesignSvgNumber);
  if (a * d - b * c === 0) throw new Error('Invalid SVG transform.');
  return [a, b, c, d, e, f];
}

function parsePathAnchor(input: unknown): DesignPathAnchor {
  const value = record(input);
  const handle = (point: unknown) => position(record(point));
  return { ...position(value), incoming: optional(value.incoming, handle), outgoing: optional(value.outgoing, handle) };
}

function option<T extends string | number>(input: unknown, values: readonly T[]): T | undefined {
  if (input === undefined) return undefined;
  const value = values.find((candidate) => candidate === input);
  if (value === undefined) throw new Error('Invalid design style option.');
  return value;
}

function parseContentOverrides(input: unknown): Readonly<Record<string, DesignContentOverride>> {
  const entries = Object.entries(record(input));
  if (entries.length > maxExpandedDesignLayers) throw new Error('This instance has too many content overrides.');
  const overrides: Record<string, DesignContentOverride> = Object.create(null);
  for (const [path, value] of entries) {
    const ids = path.split('/');
    if (ids.length > maxDesignTreeDepth) throw new Error('Invalid component override path.');
    ids.forEach(parseDesignResourceId);
    const content = record(value);
    if (content.kind === 'text') overrides[path] = { kind: 'text', text: text(content.text) };
    else if (content.kind === 'image') overrides[path] = { kind: 'image', assetPath: parseAssetPath(content.assetPath) };
    else throw new Error('Invalid component content override.');
  }
  return overrides;
}

function parseLayout(input: unknown): DesignLayout {
  const { direction, gap, padding, paddingX, paddingY, paddingSides, align, justify, wrap } = record(input);
  if ((direction !== 'horizontal' && direction !== 'vertical') || (align !== 'start' && align !== 'center' && align !== 'end')) {
    throw new Error('Invalid automatic layout.');
  }
  if (justify !== undefined && justify !== 'start' && justify !== 'center' && justify !== 'end'
    && justify !== 'space-between' && justify !== 'space-around') throw new Error('Invalid layout distribution.');
  return { direction, gap: spacing(gap), padding: spacing(padding), align, justify,
    paddingX: optional(paddingX, spacing), paddingY: optional(paddingY, spacing), paddingSides: optional(paddingSides, quad), wrap: optional(wrap, flag) };
}

function parseStrokes({ strokes, stroke }: Record<string, unknown>): readonly DesignStroke[] | undefined {
  if (strokes === undefined) return stroke === undefined ? undefined : [parseStroke(stroke)];
  if (!Array.isArray(strokes) || strokes.length > maxDesignStrokes) throw new Error('Invalid design stroke stack.');
  return strokes.map(parseStroke);
}

function parseStroke(input: unknown): DesignStroke {
  const { color: paint, width, opacity, hidden, alignment, join, styleId } = record(input);
  if (alignment !== undefined && alignment !== 'inside' && alignment !== 'center' && alignment !== 'outside') {
    throw new Error('Invalid stroke alignment.');
  }
  if (join !== undefined && join !== 'miter' && join !== 'round' && join !== 'bevel') throw new Error('Invalid stroke join.');
  return { color: color(paint), width: dimension(width), opacity: optional(opacity, unitInterval), hidden: optional(hidden, flag), alignment, join,
    styleId: optional(styleId, parseDesignResourceId) };
}

function parseShadow(input: unknown): DesignShadow {
  const { color: paint, blur, x, y, opacity, hidden, styleId } = record(input);
  return { color: color(paint), blur: spacing(blur), x: coordinate(x), y: coordinate(y),
    opacity: optional(opacity, unitInterval), hidden: optional(hidden, flag), styleId: optional(styleId, parseDesignResourceId) };
}

function quad(value: unknown): DesignQuad {
  if (!Array.isArray(value) || value.length !== 4) throw new Error('Expected four design measurements.');
  const [first, second, third, fourth] = value;
  return [spacing(first), spacing(second), spacing(third), spacing(fourth)];
}

function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}

function parseFills(value: Record<string, unknown>): readonly DesignFill[] | undefined {
  if (value.fills !== undefined) {
    if (!Array.isArray(value.fills) || value.fills.length > maxDesignFills) throw new Error('Invalid design fill stack.');
    return value.fills.map((entry) => {
      const fill = record(entry);
      if (fill.gradient !== undefined && fill.image !== undefined) throw new Error('A fill cannot contain both a gradient and an image.');
      return { color: color(fill.color), opacity: optional(fill.opacity, unitInterval), hidden: optional(fill.hidden, flag),
        styleId: optional(fill.styleId, parseDesignResourceId), gradient: optional(fill.gradient, parseGradient),
        blendMode: option(fill.blendMode, designBlendModes), image: optional(fill.image, (value): DesignFillImage => {
          const image = record(value);
          return { assetPath: parseAssetPath(image.assetPath), fit: option(image.fit, designFillImageFits) ?? 'cover' };
        }) };
    });
  }
  if (value.fill === null) return [];
  if (value.fill === undefined && value.fillOpacity === undefined && value.fillHidden === undefined) return undefined;
  const fallback = value.kind === 'text' ? designTextFill : designFrameFill;
  return [{ color: value.fill === undefined ? fallback : color(value.fill),
    opacity: optional(value.fillOpacity, unitInterval), hidden: optional(value.fillHidden, flag) }];
}

function parseGradient(input: unknown): DesignGradient {
  const { kind, angle, stops } = record(input);
  if ((kind !== 'linear' && kind !== 'radial') || !Array.isArray(stops) || stops.length < 2 || stops.length > 16) {
    throw new Error('Invalid design gradient.');
  }
  return { kind, angle: optional(angle, degrees), stops: stops.map((entry) => {
    const stop = record(entry);
    return { offset: unitInterval(stop.offset), color: color(stop.color), opacity: optional(stop.opacity, unitInterval), styleId: optional(stop.styleId, parseDesignResourceId) };
  }).sort((a, b) => a.offset - b.offset) };
}

function parseTypography(value: Record<string, unknown>): DesignTypography {
  return { fontSize: dimension(value.fontSize), fontFamily: optional(value.fontFamily, shortName),
    fontWeight: option(value.fontWeight, designFontWeights), lineHeight: optional(value.lineHeight, dimension),
    letterSpacing: optional(value.letterSpacing, coordinate), textAlign: option(value.textAlign, designTextAlignments) };
}

function parseDesignStyle(input: unknown): DesignStyle {
  const value = record(input);
  const name = shortName(value.name);
  if (value.kind === 'color') return { kind: 'color', name, color: color(value.color) };
  if (value.kind === 'text') return { kind: 'text', name, typography: parseTypography(record(value.typography)) };
  throw new Error('Invalid design style.');
}

function parseTextRuns(input: unknown, length: number): readonly DesignTextRun[] {
  if (!Array.isArray(input) || input.length > 4096) throw new Error('Invalid design text styles.');
  let end = 0;
  return input.map((entry) => {
    const run = record(entry);
    const start = coordinate(run.start);
    const nextEnd = coordinate(run.end);
    if (!Number.isInteger(start) || !Number.isInteger(nextEnd) || start < end || nextEnd <= start || nextEnd > length) {
      throw new Error('Invalid design text style range.');
    }
    end = nextEnd;
    return { start, end, color: optional(run.color, color), styleId: optional(run.styleId, parseDesignResourceId),
      fontSize: optional(run.fontSize, dimension), fontWeight: option(run.fontWeight, designFontWeights), fontFamily: optional(run.fontFamily, shortName) };
  });
}

function shortName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\p{C}]/u.test(value)) throw new Error('Invalid design name.');
  return value.trim();
}

function parseInteraction(input: unknown): DesignInteraction {
  const { kind, targetId } = record(input);
  if (kind === 'navigate' || kind === 'overlay') return { kind, targetId: nodeId(targetId) };
  if (kind === 'back' || kind === 'close') return { kind };
  throw new Error('Invalid prototype interaction.');
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid design layer flag.');
  return value;
}

function unitInterval(value: unknown): number {
  const result = coordinate(value);
  if (result < 0 || result > 1) throw new Error('Design opacity must be between zero and one.');
  return result;
}

function degrees(value: unknown): number {
  const angle = coordinate(value) % 360;
  return angle >= 180 ? angle - 360 : angle < -180 ? angle + 360 : angle;
}

function sizeMode(value: unknown): DesignSizeMode {
  if (value === 'fixed' || value === 'hug' || value === 'fill') return value;
  throw new Error('Invalid layout sizing mode.');
}

function color(value: unknown): string {
  if (typeof value === 'string' && /^#[a-f\d]{6}$/iu.test(value)) return value;
  throw new Error('Invalid design color.');
}

export function parseAssetPath(value: unknown): string {
  if (typeof value !== 'string' || !value.split('/').every(isValidWorkspaceEntryName)) {
    throw new Error('Image assets require a path within the project root.');
  }
  return value;
}

function position(value: Record<string, unknown>): Position {
  return { x: coordinate(value.x), y: coordinate(value.y) };
}

function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid design coordinate.');
  return value;
}

function dimension(value: unknown): number {
  const size = coordinate(value);
  if (size <= 0) throw new Error('Design dimensions must be positive.');
  return size;
}

function spacing(value: unknown): number {
  const size = coordinate(value);
  if (size < 0) throw new Error('Design spacing cannot be negative.');
  return size;
}

function nullableId(value: unknown): string | null {
  return value === null ? null : nodeId(value);
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Design layer order must be an array.');
  return value.map(nodeId);
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Design text must be a string.');
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid design data.');
  return value as Record<string, unknown>;
}
