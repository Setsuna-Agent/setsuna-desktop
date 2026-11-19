import { rebaseDesignTextRuns, resolveDesignNodeStyles, type DesignContentOverride, type DesignDocument, type DesignEdit, type DesignFrame, type DesignNode } from '../../contracts/index.js';
import { maxDesignTreeDepth, maxExpandedDesignLayers } from '../../contracts/document.js';
import { remapDesignLayerReferences } from '../../contracts/design-references.js';
import { designResourceParts } from '../../contracts/design-resource-id.js';
import { designStylesForModes } from '../../contracts/design-styles.js';
import { bindDesignVariable, validDesignWidthLimits, type DesignVariableIds } from '../../contracts/design-variables.js';
import { designResourceNode, linkedDesignPath, mapDesignNodeResourceIds, type DesignLibraryResources } from './design-library-resources.js';

type OverrideScope = Readonly<{ root: string; overrides: NonNullable<DesignFrame['contentOverrides']> }>;

export function projectDesignComponents(authored: DesignDocument, resources?: DesignLibraryResources): DesignDocument {
  const styles = resources && Object.keys(resources.styles).length ? { ...authored.styles, ...resources.styles } : authored.styles;
  if ((!styles || !Object.keys(styles).length) && !Object.values(authored.nodes).some((node) => node.kind === 'frame' && node.instanceOf)) {
    return authored;
  }
  const defaults = designStylesForModes(styles, authored.documentId);
  const nodes: Record<string, DesignNode> = { ...authored.nodes };
  const instances: { id: string; styles: DesignDocument['styles'] }[] = [];
  function visit(id: string, scoped: DesignDocument['styles']) {
    const node = resolveDesignNodeStyles(authored.nodes[id], scoped);
    nodes[id] = node;
    if (node.kind !== 'frame') return;
    if (node.instanceOf) instances.push({ id, styles: scoped });
    node.childIds.forEach((child) => visit(child, scoped));
  }
  for (const id of authored.rootIds) {
    const root = authored.nodes[id];
    const scoped = root.kind === 'frame' && root.variableModeIds
      ? designStylesForModes(styles, authored.documentId, root.variableModeIds) : defaults;
    visit(id, scoped);
  }
  if (!instances.length) return { ...authored, styles, nodes };

  const activeSources = new Set<string>();
  const resolvedSources = new Map<DesignDocument['styles'], Map<string, DesignNode>>();
  let remaining = Math.max(0, maxExpandedDesignLayers - Object.keys(nodes).length);

  function getNode(id: string, scoped: DesignDocument['styles']): DesignNode | undefined {
    let cache = resolvedSources.get(scoped);
    const cached = cache?.get(id);
    if (cached) return cached;
    const source = designResourceNode(authored, id, resources);
    if (!source) return;
    const resolved = resolveDesignNodeStyles(source, scoped);
    if (!cache) resolvedSources.set(scoped, cache = new Map());
    cache.set(id, resolved);
    return resolved;
  }

  function project(id: string, sourceId: string, instanceRoot: string, scoped: DesignDocument['styles'], scopes: readonly OverrideScope[] = [], depth = 0) {
    // The instance's board supplies modes even for sources authored on a different board.
    const node = getNode(sourceId, scoped);
    if (!node) return;
    if (node.kind !== 'frame') {
      // The outer instance's explicit choice takes precedence over a nested instance's authored defaults.
      let override: DesignContentOverride | undefined;
      for (const { root, overrides } of scopes) {
        const path = id.slice(root.length + 1);
        const content = Object.hasOwn(overrides, path) ? overrides[path] : undefined;
        if (content?.kind === node.kind) {
          override = content;
          break;
        }
      }
      nodes[id] = node.kind === 'text' && override?.kind === 'text' ? bindDesignVariable({ ...node, text: override.text,
        runs: rebaseDesignTextRuns(node.text, override.text, node.runs) }, 'text', undefined)
        : node.kind === 'image' && override?.kind === 'image' ? { ...node, assetPath: override.assetPath } : node;
      return;
    }
    const source = node.instanceOf ? getNode(node.instanceOf, scoped) : node;
    // A linked file can disappear or introduce a cycle independently of the edited document.
    if (source?.kind !== 'frame' || (node.instanceOf && (!source.component || activeSources.has(node.instanceOf)))) {
      nodes[id] = node;
      return;
    }
    const childRoot = node.instanceOf ? id : instanceRoot;
    const nextScopes = node.contentOverrides ? [...scopes, { root: id, overrides: node.contentOverrides }] : scopes;
    const childIds: string[] = [];
    if (node.instanceOf) activeSources.add(node.instanceOf);
    if (depth < maxDesignTreeDepth) for (const childId of source.childIds) {
      if (remaining <= 0) break;
      remaining -= 1;
      const projectedId = `${childRoot}/${childId}`;
      project(projectedId, childId, childRoot, scoped, nextScopes, depth + 1);
      if (Object.hasOwn(nodes, projectedId)) childIds.push(projectedId);
    }
    if (node.instanceOf) activeSources.delete(node.instanceOf);
    const maskId = source.maskId && childIds.includes(`${childRoot}/${source.maskId}`) ? `${childRoot}/${source.maskId}` : undefined;
    nodes[id] = node.instanceOf ? {
      ...source,
      name: node.name ?? source.name,
      x: node.x, y: node.y,
      rotation: node.rotation, flipX: node.flipX, flipY: node.flipY,
      hidden: node.hidden ?? (source.variableIds?.hidden ? source.hidden : undefined),
      locked: node.locked, absolute: node.absolute,
      ...instanceWidthLimits(source, node),
      interaction: node.interaction ?? source.interaction,
      opacity: node.opacity ?? source.opacity,
      width: node.widthMode ? node.width : source.width,
      height: node.heightMode ? node.height : source.height,
      widthMode: node.widthMode ?? (source.widthMode === 'hug' ? 'hug' : undefined),
      heightMode: node.heightMode ?? (source.heightMode === 'hug' ? 'hug' : undefined),
      variableModeIds: node.variableModeIds,
      variableIds: instanceVariableIds(source, node),
      instanceOf: node.instanceOf, component: undefined, childIds, maskId,
    } : { ...node, childIds, maskId };
  }

  for (const { id, styles } of instances) project(id, id, id, styles);
  return { ...authored, styles, nodes };
}

