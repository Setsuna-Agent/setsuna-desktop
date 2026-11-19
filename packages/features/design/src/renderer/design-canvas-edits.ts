import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import type { DesignDocument, DesignEdit, DesignFrame, DesignLayout, DesignNode, DesignText } from '../contracts/index.js';
import { applyDesignEdits } from '../contracts/apply-design-edits.js';
import { remapDesignLayerReferences } from '../contracts/design-references.js';
import { bindDesignVariable, designPaddingVariableFields, normalizeDesignRotation, validDesignWidthLimits,
  type DesignVariableField } from '../contracts/design-variables.js';
import { layerOutline, layerTransform, orientationInParent, rotatePoint, roundDesignValue, toLocal, toLocalVector, toWorld, transformedBounds, unionBounds, type Point } from './design-geometry.js';
import { canDropDesignLayer, changesDesignLayerOrder, designLayerOrder, findDesignFrameAtPoint, type DesignLayerDestination } from './design-layer-drop.js';
import { participatesInDesignFlow, type DesignLayerBox, type DesignScene } from './design-layout.js';
import { measureDesignText } from './design-text.js';

export type LayerPlacement = Point & Readonly<{ width?: number; height?: number; rotation?: number }>;
export type Alignment = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY';

type DesignCanvasDrop = Readonly<{
  id: string;
  center: Point;
  order?: DesignLayerDestination;
  edits: readonly DesignEdit[];
}>;
export type DesignCanvasDropPreview =
  | Readonly<{ phase: 'hover'; drop: DesignCanvasDrop }>
  | Readonly<{ phase: 'saving'; id: string; edits: readonly DesignEdit[] }>;

export function selectedBranches(ids: readonly string[], scene: DesignScene): string[] {
  const selection = new Set(ids);
  return ids.filter((id) => {
    for (let parent = scene[id]?.parentId; parent; parent = scene[parent].parentId) {
      if (selection.has(parent)) return false;
    }
    return true;
  });
}

export function orderDesignBranches(document: DesignDocument, ids: readonly string[]): string[] {
  const selected = new Set(ids);
  const ordered: string[] = [];
  function visit(id: string) {
    if (selected.has(id)) { ordered.push(id); return; }
    const node = document.nodes[id];
    if (node.kind === 'frame') node.childIds.forEach(visit);
  }
  document.rootIds.forEach(visit);
  return ordered;
}

export function isFlowChild(document: DesignDocument, scene: DesignScene, id: string) {
  const parentId = scene[id]?.parentId;
  const parent = parentId ? document.nodes[parentId] : undefined;
  return parent?.kind === 'frame' && Boolean(parent.layout) && participatesInDesignFlow(document.nodes[id], id, parent);
}

export function movePositions(scene: DesignScene, ids: readonly string[], delta: Point): Record<string, LayerPlacement> {
  return Object.fromEntries(ids.map((id) => {
    const box = scene[id];
    const parent = box.parentId ? scene[box.parentId] : undefined;
    const localDelta = toLocalVector(parent, delta);
    return [id, { x: roundDesignValue(box.x + localDelta.x), y: roundDesignValue(box.y + localDelta.y) }];
  }));
}

export function moveDesignLayer(
  document: DesignDocument, scene: DesignScene, nodeId: string, position: Point, projected = document,
): DesignEdit | undefined {
  const box = scene[nodeId];
  if (!box || box.locked) return;
  const parent = box.parentId === null ? undefined : projected.nodes[box.parentId];
  if (parent?.kind !== 'frame' || !parent.layout || !participatesInDesignFlow(projected.nodes[nodeId], nodeId, parent)) {
    if (box.x === position.x && box.y === position.y) return;
    return positionEdit(document, nodeId, box, position);
  }
  const siblings = parent.childIds.filter((id) => participatesInDesignFlow(projected.nodes[id], id, parent));
  const beforeId = designFlowBeforeId(scene, siblings, nodeId, parent.layout,
    { x: position.x + box.width / 2, y: position.y + box.height / 2 });
  if (!changesDesignLayerOrder(siblings, nodeId, beforeId)) return;
  return { kind: 'reorder', nodeId, beforeId };
}

