import stripJsonComments from 'strip-json-comments';
import { designDefaultColor } from '../../../contracts/design-color.js';
import { designDocumentVersion, maxDesignTreeDepth, maxExpandedDesignLayers, type DesignFrame, type DesignNode, type DesignSizeMode } from '../../../contracts/document.js';
import type { CreateDesignDocumentInput } from '../../../contracts/operations.js';
import { defaultDesignPolygonSides, maxDesignPolygonSides, minDesignPolygonSides, type DesignSvgGeometry } from '../../../contracts/vector-geometry.js';
import type { DesignFontClient } from '../../client.js';
import { rotatePoint } from '../../design-geometry.js';
import { fitPenOverlays } from './overlay-layout.js';
import { penCorners, penFills, penLayout, penShadow, penStrokes, penTypography } from './style.js';
import { createPenValues, penNumber, penObject, penOpacity, penPositive, type PenObject, type PenValues, type ReadPenValue } from './values.js';
import { penIcon, penPath } from './vector.js';

type ImportedLayers = NonNullable<CreateDesignDocumentInput['initialLayers']>;
type PenOverrides = Readonly<{ fields: PenObject; prefix: string }>;
type PenSize = Readonly<{ size: number; mode?: DesignSizeMode }>;

const invalidPenFile = 'Expected a Pencil 2.x JSON document.';
const penTreeTooLarge = 'The PEN file has too many layers or is nested too deeply.';

