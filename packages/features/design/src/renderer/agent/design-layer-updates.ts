import { applyDesignEdits } from '../../contracts/apply-design-edits.js';
import type { DesignEdit, DesignNode } from '../../contracts/document.js';
import { projectDesignComponents } from '../components/design-components.js';
import { planDesignLayerUpdate } from '../design-canvas-edits.js';
import { resolveDesignScene } from '../design-layout.js';
import { measureDesignText } from '../design-text.js';
import type { DesignCommandContext } from './design-command.js';

export function planDesignLayerUpdates(view: DesignCommandContext, ids: readonly string[],
  update: (node: DesignNode, id: string) => DesignNode) {
  const levels: string[][] = [];
  let deepestGroup = -1;
  for (const id of ids) {
    let depth = 0;
    for (let parent = view.scene[id].parentId; parent; parent = view.scene[parent].parentId) depth++;
    (levels[depth] ??= []).push(id);
    const node = view.document.nodes[id];
    if (node.kind === 'frame' && node.group) deepestGroup = Math.max(deepestGroup, depth);
  }
  const edits: DesignEdit[] = [];
  const selected = new Set(ids);
  let applied = 0;
  for (const [depth, level] of levels.entries()) {
    if (!level) continue;
    let cascaded = false;
    for (const id of level) {
      const node = view.document.nodes[id];
      const next = update(node, id);
      if (next === node) continue;
      const planned = planDesignLayerUpdate(view.document, id, next, view);
      for (const edit of planned) {
        edits.push(edit);
        if (edit.nodeId !== id && selected.has(edit.nodeId)) cascaded = true;
      }
    }
    // Group resizing uses solved bounds and writes descendant geometry. Later groups
    // must see any prior reflow; explicit children must see the geometry they inherited.
    if (edits.length > applied && (cascaded || depth < deepestGroup)) {
      const document = applyDesignEdits(view.document, edits.slice(applied));
      const projected = projectDesignComponents(document, view.resources);
      view = { ...view, document, projected, scene: resolveDesignScene(view.layoutEngine, projected, measureDesignText) };
      applied = edits.length;
    }
  }
  return { edits, ids };
}
