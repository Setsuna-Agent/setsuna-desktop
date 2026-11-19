import { isValidWorkspaceEntryName, MAX_DESIGN_SVG_BYTES } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { parseDesignColor as color } from './design-color.js';
import { parseDesignLayerContext, parseDesignScriptPath, parseDesignWebDevice, parseDesignWebUrl, parseDesignWebZoom } from './design-content-source.js';
import { designFontStyles, designFontWeights, type DesignFontStyle, type DesignFontWeight } from './design-fonts.js';
import { designResourceParts, parseDesignId as nodeId, parseDesignLibraryPath, parseDesignResourceId } from './design-resource-id.js';
import { parseDesignScriptInputs, type DesignScriptInputs } from './design-script-parameters.js';
import { parseDesignShaderPaint, type DesignShaderPaint } from './design-shader.js';
import { restoreLegacyDesignArrow } from './legacy-design-arrow.js';
import {
  parseDesignModeSelection, parseDesignVariableCollection, parseDesignVariableCollections, validateDesignVariableCollections,
  type DesignVariableCollection, type DesignVariableCollections, type DesignVariableModeIds,
} from './design-variable-collections.js';
import {
  designLayerVariableFields, designLayoutVariableFields, designTypographyVariableFields, normalizeDesignRotation,
  parseDesignVariable, parseDesignVariableIds, validDesignWidthLimits,
  type DesignVariable, type DesignVariableTarget,
} from './design-variables.js';
import {
  designFreehandPresets, designIconNames, maxDesignPathAnchors, maxDesignPolygonSides, maxDesignSvgPaths, minDesignPolygonSides,
  isStraightDesignPath, parseDesignSvgNumber, parseDesignSvgPathData,
  type DesignPathAnchor, type DesignPathGeometry, type DesignSvgGeometry, type DesignSvgMatrix, type DesignSvgPath, type DesignVectorGeometry,
} from './vector-geometry.js';

type Position = Readonly<{ x: number; y: number }>;
export type DesignSizeMode = 'fixed' | 'hug' | 'fill';
export type DesignQuad = readonly [number, number, number, number];