function instanceWidthLimits(source: DesignFrame, instance: DesignFrame) {
  const limits = { minWidth: instance.minWidth ?? source.minWidth, maxWidth: instance.maxWidth ?? source.maxWidth };
  // A mode can leave the instance's own limit incompatible with one inherited from its source.
  return validDesignWidthLimits(limits) ? limits : { minWidth: instance.minWidth, maxWidth: instance.maxWidth };
}

function instanceVariableIds(source: DesignFrame, instance: DesignFrame): DesignVariableIds | undefined {
  if (!source.variableIds && !instance.variableIds) return;
  const ids = { ...source.variableIds };
  const local = [
    'x', 'y', 'rotation',
    ...(instance.minWidth !== undefined || instance.variableIds?.minWidth ? ['minWidth'] as const : []),
    ...(instance.maxWidth !== undefined || instance.variableIds?.maxWidth ? ['maxWidth'] as const : []),
    ...(instance.hidden !== undefined ? ['hidden'] as const : []), ...(instance.opacity !== undefined ? ['opacity'] as const : []),
    ...(instance.widthMode ? ['width'] as const : []), ...(instance.heightMode ? ['height'] as const : []),
  ] as const;
  for (const field of local) {
    const id = instance.variableIds?.[field];
    if (id) ids[field] = id;
    else delete ids[field];
  }
  return Object.keys(ids).length ? ids : undefined;
}

export function designInstanceContents(document: DesignDocument, id: string) {
  const content: { path: string; node: Extract<DesignNode, { kind: 'text' | 'image' }> }[] = [];
  function visit(childId: string) {
    const node = document.nodes[childId];
    if (node.kind === 'text' || node.kind === 'image') content.push({ path: childId.slice(id.length + 1), node });
    else if (node.kind === 'frame') node.childIds.forEach(visit);
  }
  const root = document.nodes[id];
  if (root?.kind === 'frame' && root.instanceOf) root.childIds.forEach(visit);
  return content;
}

export function withDesignInstanceContent(instance: DesignFrame, path: string, override: DesignContentOverride | undefined): DesignFrame {
  const overrides = Object.assign(Object.create(null) as Record<string, DesignContentOverride>, instance.contentOverrides);
  if (override) overrides[path] = override;
  else delete overrides[path];
  return { ...instance, contentOverrides: Object.keys(overrides).length ? overrides : undefined };
}

export function designProjectedSourceId(id: string, node: DesignNode): string {
  // An instance root refers to its source frame; a projected child ends in its authored ID.
  return node.kind === 'frame' && node.instanceOf ? node.instanceOf : id.slice(id.lastIndexOf('/') + 1);
}

export function containsDesignLayer(document: DesignDocument, rootId: string, id: string, resources?: DesignLibraryResources): boolean {
  const seen = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const current = pending.pop()!;
    if (current === id) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = designResourceNode(document, current, resources);
    if (node?.kind !== 'frame') continue;
    if (node.instanceOf) pending.push(node.instanceOf);
    for (const child of node.childIds) pending.push(child);
  }
  return false;
}

export function detachDesignInstance(document: DesignDocument, id: string): DesignEdit[] {
  const root = document.nodes[id];
  if (root.kind !== 'frame' || !root.instanceOf) return [];
  const ids = new Map<string, string>();
  function collect(childId: string) {
    ids.set(childId, crypto.randomUUID());
    const child = document.nodes[childId];
    if (child.kind === 'frame') child.childIds.forEach(collect);
  }
  root.childIds.forEach(collect);
  const persisted = (node: DesignNode) => mapDesignNodeResourceIds(remapDesignLayerReferences(node, ids), (id) =>
    !designResourceParts(id) || linkedDesignPath(document, id) ? id : undefined);
  // The update keeps the authored child list. Insert edits add the children with real layer IDs.
  const edits: DesignEdit[] = [{ kind: 'update', nodeId: id, node: persisted({ ...independentLayer(root), childIds: [] }) }];
  function append(childId: string, parentId: string) {
    const nodeId = ids.get(childId)!;
    const child = { ...persisted(document.nodes[childId]), componentSlot: undefined };
    edits.push({ kind: 'insert', nodeId, parentId,
      node: child.kind === 'frame' ? { ...independentLayer(child), childIds: [] } : child });
    if (child.kind === 'frame') child.childIds.forEach((nestedId) => append(nestedId, nodeId));
  }
  root.childIds.forEach((childId) => append(childId, id));
  return edits;
}

export function independentLayer(frame: DesignFrame): DesignFrame {
  return { ...frame, component: undefined, instanceOf: undefined, contentOverrides: undefined, componentSet: undefined, variantName: undefined };
}