function withLocalPosition<T extends DesignNode>(node: T, position: Point, before?: Point): T {
  // A canvas move replaces just the axes that changed from the resolved position.
  return (['x', 'y'] as const).reduce((current, axis) => before && roundDesignValue(before[axis]) === roundDesignValue(position[axis])
    ? current : bindDesignVariable(current, axis, undefined, position[axis]), node);
}

function positionEdit(document: DesignDocument, nodeId: string, before: Point, position: Point): DesignEdit {
  const node = document.nodes[nodeId];
  return node.variableIds?.x || node.variableIds?.y
    ? { kind: 'update', nodeId, node: withLocalPosition(node, position, before) }
    : { kind: 'move', nodeId, ...position };
}

export function designFlowBeforeId(scene: DesignScene, ids: readonly string[], nodeId: string, layout: DesignLayout, center: Point) {
  const horizontal = layout.direction === 'horizontal';
  const axis = horizontal ? 'x' : 'y';
  const dimension = horizontal ? 'width' : 'height';
  const beforeCenter = (id: string) => id !== nodeId && center[axis] < scene[id][axis] + scene[id][dimension] / 2;
  if (!layout.wrap) return ids.find(beforeCenter) ?? null;

  const cross = horizontal ? 'y' : 'x';
  const crossSize = horizontal ? 'height' : 'width';
  const lines: { first: number; top: number; end: number }[] = [];
  ids.forEach((id, index) => {
    const box = scene[id];
    const top = box[cross];
    const end = top + box[crossSize];
    const line = lines.at(-1);
    // Items in the same flex line overlap along the cross axis, regardless of their alignment.
    if (!line || top >= line.end) lines.push({ first: index, top, end });
    else { line.top = Math.min(line.top, top); line.end = Math.max(line.end, end); }
  });
  if (!lines.length) return null;
  const distance = (line: (typeof lines)[number]) => Math.max(line.top - center[cross], center[cross] - line.end, 0);
  const index = lines.reduce((closest, line, at) => distance(line) < distance(lines[closest]) ? at : closest, 0);
  const following = lines[index + 1]?.first ?? ids.length;
  return ids.slice(lines[index].first, following).find(beforeCenter) ?? ids.slice(following).find((id) => id !== nodeId) ?? null;
}

export function transformDesignLayer(
  document: DesignDocument, scene: DesignScene, nodeId: string, placement: LayerPlacement, projected = document,
): DesignNode | undefined {
  const box = scene[nodeId];
  if (!box || box.locked) return;
  const node = document.nodes[nodeId];
  const drawn = projected.nodes[nodeId];
  const { height, rotation } = placement;
  const width = placement.width === undefined ? undefined : constrainDesignWidth(drawn, placement.width);
  const widthChanged = width !== undefined && width !== box.width;
  const heightChanged = height !== undefined && node.kind !== 'text' && height !== box.height;
  const reposition = !isFlowChild(projected, scene, nodeId) && (box.x !== placement.x || box.y !== placement.y);
  const rotated = rotation !== undefined && rotation !== (drawn.rotation ?? 0);
  if (!widthChanged && !heightChanged && !reposition && !rotated) return;
  let next = reposition ? withLocalPosition(node, placement, box) : node;
  if (rotated) next = bindDesignVariable(next, 'rotation', undefined, rotation);
  if (widthChanged) next = bindDesignVariable({ ...next, widthMode: 'fixed' }, 'width', undefined, width);
  if (heightChanged && next.kind !== 'text') next = bindDesignVariable({ ...next, heightMode: 'fixed' }, 'height', undefined, height);
  return next;
}

type LayerUpdate = Extract<DesignEdit, { kind: 'update' }>;
export type DesignEditGeometry = Readonly<{ projected: DesignDocument; scene: DesignScene }>;

export function constrainDesignWidth(node: DesignNode, width: number) {
  return Math.min(node.maxWidth ?? Infinity, Math.max(node.minWidth ?? 0, width));
}

