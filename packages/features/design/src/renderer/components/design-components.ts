import { rebaseDesignTextRuns, resolveDesignNodeStyles, resolveDesignStyles, type DesignContentOverride, type DesignDocument, type DesignEdit, type DesignFrame, type DesignNode } from '../../contracts/index.js';
import { maxDesignTreeDepth, maxExpandedDesignLayers } from '../../contracts/document.js';
import { remapDesignLayerReferences } from '../../contracts/design-references.js';
import { designResourceParts } from '../../contracts/design-resource-id.js';
import { designResourceNode, linkedDesignPath, mapDesignStyleIds, type DesignLibraryResources } from './design-library-resources.js';

type OverrideScope = Readonly<{ root: string; overrides: NonNullable<DesignFrame['contentOverrides']> }>;

export function projectDesignComponents(authored: DesignDocument, resources?: DesignLibraryResources): DesignDocument {
  const styles = resources && Object.keys(resources.styles).length ? { ...authored.styles, ...resources.styles } : authored.styles;
  const document = resolveDesignStyles(styles === authored.styles ? authored : { ...authored, styles });
  const instances = Object.entries(document.nodes).filter(([, node]) => node.kind === 'frame' && node.instanceOf);
  if (!instances.length) return document;
  const nodes: Record<string, DesignNode> = { ...document.nodes };
  const activeSources = new Set<string>();
  const resolvedSources = new Map<string, DesignNode>();
  let remaining = Math.max(0, maxExpandedDesignLayers - Object.keys(nodes).length);

  function getNode(id: string): DesignNode | undefined {
    if (Object.hasOwn(document.nodes, id)) return document.nodes[id];
    const cached = resolvedSources.get(id);
    if (cached) return cached;
    const external = resources?.nodes[id];
    if (!external || !styles) return external;
    const resolved = resolveDesignNodeStyles(external, styles);
    resolvedSources.set(id, resolved);
    return resolved;
  }

  function project(id: string, sourceId: string, instanceRoot: string, scopes: readonly OverrideScope[] = [], depth = 0) {
    const node = getNode(sourceId);
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
      nodes[id] = node.kind === 'text' && override?.kind === 'text' ? { ...node, text: override.text,
        runs: rebaseDesignTextRuns(node.text, override.text, node.runs) }
        : node.kind === 'image' && override?.kind === 'image' ? { ...node, assetPath: override.assetPath } : node;
      return;
    }
    const source = node.instanceOf ? getNode(node.instanceOf) : node;
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
      project(projectedId, childId, childRoot, nextScopes, depth + 1);
      if (Object.hasOwn(nodes, projectedId)) childIds.push(projectedId);
    }
    if (node.instanceOf) activeSources.delete(node.instanceOf);
    const maskId = source.maskId && childIds.includes(`${childRoot}/${source.maskId}`) ? `${childRoot}/${source.maskId}` : undefined;
    nodes[id] = node.instanceOf ? {
      ...source,
      name: node.name ?? source.name,
      x: node.x, y: node.y,
      rotation: node.rotation, flipX: node.flipX, flipY: node.flipY,
      hidden: node.hidden, locked: node.locked, absolute: node.absolute,
      minWidth: node.minWidth ?? source.minWidth, maxWidth: node.maxWidth ?? source.maxWidth,
      interaction: node.interaction ?? source.interaction,
      opacity: node.opacity ?? source.opacity,
      width: node.widthMode ? node.width : source.width,
      height: node.heightMode ? node.height : source.height,
      widthMode: node.widthMode ?? (source.widthMode === 'hug' ? 'hug' : undefined),
      heightMode: node.heightMode ?? (source.heightMode === 'hug' ? 'hug' : undefined),
      instanceOf: node.instanceOf, component: undefined, childIds, maskId,
    } : { ...node, childIds, maskId };
  }

  for (const [id] of instances) project(id, id, id);
  return { ...document, nodes };
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
  const persisted = (node: DesignNode) => mapDesignStyleIds(remapDesignLayerReferences(node, ids), (id) =>
    !designResourceParts(id) || linkedDesignPath(document, id) ? id : undefined);
  const edits: DesignEdit[] = [{ kind: 'update', nodeId: id, node: persisted(independentLayer(root)) }];
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