export async function importPencilLayers(source: string, fonts?: Pick<DesignFontClient, 'list' | 'read'>): Promise<ImportedLayers> {
  let document: PenObject | undefined;
  try { document = penObject(JSON.parse(stripJsonComments(source.replace(/^\ufeff/u, '')))); }
  catch { throw new Error(invalidPenFile); }
  if (typeof document?.version !== 'string' || !/^2\.\d+(?:\.\d+)?$/u.test(document.version) || !Array.isArray(document.children)) {
    throw new Error(invalidPenFile);
  }

  const sources = indexPenLayers(document.children);
  const values = createPenValues(document);
  const nodes: Record<string, DesignNode> = {};
  const icons = new Map<string, DesignSvgGeometry | undefined>();
  const activeReferences = new Set<PenObject>();
  let layerCount = 0;

  async function addLayer(raw: unknown, parentHasLayout: boolean, depth: number, overrides: readonly PenOverrides[], inherited: PenValues): Promise<string> {
    if (depth > maxDesignTreeDepth || ++layerCount > maxExpandedDesignLayers) throw new Error(penTreeTooLarge);
    const id = `layer-${layerCount}`;
    const original = readPenLayer(raw);
    const originalId = typeof original.id === 'string' ? original.id : '';
    const node = applyPenOverrides(original, originalId, overrides);
    const references = new Set<PenObject>();
    let source = node;
    while (source.type === 'ref' && typeof source.ref === 'string') {
      const target = selectPenReference(sources.get(source.ref), source.variant);
      if (!target || activeReferences.has(target) || references.has(target)) break;
      if (references.size >= maxDesignTreeDepth) throw new Error(penTreeTooLarge);
      references.add(target);
      source = target;
    }
    // A missing or cyclic reference keeps the authored instance's own placement.
    if (!references.size || source.type === 'ref') {
      nodes[id] = await convertLayer(node, parentHasLayout, depth, overrides, inherited.withTheme(node.theme));
      return id;
    }

    let expanded: PenObject = {};
    let scope = inherited;
    const nested: PenOverrides[] = [];
    // Apply prototype fields and descendant overrides from the source outward to the placed instance.
    for (const layer of [...references].reverse().concat(node)) {
      expanded = { ...expanded, ...layer };
      scope = scope.withTheme(layer.theme);
      const fields = layer.type === 'ref' ? penObject(layer.descendants) : undefined;
      if (fields) nested.push({ fields, prefix: '' });
    }
    for (const { fields, prefix } of overrides) nested.push({ fields, prefix: `${prefix}${originalId}/` });
    for (const target of references) activeReferences.add(target);
    try {
      nodes[id] = await convertLayer({ ...expanded, type: source.type, x: node.x, y: node.y, layoutPosition: node.layoutPosition },
        parentHasLayout, depth, nested, scope);
    } finally {
      for (const target of references) activeReferences.delete(target);
    }
    return id;
  }

  async function convertLayer(node: PenObject, parentHasLayout: boolean, depth: number, overrides: readonly PenOverrides[], scope: PenValues): Promise<DesignNode> {
    const { read } = scope;
    const { type } = node;
    const absolute = node.layoutPosition === 'absolute';
    const inFlow = parentHasLayout && !absolute;
    const layout = type === 'frame' || type === 'variants' ? penLayout(node, read) : undefined;
    const childIds: string[] = [];
    if (Array.isArray(node.children)) {
      for (const child of node.children) childIds.push(await addLayer(child, Boolean(layout), depth + 1, overrides, scope));
    }
    const children = childIds.map((id) => nodes[id]);
    const hugsChildren = Boolean(layout) && children.some((child) => !child.absolute && !child.hidden);
    const naturalSize = layout ? undefined : childBounds(children);
    const width = penSize(read(node.width), naturalSize?.width ?? 1, inFlow, hugsChildren);
    const height = penSize(read(node.height), naturalSize?.height ?? 1, inFlow, hugsChildren);
    const size = { width: width.size, height: height.size };
    const fills = penFills(node.fill, read);
    const layer = { ...penPlacement(node, size, inFlow, read), width: size.width, widthMode: width.mode,
      name: typeof node.name === 'string' ? node.name : undefined, absolute: absolute || undefined,
      hidden: read(node.enabled) === false || undefined, locked: read(node.locked) === true || undefined,
      opacity: penOpacity(read(node.opacity)), fills, strokes: penStrokes(node, read), shadow: penShadow(node.effect, read) };
    const box = { ...layer, height: size.height, heightMode: height.mode };

    // Only frame layers can own children. Preserve the subtree of unfamiliar containers.
    const frame: DesignFrame = { ...box, kind: 'frame', childIds, layout, ...penCorners(node.cornerRadius, read),
      clip: read(node.clip) === true, group: type === 'group' || undefined };
    if (childIds.length || type === 'frame' || type === 'group' || type === 'variants') return frame;
    switch (type) {
      case 'rectangle': return { ...box, kind: 'rectangle', ...penCorners(node.cornerRadius, read) };
      case 'ellipse': return { ...box, kind: 'ellipse' };
      case 'text':
      case 'note': {
        const content = read(node.content);
        const growth = node.textGrowth;
        const fixed = type === 'note' ? node.width !== undefined : growth === 'fixed-width' || growth === 'fixed-width-height';
        return { ...layer, ...penTypography(node, read), kind: 'text', text: typeof content === 'string' ? content : '',
          widthMode: fixed ? width.mode : 'hug' };
      }
      case 'polygon': {
        const sides = Math.round(penNumber(read(node.polygonCount)) ?? defaultDesignPolygonSides);
        return { ...box, kind: 'vector', geometry: { kind: 'polygon', sides: Math.min(maxDesignPolygonSides, Math.max(minDesignPolygonSides, sides)) } };
      }
      case 'path': {
        const geometry = penPath(node);
        if (!geometry) return frame;
        return { ...box, kind: 'vector', geometry, width: node.width === undefined ? geometry.viewBox.width : size.width,
          height: node.height === undefined ? geometry.viewBox.height : size.height };
      }
      case 'icon':
      case 'icon_font': {
        const geometry = await penIcon(node, read, icons);
        if (!geometry) return { ...frame, fills: undefined };
        const scale = Math.max(size.width / geometry.viewBox.width, size.height / geometry.viewBox.height);
        return { ...box, kind: 'vector', geometry, fills: [], strokes: (fills ?? [{ color: designDefaultColor }])
          .map((paint) => ({ ...paint, width: 2 * scale, join: 'round' })) };
      }
      // Imported live content has no URL or path. It needs an explicit edit before it can load anything.
      case 'browser': return { ...box, kind: 'web', ...penCorners(node.cornerRadius, read) };
      case 'script': return { ...box, kind: 'script' };
      default: return frame;
    }
  }

  const rootIds: string[] = [];
  for (const node of document.children) rootIds.push(await addLayer(node, false, 0, [], values));
  return { rootIds, nodes: await fitPenOverlays({ schemaVersion: designDocumentVersion, documentId: 'pen-import', rootIds, nodes }, fonts) };
}