export function planDesignLayerUpdate(
  document: DesignDocument, nodeId: string, node: DesignNode, geometry?: DesignEditGeometry,
): LayerUpdate[] {
  const current = document.nodes[nodeId];
  const update: LayerUpdate = { kind: 'update', nodeId, node };
  if (current.kind !== 'frame' || !current.group || node.kind !== 'frame') return [update];
  const projected = geometry?.projected ?? document;
  const drawn = projected.nodes[nodeId];
  const baseSize = geometry?.scene[nodeId];

  const changesWidth = node.widthMode === 'fixed' && (node.width !== current.width || node.widthMode !== current.widthMode
    || node.variableIds?.width !== current.variableIds?.width);
  const changesHeight = node.heightMode === 'fixed' && (node.height !== current.height || node.heightMode !== current.heightMode
    || node.variableIds?.height !== current.variableIds?.height);
  // Use the stored dimensions for fixed axes so the layout engine's float32 rounding does not accumulate.
  const beforeWidth = (current.widthMode ?? 'fixed') === 'fixed' && !current.variableIds?.width
    ? constrainDesignWidth(drawn, current.width) : baseSize?.width || drawn.width;
  const beforeHeight = (current.heightMode ?? 'fixed') === 'fixed' && !current.variableIds?.height
    ? current.height : baseSize?.height || current.height;
  const scale = {
    x: changesWidth ? constrainDesignWidth(drawn, node.width) / beforeWidth : 1,
    y: changesHeight ? node.height / beforeHeight : 1,
  };
  if (scale.x === 1 && scale.y === 1) return [update];

  const layout = node.layout && scaleLayout(node.layout, scale, node.layout === current.layout && drawn.kind === 'frame' ? drawn.layout : undefined);
  const edits: LayerUpdate[] = [{ ...update, node: layout ? { ...node, layout } : node }];
  function scaleChild(id: string, parentScale: Point) {
    const child = document.nodes[id];
    const drawn = projected.nodes[id];
    const localScale = scaleAlongRotatedAxes(parentScale, drawn.rotation ?? 0);
    const beforeWidth = constrainDesignWidth(drawn, drawn.width);
    const width = beforeWidth * localScale.x;
    const horizontal = { x: scaleCenterOrigin(drawn.x, beforeWidth, width, parentScale.x), width,
      minWidth: drawn.minWidth === undefined ? undefined : drawn.minWidth * localScale.x,
      maxWidth: drawn.maxWidth === undefined ? undefined : drawn.maxWidth * localScale.x };
    const before = { ...drawn, width: beforeWidth };
    if (child.kind === 'text' && drawn.kind === 'text') {
      const fontSize = drawn.fontSize * localScale.y;
      const letterSpacing = drawn.letterSpacing === undefined ? undefined : drawn.letterSpacing * localScale.x;
      const scaleRuns = (runs: DesignText['runs']) => localScale.y === 1 ? runs
        : runs?.map((run) => run.fontSize === undefined ? run : { ...run, fontSize: run.fontSize * localScale.y });
      const scaled = { ...horizontal, y: drawn.y * parentScale.y, fontSize, letterSpacing };
      if (localScale.y !== parentScale.y) {
        const hug = drawn.widthMode === 'hug';
        const size = measureDesignText(drawn, hug ? undefined : drawn.width);
        const after = measureDesignText({ ...drawn, ...scaled, runs: scaleRuns(drawn.runs) }, hug ? undefined : width);
        scaled.y = scaleCenterOrigin(drawn.y, size.height, after.height, parentScale.y);
        if (hug) scaled.x = scaleCenterOrigin(drawn.x, size.width, after.width, parentScale.x);
      }
      edits.push({ kind: 'update', nodeId: id, node: { ...applyScaledGeometry(child, before, scaled), runs: scaleRuns(child.runs) } });
      return;
    }
    if (drawn.kind === 'text') return;
    const height = drawn.height * localScale.y;
    let scaled = applyScaledGeometry(child, before, { ...horizontal, y: scaleCenterOrigin(drawn.y, drawn.height, height, parentScale.y), height });
    if (scaled.kind === 'frame') {
      if (scaled.instanceOf) scaled = { ...scaled,
        widthMode: localScale.x !== 1 ? scaled.widthMode ?? drawn.widthMode ?? 'fixed' : scaled.widthMode,
        heightMode: localScale.y !== 1 ? scaled.heightMode ?? drawn.heightMode ?? 'fixed' : scaled.heightMode,
      };
      if (scaled.layout) scaled = { ...scaled, layout: scaleLayout(scaled.layout, localScale, drawn.kind === 'frame' ? drawn.layout : undefined) };
    }
    edits.push({ kind: 'update', nodeId: id, node: scaled });
    if (child.kind === 'frame') child.childIds.forEach((id) => scaleChild(id, localScale));
  }
  node.childIds.forEach((id) => scaleChild(id, scale));
  return edits;
}

