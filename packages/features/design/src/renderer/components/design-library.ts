import type { Yoga } from 'yoga-layout/load';
import type { DesignDocument, DesignEdit, DesignFrame } from '../../contracts/index.js';
import { remapDesignLayerReferences } from '../../contracts/design-references.js';
import { designFlowBeforeId } from '../design-canvas-edits.js';
import { roundDesignValue, toLocal, type Bounds, type Point } from '../design-geometry.js';
import { centerDesignLayer, resolveDesignInsertion } from '../design-insertion.js';
import { findDesignFrameAtPoint } from '../design-layer-drop.js';
import { participatesInDesignFlow, resolveDesignScene, type DesignScene } from '../design-layout.js';
import { measureDesignText } from '../design-text.js';
import { designPrototypeBoardFor } from '../prototype/design-prototype.js';
import { containsDesignLayer, designInstanceContents, projectDesignComponents } from './design-components.js';
import { designResourceNode, linkedDesignPath, type DesignLibraryResources } from './design-library-resources.js';

export function designComponentDefinitions(document: DesignDocument, resources?: DesignLibraryResources) {
  const linked = Object.entries(resources?.nodes ?? {}).filter(([id]) => linkedDesignPath(document, id));
  return [...Object.entries(document.nodes), ...linked].flatMap(([id, node]) => node.kind === 'frame' && node.component
    ? [{ id, node }] : []);
}

export function planDesignComponentInsertion({ document, projected, resources, scene, layoutEngine, sourceId, target }: Readonly<{
  document: DesignDocument; projected: DesignDocument; resources: DesignLibraryResources; scene: DesignScene; layoutEngine: Yoga;
  sourceId: string; target: Readonly<{ root: true } | { point: Point } | { area?: Bounds; selectedId: string | null }>;
}>): Readonly<{ id: string; edits: readonly DesignEdit[] }> | undefined {
  const source = designResourceNode(document, sourceId, resources);
  if (source?.kind !== 'frame' || !source.component) return;
  const sourceBox = scene[sourceId];
  const size = { width: Math.max(1, sourceBox?.width ?? source.width), height: Math.max(1, sourceBox?.height ?? source.height) };
  const canInsert = (id: string) => !containsDesignLayer(document, sourceId, id, resources);
  const point = 'point' in target ? target.point : undefined;
  const underPointer = point && findDesignFrameAtPoint(projected, scene, point);
  const anchor = ('selectedId' in target && target.selectedId ? scene[target.selectedId]?.paintBounds : undefined) ?? sourceBox?.paintBounds;
  const { parentId, center } = 'root' in target ? { parentId: null, center: { x: 0, y: 0 } } : 'point' in target
    ? { parentId: underPointer && canInsert(underPointer) ? underPointer : null, center: target.point }
    : resolveDesignInsertion(document, scene, target.area ?? anchor ?? { x: 0, y: 0, ...size }, target.selectedId, canInsert);
  const nodeId = crypto.randomUUID();
  const instance = { kind: 'frame', name: source.name, childIds: [], instanceOf: sourceId, ...size } as const;
  const boardId = designPrototypeBoardFor(parentId, scene);
  const parent = parentId ? projected.nodes[parentId] : undefined;
  if (parentId && boardId && parent?.kind === 'frame') {
    const frame = scene[parentId];
    const local = toLocal(frame, center);
    const node = { ...instance, ...centerDesignLayer(point ? local : center, size, point ? undefined : frame) };
    const beforeId = point && parent.layout ? designFlowBeforeId(scene,
      parent.childIds.filter((id) => participatesInDesignFlow(projected.nodes[id], id, parent)), nodeId, parent.layout, local) : null;
    const childIds = [...parent.childIds];
    childIds.splice(beforeId ? childIds.indexOf(beforeId) : childIds.length, 0, nodeId);
    // Use the destination board's modes and layout before deciding whether it can contain the instance.
    const draft = { ...document, nodes: { ...document.nodes, [nodeId]: node,
      [parentId]: { ...document.nodes[parentId], childIds } } };
    const preview = projectDesignComponents(draft, resources);
    const { paintBounds, visibleBounds } = resolveDesignScene(layoutEngine, preview, measureDesignText, { rootIds: [boardId] })[nodeId];
    if (visibleBounds && roundDesignValue(paintBounds.width - visibleBounds.width) === 0
      && roundDesignValue(paintBounds.height - visibleBounds.height) === 0) {
      const edits: DesignEdit[] = [{ kind: 'insert', nodeId, parentId, node }];
      if (beforeId) edits.push({ kind: 'reorder', nodeId, beforeId });
      return { id: nodeId, edits };
    }
  }
  const beside = point ? undefined : boardId ? scene[boardId].paintBounds : anchor;
  const position = beside ? { x: beside.x + beside.width + 24, y: beside.y } : centerDesignLayer(center, size);
  return { id: nodeId, edits: [{ kind: 'insert', nodeId, parentId: null, node: { ...instance, ...position } }] };
}

