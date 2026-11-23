import { requestedDesignRootEdit } from '../contracts/design-task.js';
import { indexDesignParents, type DesignDocument, type DesignEdit } from '../contracts/document.js';

/** Group, duplicate and ungroup can create siblings of a selected branch. They may change
 * sibling order there, but cannot turn an existing unselected sibling into an editable layer. */
export function checkDesignTaskEdits(document: DesignDocument, edits: readonly DesignEdit[], roots: ReadonlySet<string>, args: Record<string, unknown>) {
  const parents = indexDesignParents(document);
  const rootEdit = args.action === 'createVariant' ? 'insert' : requestedDesignRootEdit(args);
  const allowed = new Set<string>();
  const parentsOfRoots = new Set<string | null>();
  const pending = [...roots].filter((id) => parents.has(id));
  for (const id of pending) parentsOfRoots.add(parents.get(id)!);
  while (pending.length) {
    const id = pending.pop()!;
    if (allowed.has(id)) continue;
    allowed.add(id);
    const node = document.nodes[id];
    if (node.kind === 'frame') for (const child of node.childIds) pending.push(child);
  }
  const extended = new Set<string>();
  for (const edit of edits) {
    if (!('nodeId' in edit) || (edit.kind !== 'insert' && !allowed.has(edit.nodeId))) throw new Error('Edit is outside the bound selection.');
    if (edit.kind === 'insert' || edit.kind === 'reparent') {
      const parent = edit.parentId;
      const permitted = parent === null ? edit.kind === rootEdit : allowed.has(parent);
      if (!permitted && !parentsOfRoots.has(parent)) throw new Error('Destination is outside the bound selection.');
      if (edit.kind === 'insert' && parents.has(edit.nodeId)) throw new Error('Layer already exists.');
      allowed.add(edit.nodeId);
      if (parent === null || !allowed.has(parent)) extended.add(edit.nodeId);
    }
  }
  return extended;
}

export function checkDesignWebEdits(document: DesignDocument, edits: readonly DesignEdit[]) {
  if (edits.some((edit) => {
    if (edit.kind !== 'insert' && edit.kind !== 'update') return false;
    if (edit.node.kind !== 'web' || !edit.node.url) return false;
    const previous = document.nodes[edit.nodeId];
    return edit.kind === 'insert' || previous?.kind !== 'web' || previous.url !== edit.node.url;
  })) throw new Error('Network access is required to add or change a web layer URL.');
}