type ScaledField = 'x' | 'y' | 'width' | 'height' | 'minWidth' | 'maxWidth' | 'fontSize' | 'letterSpacing';
type ScaledGeometry = Partial<Record<ScaledField, number | undefined>>;

function applyScaledGeometry<T extends DesignNode>(node: T, before: ScaledGeometry, scaled: ScaledGeometry): T {
  const updates: ScaledGeometry = {};
  for (const field of Object.keys(scaled) as ScaledField[]) {
    if (before[field] !== scaled[field]) updates[field] = scaled[field];
  }
  if (!validDesignWidthLimits({ ...node, ...updates })) {
    // A bound minimum of zero may stay at zero while the new maximum crosses its authored fallback.
    updates.minWidth = scaled.minWidth;
    updates.maxWidth = scaled.maxWidth;
  }
  // A scaled value can equal its old local fallback while differing from the value on the canvas.
  return (Object.keys(updates) as ScaledField[]).reduce((current, field) => bindDesignVariable(current, field, undefined), { ...node, ...updates });
}

function scaleAlongRotatedAxes(scale: Point, rotation: number): Point {
  if (!rotation || scale.x === scale.y) return scale;
  // Geometric weighting keeps the local ratios reciprocal when the group resize is reversed.
  const verticalWeight = rotatePoint({ x: 1, y: 0 }, rotation).y ** 2;
  const horizontalWeight = 1 - verticalWeight;
  return {
    x: scale.x ** horizontalWeight * scale.y ** verticalWeight,
    y: scale.x ** verticalWeight * scale.y ** horizontalWeight,
  };
}

function scaleCenterOrigin(origin: number, size: number, nextSize: number, scale: number): number {
  // Rotation is about the layer center, which must follow the parent axes even when the size axes differ.
  return origin * scale + (size * scale - nextSize) / 2;
}

function scaleLayout(layout: DesignLayout, { x: scaleX, y: scaleY }: Point, resolved = layout): DesignLayout {
  let next = layout;
  function scaleField(field: DesignVariableField, before: number, factor: number) {
    const value = before * factor;
    // Compare with the drawn value so unchanged axes retain their bindings, even with different fallbacks.
    if (value !== before) next = bindDesignVariable(next, field, undefined, value);
  }
  scaleField('gap', resolved.gap, layout.direction === 'horizontal' ? scaleX : scaleY);
  scaleField('paddingX', resolved.paddingX ?? resolved.padding, scaleX);
  scaleField('paddingY', resolved.paddingY ?? resolved.padding, scaleY);
  layout.paddingSides?.forEach((padding, index) => {
    scaleField(designPaddingVariableFields[index], resolved.paddingSides?.[index] ?? padding, index % 2 ? scaleX : scaleY);
  });
  return next;
}

export function changeDesignLayout(
  document: DesignDocument, scene: DesignScene, nodeId: string, frame: DesignFrame, layout: DesignLayout | undefined,
): DesignEdit[] {
  if (layout || !frame.layout) return [{ kind: 'update', nodeId, node: { ...frame, layout } }];
  // Freeze the solved geometry in the same undoable edit that removes auto layout.
  const box = scene[nodeId];
  const next: DesignFrame = {
    ...frame, layout: undefined,
    ...(frame.widthMode === 'hug' ? { width: Math.max(1, box.width), widthMode: 'fixed' } : {}),
    ...(frame.heightMode === 'hug' ? { height: Math.max(1, box.height), heightMode: 'fixed' } : {}),
  };
  return [{ kind: 'update', nodeId, node: next }, ...frame.childIds.map((id): DesignEdit => {
    const child = scene[id];
    return { kind: 'update', nodeId: id, node: placeFreeLayer(document.nodes[id], child, child.x, child.y) };
  })];
}

