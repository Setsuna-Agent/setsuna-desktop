import { designDocumentCodec, designDocumentVersion, type DesignDocument, type DesignDocumentRef, type DesignEdit, type DesignNode } from '../../contracts/index.js';
import { remapDesignLayerReferences } from '../../contracts/design-references.js';
import { designResourceId, designResourceParts } from '../../contracts/design-resource-id.js';
import { independentLayer } from '../components/design-components.js';
import { linkedDesignPath, mapDesignStyleIds } from '../components/design-library-resources.js';
import { layerTransform, orientationInParent, roundDesignValue, toLocal, toWorld, transformedBounds, unionBounds,
  type Bounds, type Point } from '../design-geometry.js';
import { centerDesignLayer } from '../design-insertion.js';
import type { DesignLayerBox, DesignScene } from '../design-layout.js';
import { measureDesignText } from '../design-text.js';

type LayerClipboard = Readonly<{
  projectId: string;
  rootId?: string;
  path?: string;
  document: DesignDocument;
}>;

export function designClipboardSharesRoot(clipboard: LayerClipboard, ref: DesignDocumentRef): boolean {
  return clipboard.projectId === ref.projectId && clipboard.rootId === ref.rootId;
}

export function copyDesignBranches(
  ref: DesignDocumentRef, document: DesignDocument, scene: DesignScene, ids: readonly string[], origin: Point,
): string {
  const nodes: Record<string, DesignNode> = {};
  const idsBySource = new Map<string, string>();
  function copy(id: string, topLevel: boolean): string {
    const nextId = crypto.randomUUID();
    idsBySource.set(id, nextId);
    const box = scene[id];
    const original = document.nodes[id];
    let node = original.kind === 'frame' ? { ...independentLayer(original), childIds: original.childIds.map((child) => copy(child, false)) } : original;
    if (topLevel) {
      const center = toWorld(box, { x: box.width / 2, y: box.height / 2 });
      node = {
        ...node, ...orientationInParent(box),
        x: center.x - origin.x - box.width / 2, y: center.y - origin.y - box.height / 2,
        width: Math.max(0.01, box.width), widthMode: 'fixed',
        ...(node.kind === 'text' ? {} : { height: Math.max(0.01, box.height), heightMode: 'fixed' }),
      };
    }
    nodes[nextId] = node;
    return nextId;
  }
  const rootIds = ids.map((id) => copy(id, true));
  for (const [id, node] of Object.entries(nodes)) nodes[id] = { ...remapDesignLayerReferences(node, idsBySource), componentSlot: undefined };
  return JSON.stringify({ ...ref, document: { schemaVersion: designDocumentVersion, documentId: document.documentId, rootIds, nodes } } satisfies LayerClipboard);
}

export function parseDesignClipboard(content: string): LayerClipboard {
  const value = JSON.parse(content) as Partial<LayerClipboard> | null;
  if (!value || typeof value.projectId !== 'string' || (value.rootId !== undefined && typeof value.rootId !== 'string')
    || (value.path !== undefined && typeof value.path !== 'string')) {
    throw new Error('Invalid design clipboard content.');
  }
  return { projectId: value.projectId, rootId: value.rootId, path: value.path, document: designDocumentCodec.parse(value.document) };
}

type PasteTarget = Readonly<{
  parentId: string | null;
  parent?: DesignLayerBox;
  beforeId: string | null;
  absolute?: boolean;
}> & (Readonly<{ origin: Point }> | Readonly<{ center: Point }>);

export function pasteDesignBranches(clipboard: LayerClipboard, destination: DesignDocument, ref: DesignDocumentRef, target: PasteTarget) {
  const { document } = clipboard;
  const sameRoot = designClipboardSharesRoot(clipboard, ref);
  const sameDocument = sameRoot && clipboard.path === ref.path && document.documentId === destination.documentId;
  const edits: DesignEdit[] = [];
  const idsBySource = new Map(Object.keys(document.nodes).map((id) => [id, crypto.randomUUID()]));
  const origin = 'origin' in target ? target.origin : target.center;
  const rootBounds: Bounds[] = [];
  // The clipboard carries resolved paint and typography. Keep links only when their owner is available at the destination.
  function destinationStyle(id: string): string | undefined {
    if (!sameRoot || !clipboard.path) return;
    const resource = designResourceParts(id);
    if (resource?.documentId === destination.documentId) return Object.hasOwn(destination.styles ?? {}, resource.id) ? resource.id : undefined;
    const qualified = resource ? id : designResourceId(document.documentId, id);
    return linkedDesignPath(destination, qualified) ? qualified : undefined;
  }

  function insert(id: string, parentId: string | null, topLevel: boolean): string {
    const nodeId = idsBySource.get(id)!;
    const source = document.nodes[id];
    const mapped = remapDesignLayerReferences(source, idsBySource);
    const original = sameDocument ? mapped : mapDesignStyleIds(mapped, destinationStyle);
    let node = original.kind === 'frame' ? { ...independentLayer(original), childIds: [] } : original;
    if (!sameDocument && source.interaction && 'targetId' in source.interaction && !idsBySource.has(source.interaction.targetId)) {
      node = { ...node, interaction: undefined };
    }
    if (topLevel) {
      // Clipboard roots are in world space. Restore the destination's local axes and handedness.
      const { width } = node;
      const height = node.kind === 'text' ? measureDesignText(node, width).height : node.height;
      const pose = layerTransform({ ...node, height }, node);
      const center = toLocal(target.parent, { x: origin.x + node.x + width / 2, y: origin.y + node.y + height / 2 });
      node = { ...node, ...orientationInParent(pose, target.parent), absolute: target.absolute,
        x: roundDesignValue(center.x - width / 2), y: roundDesignValue(center.y - height / 2) };
      if ('center' in target) rootBounds.push(transformedBounds({ ...layerTransform({ ...node, height }, node), width, height }));
    }
    edits.push({ kind: 'insert', nodeId, parentId, node });
    if (topLevel && target.beforeId) edits.push({ kind: 'reorder', nodeId, beforeId: target.beforeId });
    if (original.kind === 'frame') original.childIds.forEach((childId) => insert(childId, nodeId, false));
    return nodeId;
  }
  const ids = document.rootIds.map((id) => insert(id, target.parentId, true));
  const bounds = unionBounds(rootBounds);
  if ('center' in target && bounds) {
    // Move the pasted roots together to retain offsets and rotations.
    const position = centerDesignLayer(target.center, bounds, target.parent);
    const roots = new Set(ids);
    return { ids, edits: edits.map((edit) => edit.kind === 'insert' && roots.has(edit.nodeId) ? {
      ...edit, node: { ...edit.node, x: roundDesignValue(edit.node.x + position.x - bounds.x), y: roundDesignValue(edit.node.y + position.y - bounds.y) },
    } : edit) };
  }
  return { ids, edits };
}