function readPenLayer(value: unknown): PenObject {
  const node = penObject(value);
  if (typeof node?.type !== 'string' || !node.type) throw new Error('The PEN file contains an invalid layer.');
  return node;
}

function indexPenLayers(children: readonly unknown[]) {
  const sources = new Map<string, PenObject>();
  let count = 0;
  function visit(raw: unknown, depth: number) {
    if (depth > maxDesignTreeDepth || ++count > maxExpandedDesignLayers) throw new Error(penTreeTooLarge);
    const node = readPenLayer(raw);
    if (typeof node.id === 'string') {
      if (sources.has(node.id)) throw new Error('The PEN file contains duplicate layer IDs.');
      sources.set(node.id, node);
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child, depth + 1);
  }
  for (const child of children) visit(child, 0);
  return sources;
}

function selectPenReference(source: PenObject | undefined, variant: unknown): PenObject | undefined {
  if (source?.type !== 'variants') return source;
  const axes = penObject(source.reusable) ?? {};
  const requested = penObject(variant);
  const choices = Object.entries(axes).map(([axis, options]) => [axis,
    requested && Object.hasOwn(requested, axis) ? requested[axis] : Array.isArray(options) ? options[0] : undefined,
  ] as const);

  function findVariant(children: unknown): PenObject | undefined {
    if (!Array.isArray(children)) return;
    for (const raw of children) {
      const child = readPenLayer(raw);
      if (child.type === 'variants') continue;
      // Reusable layers are variant roots. Their own reusable children belong to the component.
      if (child.reusable === true) return child;
      const variantAxes = penObject(child.reusable);
      if (variantAxes) {
        if (choices.every(([axis, option]) => !Object.hasOwn(variantAxes, axis) || variantAxes[axis] === option)) return child;
        continue;
      }
      const nested = findVariant(child.children);
      if (nested) return nested;
    }
  }
  return findVariant(source.children);
}

function applyPenOverrides(node: PenObject, id: string, overrides: readonly PenOverrides[]): PenObject {
  if (!id) return node;
  return overrides.reduce((layer, { fields, prefix }) => {
    const key = prefix + id;
    const patch = Object.hasOwn(fields, key) ? penObject(fields[key]) : undefined;
    if (!patch) return layer;
    return typeof patch.type === 'string' ? patch : { ...layer, ...patch };
  }, node);
}

function childBounds(children: readonly DesignNode[]) {
  let width = 1;
  let height = 1;
  for (const child of children) {
    width = Math.max(width, child.x + child.width);
    height = Math.max(height, child.y + ('height' in child ? child.height : child.fontSize));
  }
  return { width, height };
}

function penSize(value: unknown, fallback: number, canFill: boolean, canHug: boolean): PenSize {
  const fixed = penPositive(value);
  if (fixed !== undefined) return { size: fixed };
  const dynamic = typeof value === 'string' ? /^(fit_content|fill_container)(?:\(([^()]+)\))?$/u.exec(value) : null;
  const size = dynamic ? penPositive(Number(dynamic[2])) ?? fallback : fallback;
  if (canFill && dynamic?.[1] === 'fill_container') return { size, mode: 'fill' };
  if (canHug && (value === undefined || dynamic?.[1] === 'fit_content')) return { size, mode: 'hug' };
  return { size };
}

function penPlacement(node: PenObject, size: { width: number; height: number }, inFlow: boolean, read: ReadPenValue) {
  const x = penNumber(node.x) ?? 0;
  const y = penNumber(node.y) ?? 0;
  const rotation = -((penNumber(read(node.rotation)) ?? 0) % 360);
  const flipX = read(node.flipX) === true || undefined;
  const flipY = read(node.flipY) === true || undefined;
  if (!rotation || inFlow) return { x, y, rotation: rotation || undefined, flipX, flipY };
  // Pencil rotates about the top-left corner. Setsuna rotates about the layer center.
  const center = { x: size.width / 2, y: size.height / 2 };
  const rotated = rotatePoint(center, rotation);
  return { x: x + rotated.x - center.x, y: y + rotated.y - center.y, rotation, flipX, flipY };
}
