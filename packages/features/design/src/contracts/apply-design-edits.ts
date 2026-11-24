import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { indexDesignParents, isDesignPrototypeBoard, validateDesignComponents, type DesignDocument, type DesignEdit, type DesignNode, type DesignStyle } from './document.js';
import { designStylesForModes, resolveDesignNodeStyles } from './design-styles.js';
import { rebaseDesignTextRuns } from './design-text-runs.js';
import { defaultVariableCollectionId, designVariableCollectionKey, validateDesignVariableCollections, withoutDesignModes } from './design-variable-collections.js';
import { bindDesignVariable, clearChanged, clearDesignChangedBindings, resolveDesignVariableTarget, withDesignVariableValue } from './design-variables.js';

export function applyDesignEdits(document: DesignDocument, edits: readonly DesignEdit[]): DesignDocument {
  const nodes: Record<string, DesignNode> = Object.assign(Object.create(null), document.nodes);
  const parents = new Map(indexDesignParents(document));
  let rootIds = document.rootIds;
  let styles = document.styles;
  let variableCollections = document.variableCollections;
  let libraries = document.libraries;
  let prototypeStartId = document.prototypeStartId;

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
    if (edit.kind === 'setPrototypeStart') {
      const { boardId } = edit;
      if (boardId !== null && (parents.get(boardId) !== null || !isDesignPrototypeBoard(nodes[boardId]))) {
        throw invalidEdit('Choose a top-level artboard as the prototype start.');
      }
      prototypeStartId = boardId ?? undefined;
      continue;
    }
    if (edit.kind === 'linkLibrary') {
      if (edit.documentId === document.documentId) throw invalidEdit('A draft cannot link to itself.');
      libraries = { ...libraries, [edit.documentId]: edit.path };
      continue;
    }
    if (edit.kind === 'unlinkLibrary') {
      if (libraries && Object.hasOwn(libraries, edit.documentId)) {
        const remaining = { ...libraries };
        delete remaining[edit.documentId];
        libraries = Object.keys(remaining).length ? remaining : undefined;
      }
      continue;
    }
    if (edit.kind === 'setStyle') {
      const { styleId, style } = edit;
      const before = styles && Object.hasOwn(styles, styleId) ? styles[styleId] : undefined;
      const updated = Object.assign(Object.create(null) as Record<string, DesignStyle>, styles);
      if (before && before.kind !== style?.kind && styles) {
        const defaults = designStylesForModes(styles, document.documentId);
        // Resolve the last value in each board before unlinking the deleted resource.
        function detach(id: string, scopedStyles: DesignDocument['styles']) {
          const node = resolveDesignNodeStyles(nodes[id], scopedStyles, styleId);
          nodes[id] = node;
          if (node.kind === 'frame') node.childIds.forEach((child) => detach(child, scopedStyles));
        }
        for (const id of rootIds) {
          const root = nodes[id];
          const scoped = root.kind === 'frame' && root.variableModeIds
            ? designStylesForModes(styles, document.documentId, root.variableModeIds) : defaults;
          detach(id, scoped);
        }
        for (const [id, entry] of Object.entries(styles)) {
          if (entry.kind !== 'text') continue;
          const typography = resolveDesignVariableTarget(entry.typography, defaults, styleId);
          if (typography !== entry.typography) updated[id] = { ...entry, typography };
        }
      }
      if (style) updated[styleId] = before?.kind === 'text' && style.kind === 'text'
        ? { ...style, typography: clearChanged(before.typography, style.typography) } : style;
      else delete updated[styleId];
      styles = updated;
      continue;
    }
    if (edit.kind === 'setVariableCollection') {
      const { collectionId, collection } = edit;
      const before = variableCollections && Object.hasOwn(variableCollections, collectionId) ? variableCollections[collectionId] : undefined;
      const owns = (style: DesignStyle) => style.kind !== 'text' && (style.collectionId ?? defaultVariableCollectionId) === collectionId;
      if (!collection && Object.values(styles ?? {}).some(owns)) throw invalidEdit('Remove the variables in this collection first.');
      if (collection) variableCollections = { ...variableCollections, [collectionId]: collection };
      else if (before) {
        const updated = { ...variableCollections };
        delete updated[collectionId];
        variableCollections = updated;
      }
      const removed = new Set(Object.keys(before?.modes ?? {}).filter((id) => !Object.hasOwn(collection?.modes ?? {}, id)));
      if (removed.size) {
        styles = styles && Object.fromEntries(Object.entries(styles).map(([id, style]) => {
          if (style.kind === 'text' || !owns(style) || !style.modeValues) return [id, style];
          let variable = style;
          for (const mode of removed) if (Object.hasOwn(variable.modeValues ?? {}, mode)) {
            variable = withDesignVariableValue(variable, mode, undefined);
          }
          return [id, variable];
        }));
        const key = designVariableCollectionKey(document.documentId, collectionId);
        for (const [id, node] of Object.entries(nodes)) {
          if (node.kind === 'frame') nodes[id] = withoutDesignModes(node, key, removed);
        }
      }
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
        nodes[nodeId] = bindDesignVariable(bindDesignVariable(node, 'x', undefined, edit.x), 'y', undefined, edit.y);
        break;
      case 'updateText':
        if (node.kind !== 'text') throw invalidEdit('Choose a text layer to edit.');
        nodes[nodeId] = bindDesignVariable({ ...node, text: edit.text, runs: rebaseDesignTextRuns(node.text, edit.text, node.runs) }, 'text', undefined);
        break;
      case 'update': {
        if (edit.node.kind !== node.kind) throw invalidEdit('A layer cannot change type.');
        const next = node.kind === 'frame' && edit.node.kind === 'frame'
          ? { ...edit.node, childIds: node.childIds }
          : edit.node;
        nodes[nodeId] = clearDesignChangedBindings(node, next);
        break;
      }
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
  if (prototypeStartId && (parents.get(prototypeStartId) !== null || !isDesignPrototypeBoard(nodes[prototypeStartId]))) prototypeStartId = undefined;
  const next = { ...document, rootIds, nodes, styles, libraries, variableCollections, prototypeStartId };
  try {
    indexDesignParents(next);
    validateDesignComponents(next);
    if (styles !== document.styles || variableCollections !== document.variableCollections) validateDesignVariableCollections(styles, variableCollections);
  } catch (error) {
    throw invalidEdit(error instanceof Error ? error.message : 'Invalid design layer hierarchy.');
  }
  return next;
}

function invalidEdit(message: string): FeatureOperationFailure {
  return new FeatureOperationFailure({ code: 'INVALID_INPUT', message, retryable: false });
}