export type DesignLayout = DesignVariableTarget & Readonly<{
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

export type DesignShadow = DesignVariableTarget & Readonly<{ color: string; styleId?: string; blur: number; x: number; y: number; opacity?: number; hidden?: boolean }>;

export type DesignGradientStop = Readonly<{ offset: number; color: string; opacity?: number; styleId?: string }>;
export const designGradientKinds = ['linear', 'radial', 'angular', 'diamond'] as const;
export const maxDesignGradientStops = 16;
export type DesignGradientAxis = Readonly<{ start: Position; end: Position }>;
export type DesignGradient = Readonly<{
  kind: (typeof designGradientKinds)[number];
  angle?: number;
  /** Layer-relative handles. For non-linear gradients, start is the center. */
  axis?: DesignGradientAxis;
  stops: readonly DesignGradientStop[];
}>;
export const designFillImageFits = ['cover', 'contain', 'stretch'] as const;
export type DesignFillImage = Readonly<{ assetPath: string; fit: (typeof designFillImageFits)[number] }>;
export const designBlendModes = ['normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen', 'color-dodge', 'overlay',
  'soft-light', 'hard-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const;
export type DesignBlendMode = (typeof designBlendModes)[number];
export type DesignPaint = DesignVariableTarget & Readonly<{
  color: string; styleId?: string; opacity?: number; hidden?: boolean;
  gradient?: DesignGradient; image?: DesignFillImage; shader?: DesignShaderPaint; blendMode?: DesignBlendMode;
}>;
export type DesignFill = DesignPaint;
export type DesignStroke = DesignPaint & Readonly<{
  width: number;
  alignment?: 'inside' | 'center' | 'outside';
  join?: 'miter' | 'round' | 'bevel';
}>;
export const maxDesignFills = 32;
export const maxDesignStrokes = 32;
const legacyShapeFill = '#ffffff';
const legacyTextFill = '#1c1f26';
type Fill = Readonly<{ fills?: readonly DesignFill[] }>;
export const designFontFamilies = ['system', 'sans', 'serif', 'mono'] as const;
export const designTextAlignments = ['left', 'center', 'right', 'justify'] as const;
export const designImageFits = ['cover', 'contain'] as const;

export type DesignTypography = DesignVariableTarget & Readonly<{
  fontSize: number;
  fontFamily?: string;
  fontWeight?: DesignFontWeight;
  fontStyle?: DesignFontStyle;
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
  | DesignVariable
  | Readonly<{ kind: 'text'; name: string; typography: DesignTypography }>;

export type DesignInteraction =
  | Readonly<{ kind: 'navigate' | 'overlay'; targetId: string }>
  | Readonly<{ kind: 'back' | 'close' }>;

export type DesignContentOverride = Readonly<{ kind: 'text'; text: string }> | Readonly<{ kind: 'image'; assetPath: string }>;

type Layer = Position & DesignVariableTarget & Readonly<{
  name?: string;
  context?: string;
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
  variableModeIds?: DesignVariableModeIds;
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
export type DesignWeb = Box & Fill & Readonly<{
  kind: 'web';
  url?: string;
  deviceId?: string;
  zoom?: number;
  cornerRadius?: number;
  cornerRadii?: DesignQuad;
}>;
export type DesignScript = Box & Fill & Readonly<{ kind: 'script'; scriptPath?: string; scriptInputs?: DesignScriptInputs }>;
export type DesignNode = DesignFrame | DesignText | DesignRectangle | DesignEllipse | DesignImage | DesignVector | DesignWeb | DesignScript;
export type DesignLibraryLinks = Readonly<Record<string, string>>;
export const maxDesignTreeDepth = 48;
export const maxExpandedDesignLayers = 20_000;
export const designDocumentVersion = 12;

export type DesignDocument = Readonly<{
  schemaVersion: typeof designDocumentVersion;
  documentId: string;
  rootIds: readonly string[];
  nodes: Readonly<Record<string, DesignNode>>;
  styles?: Readonly<Record<string, DesignStyle>>;
  variableCollections?: DesignVariableCollections;
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
  | Readonly<{ kind: 'setVariableCollection'; collectionId: string; collection: DesignVariableCollection | null }>
  | Readonly<{ kind: 'linkLibrary'; documentId: string; path: string }>
  | Readonly<{ kind: 'unlinkLibrary'; documentId: string }>;

export const designDocumentCodec = defineRuntimeCodec<DesignDocument>((input) => {
  const value = record(input);
  const version = value.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > designDocumentVersion) {
    throw new Error('Unsupported design document version.');
  }
  const legacyPaint = version < 8;
  // The v10 arrow tool stored its outline as SVG.
  const legacyArrows = version === 10;
  const nodes = Object.fromEntries(Object.entries(record(value.nodes)).map(([id, node]) => [nodeId(id), parseNode(node, legacyPaint, legacyArrows)]));
  const document = { schemaVersion: designDocumentVersion, documentId: nodeId(value.documentId), rootIds: idList(value.rootIds), nodes,
    styles: optional(value.styles, (value) => Object.fromEntries(Object.entries(record(value)).map(([id, style]) => [nodeId(id), parseDesignStyle(style)]))),
    variableCollections: parseDesignVariableCollections(value.variableCollections, value.variableModes, shortName),
    libraries: optional(value.libraries, (value) => Object.fromEntries(Object.entries(record(value)).map(([id, path]) => [nodeId(id), parseDesignLibraryPath(path)]))) } as const;
  if (document.libraries && Object.hasOwn(document.libraries, document.documentId)) throw new Error('A draft cannot link to itself.');
  indexDesignParents(document);
  validateDesignComponents(document);
  validateDesignVariableCollections(document.styles, document.variableCollections);
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
  if (value.kind === 'unlinkLibrary') return { kind: 'unlinkLibrary', documentId: nodeId(value.documentId) };
  if (value.kind === 'setVariableCollection') {
    return { kind: 'setVariableCollection', collectionId: nodeId(value.collectionId),
      collection: value.collection === null ? null : parseDesignVariableCollection(value.collection, shortName) };
  }
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

function parseNode(input: unknown, legacyPaint = false, legacyArrows = false): DesignNode {
  const value = record(input);
  const minWidth = optional(value.minWidth, spacing);
  const maxWidth = optional(value.maxWidth, dimension);
  if (!validDesignWidthLimits({ minWidth, maxWidth })) throw new Error('Invalid layer width limits.');
  const strokes = parseStrokes(value);
  // Persist the original implicit paint so reopening or editing an older draft preserves its appearance.
  const paint = { fills: parseFills(value) ?? (legacyPaint && value.kind !== 'image' ? [{ color: legacyFillColor(value.kind) }] : undefined) };
  const layer = { ...position(value), width: dimension(value.width),
    variableIds: parseDesignVariableIds(value.variableIds, value.variableIds === undefined ? [] : designLayerVariableFields(value.kind, value.geometry)),
    name: optional(value.name, text), context: optional(value.context, parseDesignLayerContext),
    widthMode: optional(value.widthMode, sizeMode), minWidth, maxWidth,
    rotation: optional(value.rotation, degrees),
    flipX: optional(value.flipX, flag),
    flipY: optional(value.flipY, flag),
    opacity: optional(value.opacity, unitInterval),
    hidden: optional(value.hidden, flag),
    locked: optional(value.locked, flag),
    absolute: optional(value.absolute, flag),
    strokes: legacyPaint && value.kind === 'vector' ? strokes?.map((stroke) => ({ ...stroke, join: stroke.join ?? 'round' })) : strokes,
    shadow: optional(value.shadow, parseShadow),
    interaction: optional(value.interaction, parseInteraction), componentSlot: optional(value.componentSlot, nodeId),
  };
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
        variableModeIds: parseDesignModeSelection(value.variableModeIds),
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
    case 'web':
      return { ...box, ...paint, kind: 'web', url: optional(value.url, parseDesignWebUrl),
        deviceId: optional(value.deviceId, parseDesignWebDevice), zoom: optional(value.zoom, parseDesignWebZoom),
        cornerRadius: optional(value.cornerRadius, spacing), cornerRadii: optional(value.cornerRadii, quad) };
    case 'script':
      return { ...box, ...paint, kind: 'script', scriptPath: optional(value.scriptPath, parseDesignScriptPath),
        scriptInputs: optional(value.scriptInputs, parseDesignScriptInputs) };
    case 'vector':
      return { ...box, ...paint, kind: 'vector', geometry: parseVectorGeometry(value.geometry, legacyArrows) };
    default:
      throw new Error('Unsupported design layer type.');
  }
}

function parseVectorGeometry(input: unknown, legacyArrows: boolean): DesignVectorGeometry {
  const value = record(input);
  if (value.kind === 'polygon') {
    const sides = coordinate(value.sides);
    if (Number.isInteger(sides) && sides >= minDesignPolygonSides && sides <= maxDesignPolygonSides) return { kind: 'polygon', sides };
  } else if (value.kind === 'icon') {
    const icon = option(value.icon, designIconNames);
    if (icon) return { kind: 'icon', icon };
  } else if (value.kind === 'svg') {
    const svg = parseSvgGeometry(value);
    return legacyArrows ? restoreLegacyDesignArrow(svg) ?? svg : svg;
  } else if (value.kind === 'path') {
    const closed = flag(value.closed);
    if (Array.isArray(value.anchors) && value.anchors.length >= (closed ? 3 : 2) && value.anchors.length <= maxDesignPathAnchors) {
      const freehand = optional(value.freehand, (input) => {
        const style = record(input);
        const preset = option(style.preset, designFreehandPresets);
        if (!preset) throw new Error('Invalid drawing preset.');
        return { preset, width: dimension(style.width) };
      });
      const path: DesignPathGeometry = { kind: 'path', closed, anchors: value.anchors.map(parsePathAnchor), ...(freehand ? { freehand } : undefined) };
      const endMarker = option(value.endMarker, ['arrow'] as const);
      if (endMarker && !isStraightDesignPath(path)) throw new Error('An arrow needs two distinct endpoints.');
      return endMarker ? { ...path, endMarker } : path;
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
  const { direction, gap, padding, paddingX, paddingY, paddingSides, align, justify, wrap, variableIds } = record(input);
  if ((direction !== 'horizontal' && direction !== 'vertical') || (align !== 'start' && align !== 'center' && align !== 'end')) {
    throw new Error('Invalid automatic layout.');
  }
  if (justify !== undefined && justify !== 'start' && justify !== 'center' && justify !== 'end'
    && justify !== 'space-between' && justify !== 'space-around') throw new Error('Invalid layout distribution.');
  return { direction, gap: spacing(gap), padding: spacing(padding), align, justify,
    variableIds: parseDesignVariableIds(variableIds, designLayoutVariableFields),
    paddingX: optional(paddingX, spacing), paddingY: optional(paddingY, spacing), paddingSides: optional(paddingSides, quad), wrap: optional(wrap, flag) };
}

function parseStrokes({ strokes, stroke }: Record<string, unknown>): readonly DesignStroke[] | undefined {
  if (strokes === undefined) return stroke === undefined ? undefined : [parseStroke(stroke)];
  if (!Array.isArray(strokes) || strokes.length > maxDesignStrokes) throw new Error('Invalid design stroke stack.');
  return strokes.map(parseStroke);
}

function parseStroke(input: unknown): DesignStroke {
  const value = record(input);
  const { width, alignment, join } = value;
  if (alignment !== undefined && alignment !== 'inside' && alignment !== 'center' && alignment !== 'outside') {
    throw new Error('Invalid stroke alignment.');
  }
  if (join !== undefined && join !== 'miter' && join !== 'round' && join !== 'bevel') throw new Error('Invalid stroke join.');
  return { ...parsePaint(value, 'stroke'), width: dimension(width), alignment, join };
}

function parseShadow(input: unknown): DesignShadow {
  const { color: paint, blur, x, y, opacity, hidden, styleId, variableIds } = record(input);
  return { color: color(paint), blur: spacing(blur), x: coordinate(x), y: coordinate(y),
    opacity: optional(opacity, unitInterval), hidden: optional(hidden, flag), styleId: optional(styleId, parseDesignResourceId),
    variableIds: parseDesignVariableIds(variableIds, ['x', 'y', 'blur', 'opacity']) };
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
    return value.fills.map((entry) => parsePaint(record(entry), 'fill'));
  }
  if (value.fill === null) return [];
  if (value.fill === undefined && value.fillOpacity === undefined && value.fillHidden === undefined) return undefined;
  return [{ color: value.fill === undefined ? legacyFillColor(value.kind) : color(value.fill),
    opacity: optional(value.fillOpacity, unitInterval), hidden: optional(value.fillHidden, flag) }];
}

function parsePaint(value: Record<string, unknown>, kind: 'fill' | 'stroke'): DesignPaint {
  if (value.gradient !== undefined && value.image !== undefined) throw new Error(`A ${kind} cannot contain both a gradient and an image.`);
  if (value.shader !== undefined && (kind !== 'fill' || value.gradient !== undefined || value.image !== undefined)) {
    throw new Error('A shader requires its own fill.');
  }
  return { color: color(value.color), opacity: optional(value.opacity, unitInterval), hidden: optional(value.hidden, flag),
    variableIds: parseDesignVariableIds(value.variableIds, kind === 'stroke' ? ['width', 'opacity'] : ['opacity']),
    styleId: optional(value.styleId, parseDesignResourceId), gradient: optional(value.gradient, parseGradient),
    ...(value.shader === undefined ? {} : { shader: parseDesignShaderPaint(value.shader, parseAssetPath) }),
    blendMode: option(value.blendMode, designBlendModes), image: optional(value.image, (input): DesignFillImage => {
      const image = record(input);
      return { assetPath: parseAssetPath(image.assetPath), fit: option(image.fit, designFillImageFits) ?? 'cover' };
    }) };
}

function legacyFillColor(kind: unknown): string {
  return kind === 'text' ? legacyTextFill : legacyShapeFill;
}

function parseGradient(input: unknown): DesignGradient {
  const { kind: mode, angle, axis, stops } = record(input);
  const kind = option(mode, designGradientKinds);
  if (!kind || !Array.isArray(stops) || stops.length < 2 || stops.length > maxDesignGradientStops) {
    throw new Error('Invalid design gradient.');
  }
  return { kind, angle: optional(angle, degrees), axis: optional(axis, (value) => {
    const { start, end } = record(value);
    const points = { start: position(record(start)), end: position(record(end)) };
    if (points.start.x === points.end.x && points.start.y === points.end.y) throw new Error('Invalid design gradient axis.');
    return points;
  }), stops: stops.map((entry) => {
    const stop = record(entry);
    return { offset: unitInterval(stop.offset), color: color(stop.color), opacity: optional(stop.opacity, unitInterval), styleId: optional(stop.styleId, parseDesignResourceId) };
  }).sort((a, b) => a.offset - b.offset) };
}

function parseTypography(value: Record<string, unknown>): DesignTypography {
  return { fontSize: dimension(value.fontSize), fontFamily: optional(value.fontFamily, shortName),
    fontWeight: option(value.fontWeight, designFontWeights), fontStyle: option(value.fontStyle, designFontStyles),
    lineHeight: optional(value.lineHeight, dimension),
    letterSpacing: optional(value.letterSpacing, coordinate), textAlign: option(value.textAlign, designTextAlignments) };
}

function parseDesignStyle(input: unknown): DesignStyle {
  const value = record(input);
  const name = shortName(value.name);
  if (value.kind === 'text') {
    const typography = record(value.typography);
    return { kind: 'text', name, typography: { ...parseTypography(typography),
      variableIds: parseDesignVariableIds(typography.variableIds, designTypographyVariableFields) } };
  }
  return parseDesignVariable(value, name);
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
  return normalizeDesignRotation(coordinate(value));
}

function sizeMode(value: unknown): DesignSizeMode {
  if (value === 'fixed' || value === 'hug' || value === 'fill') return value;
  throw new Error('Invalid layout sizing mode.');
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
