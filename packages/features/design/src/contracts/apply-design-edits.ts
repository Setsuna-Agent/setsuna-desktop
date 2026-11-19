import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { indexDesignParents, validateDesignComponents, type DesignDocument, type DesignEdit, type DesignNode, type DesignStyle } from './document.js';
import { resolveDesignNodeStyles } from './design-styles.js';
import { rebaseDesignTextRuns } from './design-text-runs.js';

export function applyDesignEdits(document: DesignDocument, edits: readonly DesignEdit[]): DesignDocument {
  const nodes: Record<string, DesignNode> = Object.assign(Object.create(null), document.nodes);
  const parents = new Map(indexDesignParents(document));
  let rootIds = document.rootIds;
  let styles = document.styles;
  let libraries = document.libraries;

  function siblings(parentId: string | null): readonly string[] {
    if (parentId === null) return rootIds;
    const parent = nodes[parentId];
    if (parent?.kind !== 'frame' || parent.instanceOf) throw invalidEdit('Choose an editable parent frame.');
    return parent.childIds;
  }

  function setOrder(parentId: string | null, order: readonly string[]) {
    if (parentId === null) {
      rootIds = order;
      return;
    }
    const parent = nodes[parentId];
    if (parent?.kind !== 'frame') throw invalidEdit('Choose a parent frame.');
    nodes[parentId] = { ...parent, childIds: order };
  }

  function removeSubtree(id: string) {
    const pending = [id];
    while (pending.length) {
      const childId = pending.pop() as string;
      const child = nodes[childId];
      if (child.kind === 'frame') child.childIds.forEach((descendantId) => pending.push(descendantId));
      delete nodes[childId];
      parents.delete(childId);
    }
  }

  for (const edit of edits) {
    if (edit.kind === 'linkLibrary') {
      if (edit.documentId === document.documentId) throw invalidEdit('A draft cannot link to itself.');
      libraries = { ...libraries, [edit.documentId]: edit.path };
      continue;
    }
    if (edit.kind === 'setStyle') {
      const { styleId, style } = edit;
      const before = styles && Object.hasOwn(styles, styleId) ? styles[styleId] : undefined;
      if (before && before.kind !== style?.kind && styles) {
        for (const id of Object.keys(nodes)) nodes[id] = resolveDesignNodeStyles(nodes[id], styles, styleId);
      }
      const updated = Object.assign(Object.create(null) as Record<string, DesignStyle>, styles);
      if (style) updated[styleId] = style;
      else delete updated[styleId];
      styles = updated;
      continue;
    }
    const { nodeId } = edit;
    const node = nodes[nodeId];
    if (edit.kind === 'insert') {
      if (node) throw invalidEdit('That layer ID is already in use.');
      if (edit.node.kind === 'frame' && edit.node.childIds.length) throw invalidEdit('Insert an empty frame.');
      setOrder(edit.parentId, [...siblings(edit.parentId), nodeId]);
      nodes[nodeId] = edit.node;
      parents.set(nodeId, edit.parentId);
      continue;
    }
    if (!node) throw invalidEdit('That layer is no longer in the document.');
    const parentId = parents.get(nodeId) ?? null;
    switch (edit.kind) {
      case 'move':
        nodes[nodeId] = { ...node, x: edit.x, y: edit.y };
        break;
      case 'updateText':
        if (node.kind !== 'text') throw invalidEdit('Choose a text layer to edit.');
        nodes[nodeId] = { ...node, text: edit.text, runs: rebaseDesignTextRuns(node.text, edit.text, node.runs) };
        break;
      case 'update':
        if (edit.node.kind !== node.kind) throw invalidEdit('A layer cannot change type.');
        nodes[nodeId] = node.kind === 'frame' && edit.node.kind === 'frame'
          ? { ...edit.node, childIds: node.childIds }
          : edit.node;
        break;
      case 'reorder':
      case 'reparent': {
        const destination = edit.kind === 'reparent' ? edit.parentId : parentId;
        if (destination === parentId && edit.beforeId === nodeId) break;
        for (let id = destination; id !== null; id = parents.get(id) ?? null) {
          if (id === nodeId) throw invalidEdit('A layer cannot be moved inside itself or a descendant.');
        }
        const order = siblings(destination).filter((id) => id !== nodeId);
        const index = edit.beforeId === null ? order.length : order.indexOf(edit.beforeId);
        if (index === -1) throw invalidEdit('Choose a layer in the destination frame.');
        order.splice(index, 0, nodeId);
        if (destination !== parentId) setOrder(parentId, siblings(parentId).filter((id) => id !== nodeId));
        setOrder(destination, order);
        parents.set(nodeId, destination);
        break;
      }
      case 'remove':
        setOrder(parentId, siblings(parentId).filter((id) => id !== nodeId));
        removeSubtree(nodeId);
        break;
    }
  }
  for (const [id, node] of Object.entries(nodes)) {
    if (node.kind !== 'frame') continue;
    const maskId = node.maskId && node.childIds.includes(node.maskId) ? node.maskId : undefined;
    const base = node.componentSet ? nodes[node.componentSet] : undefined;
    const componentSet = node.component && base?.kind === 'frame' && base.component && !base.componentSet ? node.componentSet : undefined;
    if (maskId !== node.maskId || componentSet !== node.componentSet) nodes[id] = { ...node, maskId, componentSet };
  }
  const next = { ...document, rootIds, nodes, styles, libraries };
  try {
    indexDesignParents(next);
    validateDesignComponents(next);
  } catch (error) {
    throw invalidEdit(error instanceof Error ? error.message : 'Invalid design layer hierarchy.');
  }
  return next;
}

function invalidEdit(message: string): FeatureOperationFailure {
  return new FeatureOperationFailure({ code: 'INVALID_INPUT', message, retryable: false });
}