export function dropDesignLayer(
  document: DesignDocument, scene: DesignScene, nodeId: string, { parentId, beforeId, center }: DesignLayerDestination, projected = document,
): DesignEdit[] {
  if (!canDropDesignLayer(document, scene, nodeId, parentId)) return [];
  const box = scene[nodeId];
  const destination = parentId === null ? undefined : scene[parentId];
  const local = toLocal(destination, center ?? toWorld(box, { x: box.width / 2, y: box.height / 2 }));
  const position = { x: roundDesignValue(local.x - box.width / 2), y: roundDesignValue(local.y - box.height / 2) };
  const { ids } = designLayerOrder(document, parentId);
  if (box.parentId === parentId) {
    if (center) {
      const edit = moveDesignLayer(document, scene, nodeId, position, projected);
      return edit ? [edit] : [];
    }
    return changesDesignLayerOrder(ids, nodeId, beforeId) ? [{ kind: 'reorder', nodeId, beforeId }] : [];
  }

  const node = document.nodes[nodeId];
  const target = parentId ? projected.nodes[parentId] : undefined;
  const parent = target?.kind === 'frame' ? target : undefined;
  const layout = parent?.layout;
  const inFlow = layout && participatesInDesignFlow(projected.nodes[nodeId], nodeId, parent);
  const nextBeforeId = center && inFlow
    ? designFlowBeforeId(scene, ids.filter((id) => participatesInDesignFlow(projected.nodes[id], id, parent)), nodeId, layout, local)
    : beforeId;
  const next = inFlow ? node : placeFreeLayer(node, box,
    destination && !center ? fitPosition(position.x, box.width, destination.width) : position.x,
    destination && !center ? fitPosition(position.y, box.height, destination.height) : position.y);
  return [
    { kind: 'reparent', nodeId, parentId, beforeId: nextBeforeId },
    { kind: 'update', nodeId, node: { ...orientInParent(next, projected.nodes[nodeId], box, destination), absolute: layout ? next.absolute : undefined } },
  ];
}

export function planDesignCanvasDrop(document: DesignDocument, scene: DesignScene, id: string, center: Point, projected = document): DesignCanvasDrop {
  const parentId = findDesignFrameAtPoint(projected, scene, center, id);
  const edits = dropDesignLayer(document, scene, id, { parentId, beforeId: null, center }, projected);
  const change = edits[0];
  const order = change?.kind === 'reparent' || change?.kind === 'reorder' ? { parentId, beforeId: change.beforeId } : undefined;
  return { id, center, order, edits };
}

export function previewDesignCanvasDrop(document: DesignDocument, scene: DesignScene, id: string, edits: readonly DesignEdit[]) {
  if (!edits.length) return;
  try {
    const next = applyDesignEdits(document, edits);
    const reparent = edits.find((edit) => edit.kind === 'reparent');
    const affectedIds = [id, scene[id].parentId, reparent?.parentId].filter((id): id is string => id != null);
    return { document: next, sourceId: id, affectedIds };
  } catch (error) {
    // The authored hierarchy can be legal while its expanded component tree exceeds the nesting limit.
    if (!(error instanceof FeatureOperationFailure && error.code === 'INVALID_INPUT')) throw error;
  }
}

export function placeFreeLayer(node: DesignNode, box: DesignLayerBox, x: number, y: number): DesignNode {
  return {
    ...withLocalPosition(node, { x: roundDesignValue(x), y: roundDesignValue(y) }),
    ...(node.widthMode === 'fill' ? { width: Math.max(1, box.width), widthMode: 'fixed' } : {}),
    ...(node.kind !== 'text' && node.heightMode === 'fill' ? { height: Math.max(1, box.height), heightMode: 'fixed' } : {}),
  };
}

function orientInParent(node: DesignNode, projected: DesignNode, box: DesignLayerBox, parent?: DesignLayerBox): DesignNode {
  const orientation = orientationInParent(box, parent);
  const rotation = normalizeDesignRotation(orientation.rotation ?? 0);
  if (node.variableIds?.rotation && rotation === roundDesignValue(projected.rotation ?? 0)) {
    return { ...node, flipX: orientation.flipX, flipY: orientation.flipY };
  }
  return bindDesignVariable({ ...node, ...orientation }, 'rotation', undefined, rotation);
}

function fitPosition(position: number, layerSize: number, frameSize: number) {
  return Math.max(0, Math.min(position, frameSize - layerSize));
}