export function designComponentVariants(document: DesignDocument, sourceId: string, resources?: DesignLibraryResources) {
  const source = designResourceNode(document, sourceId, resources);
  const set = source?.kind === 'frame' ? source.componentSet ?? sourceId : sourceId;
  return designComponentDefinitions(document, resources).filter(({ id, node }) => id === set || node.componentSet === set)
    .sort((a, b) => Number(b.id === set) - Number(a.id === set));
}

export function createDesignVariant(document: DesignDocument, sourceId: string, name: string, position: Point) {
  const source = document.nodes[sourceId];
  if (source?.kind !== 'frame' || !source.component) return;
  const componentSet = source.componentSet ?? sourceId;
  const ids = new Map<string, string>();
  function collect(id: string) {
    ids.set(id, crypto.randomUUID());
    const node = document.nodes[id];
    if (node.kind === 'frame') node.childIds.forEach(collect);
  }
  collect(sourceId);

  const edits: DesignEdit[] = [];
  function append(id: string, parentId: string | null) {
    const original = document.nodes[id];
    const nodeId = ids.get(id)!;
    const mapped = remapDesignLayerReferences(original, ids);
    const node = id === sourceId && mapped.kind === 'frame'
      ? { ...mapped, ...position, absolute: undefined, componentSet, variantName: name }
      : { ...mapped, componentSlot: original.componentSlot ?? id };
    edits.push({ kind: 'insert', nodeId, parentId, node: node.kind === 'frame' ? { ...node, childIds: [] } : node });
    if (original.kind === 'frame') original.childIds.forEach((childId) => append(childId, nodeId));
  }
  append(sourceId, null);
  return { id: ids.get(sourceId)!, edits };
}

export function changeDesignVariant(document: DesignDocument, projected: DesignDocument, instanceId: string, targetId: string,
  resources?: DesignLibraryResources,
): DesignFrame | undefined {
  const instance = document.nodes[instanceId];
  if (instance?.kind !== 'frame' || !instance.instanceOf || !designComponentVariants(document, instance.instanceOf, resources).some(({ id }) => id === targetId)) return;
  const next = { ...instance, instanceOf: targetId, contentOverrides: undefined };
  if (!instance.contentOverrides) return next;
  const slot = (path: string) => path.split('/').map((id) => designResourceNode(document, id, resources)?.componentSlot ?? id).join('/');
  const bySlot = new Map(designInstanceContents(projected, instanceId).flatMap(({ path, node }) => {
    const override = instance.contentOverrides?.[path];
    return override?.kind === node.kind ? [[slot(path), override] as const] : [];
  }));
  const nextProjection = projectDesignComponents({ ...document, nodes: { ...document.nodes, [instanceId]: next } }, resources);
  const contentOverrides = Object.fromEntries(designInstanceContents(nextProjection, instanceId).flatMap(({ path, node }) => {
    const override = bySlot.get(slot(path));
    return override?.kind === node.kind ? [[path, override]] : [];
  }));
  return { ...next, contentOverrides };
}
