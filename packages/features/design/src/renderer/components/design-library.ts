import type { DesignDocument, DesignEdit, DesignFrame } from '../../contracts/index.js';
import { remapDesignLayerReferences } from '../../contracts/design-references.js';
import type { Point } from '../design-geometry.js';
import { designInstanceContents, projectDesignComponents } from './design-components.js';
import { designResourceNode, linkedDesignPath, type DesignLibraryResources } from './design-library-resources.js';

export function designComponentDefinitions(document: DesignDocument, resources?: DesignLibraryResources) {
  const linked = Object.entries(resources?.nodes ?? {}).filter(([id]) => linkedDesignPath(document, id));
  return [...Object.entries(document.nodes), ...linked].flatMap(([id, node]) => node.kind === 'frame' && node.component
    ? [{ id, node }] : []);
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