function alignmentSettings(mode: Alignment) {
  const axial = mode === 'left' || mode === 'centerX' || mode === 'right' || mode === 'distributeX';
  const axis = axial ? 'x' : 'y';
  const size = axial ? 'width' : 'height';
  const distributed = mode === 'distributeX' || mode === 'distributeY';
  const factor = mode === 'centerX' || mode === 'centerY' ? 0.5 : Number(mode === 'right' || mode === 'bottom');
  return { axis, size, distributed, factor } as const;
}

export function alignDesignLayerToFrame(document: DesignDocument, scene: DesignScene, nodeId: string, mode: Alignment, projected = document): DesignEdit[] {
  const box = scene[nodeId];
  const { axis, size, distributed, factor } = alignmentSettings(mode);
  if (!box?.parentId || box.locked || distributed || isFlowChild(projected, scene, nodeId)) return [];
  const parent = scene[box.parentId];
  const outline = layerOutline(box, projected.nodes[nodeId]);
  const delta = (parent[size] - outline[size]) * factor - outline[axis];
  if (Math.abs(delta) < 0.005) return [];
  return [positionEdit(document, nodeId, box, { x: box.x, y: box.y, [axis]: roundDesignValue(box[axis] + delta) })];
}

export function alignDesignLayers(document: DesignDocument, scene: DesignScene, ids: readonly string[], mode: Alignment): DesignEdit[] {
  const bounds = unionBounds(ids.map((id) => scene[id].paintBounds));
  if (!bounds || ids.length < 2) return [];
  const { axis, size, distributed, factor } = alignmentSettings(mode);
  if (distributed && ids.length < 3) return [];

  const ordered = [...ids].sort((a, b) => scene[a].paintBounds[axis] - scene[b].paintBounds[axis]);
  const occupied = distributed ? ordered.reduce((sum, id) => sum + scene[id].paintBounds[size], 0) : 0;
  const gap = (bounds[size] - occupied) / (ordered.length - 1);
  let cursor = bounds[axis];
  return ordered.flatMap((nodeId): DesignEdit[] => {
    const box = scene[nodeId].paintBounds;
    const target = distributed ? cursor : bounds[axis] + (bounds[size] - box[size]) * factor;
    cursor += box[size] + gap;
    const delta = target - box[axis];
    if (Math.abs(delta) < 0.005) return [];
    const { x, y } = movePositions(scene, [nodeId], axis === 'x' ? { x: delta, y: 0 } : { x: 0, y: delta })[nodeId];
    return [positionEdit(document, nodeId, scene[nodeId], { x, y })];
  });
}

export function duplicateDesignLayers(document: DesignDocument, scene: DesignScene, ids: readonly string[]) {
  const edits: DesignEdit[] = [];
  const copies: string[] = [];
  const mapping = new Map<string, string>();
  function collect(id: string) {
    mapping.set(id, crypto.randomUUID());
    const node = document.nodes[id];
    if (node.kind === 'frame' && !node.component) node.childIds.forEach(collect);
  }
  ids.forEach(collect);
  function copy(source: string, parentId: string | null, offset: number): string {
    const nodeId = mapping.get(source)!;
    const original = document.nodes[source];
    const node = offset ? withLocalPosition(original, {
      x: (original.variableIds?.x ? scene[source].x : original.x) + offset,
      y: (original.variableIds?.y ? scene[source].y : original.y) + offset,
    }) : original;
    if (node.kind === 'frame' && node.component) {
      edits.push({ kind: 'insert', nodeId, parentId, node: {
        kind: 'frame', instanceOf: source, childIds: [], name: node.name, x: node.x, y: node.y,
        width: node.width, height: node.height, absolute: node.absolute, rotation: node.rotation,
        variableIds: node.variableIds?.rotation ? { rotation: node.variableIds.rotation } : undefined,
        flipX: node.flipX, flipY: node.flipY, hidden: node.hidden, locked: node.locked,
      } });
      return nodeId;
    }
    const duplicate = { ...remapDesignLayerReferences(node, mapping, true), componentSlot: undefined };
    edits.push({ kind: 'insert', nodeId, parentId, node: duplicate.kind === 'frame' ? { ...duplicate, childIds: [] } : duplicate });
    if (original.kind === 'frame') original.childIds.forEach((child) => copy(child, nodeId, 0));
    return nodeId;
  }
  for (const id of ids) {
    const parentId = scene[id].parentId;
    const frame = parentId === null ? undefined : document.nodes[parentId];
    const order = frame?.kind === 'frame' ? frame.childIds : document.rootIds;
    const nodeId = copy(id, parentId, 16);
    edits.push({ kind: 'reorder', nodeId, beforeId: order[order.indexOf(id) + 1] ?? null });
    copies.push(nodeId);
  }
  return { edits, copies };
}

export function canGroupDesignLayers(document: DesignDocument, scene: DesignScene, ids: readonly string[]): boolean {
  if (!ids.length) return false;
  const first = scene[ids[0]];
  const flows = isFlowChild(document, scene, ids[0]);
  return ids.every((id) => !scene[id].locked && scene[id].parentId === first.parentId && isFlowChild(document, scene, id) === flows);
}

export function groupDesignLayers(
  document: DesignDocument, scene: DesignScene, ids: readonly string[], name: string,
  frame: Pick<DesignFrame, 'group' | 'component' | 'layout' | 'maskId'> = { group: true }, projected = document,
) {
  const id = crypto.randomUUID();
  const parentId = scene[ids[0]].parentId;
  const parent = parentId ? document.nodes[parentId] : undefined;
  const siblings = parent?.kind === 'frame' ? parent.childIds : document.rootIds;
  const order = siblings.filter((childId) => ids.includes(childId));
  const flows = isFlowChild(projected, scene, ids[0]);
  const bounds = unionBounds(order.map((childId) => {
    const box = scene[childId];
    return transformedBounds({ ...box, ...layerTransform(box, projected.nodes[childId]) });
  }));
  if (!bounds) return { id, edits: [] };
  const edits: DesignEdit[] = [{
    kind: 'insert', nodeId: id, parentId, node: {
      kind: 'frame', name, ...frame, fills: [], clip: false, x: bounds.x, y: bounds.y,
      width: Math.max(1, bounds.width), height: Math.max(1, bounds.height), childIds: [],
      ...(frame.layout ? { widthMode: 'hug', heightMode: 'hug' } : {}),
      absolute: parent?.kind === 'frame' && parent.layout ? !flows : undefined,
    },
  }, { kind: 'reorder', nodeId: id, beforeId: flows ? order[0] : siblings[siblings.indexOf(order[order.length - 1]) + 1] ?? null }];
  for (const child of order) {
    const box = scene[child];
    const node = placeFreeLayer(document.nodes[child], box, box.x - bounds.x, box.y - bounds.y);
    edits.push({ kind: 'reparent', nodeId: child, parentId: id, beforeId: null },
      { kind: 'update', nodeId: child, node: { ...node, absolute: undefined } });
  }
  return { id, edits };
}

export function ungroupDesignLayer(document: DesignDocument, scene: DesignScene, nodeId: string, group: DesignFrame, projected = document): DesignEdit[] {
  const parentId = scene[nodeId].parentId;
  const parent = parentId ? document.nodes[parentId] : undefined;
  const parentBox = parentId ? scene[parentId] : undefined;
  const absolute = parent?.kind === 'frame' && parent.layout && group.absolute;
  const { opacity = 1, hidden } = projected.nodes[nodeId];
  const edits: DesignEdit[] = [];
  for (const childId of group.childIds) {
    const child = document.nodes[childId];
    const box = scene[childId];
    const center = toLocal(parentBox, toWorld(box, { x: box.width / 2, y: box.height / 2 }));
    let next = placeFreeLayer(child, box, center.x - box.width / 2, center.y - box.height / 2);
    if (opacity !== 1) next = bindDesignVariable(next, 'opacity', undefined, opacity * (projected.nodes[childId].opacity ?? 1));
    if (hidden) next = bindDesignVariable(next, 'hidden', undefined, true);
    edits.push({ kind: 'reparent', nodeId: childId, parentId, beforeId: nodeId }, {
      kind: 'update', nodeId: childId, node: {
        ...orientInParent(next, projected.nodes[childId], box, parentBox), absolute: absolute || child.absolute,
      },
    });
  }
  return [...edits, { kind: 'remove', nodeId }];
}
