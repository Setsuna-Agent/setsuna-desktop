import { applyDesignEdits } from '../../contracts/apply-design-edits.js';
import type { DesignEdit } from '../../contracts/document.js';
import { projectDesignComponents } from '../components/design-components.js';
import { selectedBranches } from '../design-canvas-edits.js';
import type { Bounds } from '../design-geometry.js';
import { resolveDesignScene } from '../design-layout.js';
import { measureDesignText } from '../design-text.js';
import { auditDesignBoard, designAuditPage } from './design-board-audit.js';
import { boundsAreClipped } from './design-clipping-groups.js';
import type { DesignCommandContext } from './design-command.js';
import { designLayerEntry } from './design-layer-inspection.js';

type TrialLayer = ReturnType<typeof designLayerEntry> & { width: number; height: number; temporary?: boolean; visibleBounds?: Bounds | null };

function sameBounds(a: Bounds | null, b: Bounds | null) {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}

// Instance children are projected from a local or shared master and do not appear in the edit list.
export function checkInstanceWebLayers(view: DesignCommandContext, edits: readonly DesignEdit[]) {
  const changesSource = edits.some((edit) => {
    if (edit.kind !== 'insert' && edit.kind !== 'update') return false;
    if (edit.node.kind !== 'frame' || !edit.node.instanceOf) return false;
    const before = view.document.nodes[edit.nodeId];
    return before?.kind !== 'frame' || before.instanceOf !== edit.node.instanceOf;
  });
  if (!changesSource) return;
  const projected = projectDesignComponents(applyDesignEdits(view.document, edits), view.resources);
  for (const [id, node] of Object.entries(projected.nodes)) {
    if (node.kind !== 'web' || !node.url) continue;
    const before = view.projected.nodes[id];
    if (before?.kind !== 'web' || before.url !== node.url) throw new Error('Network access is required to add a web preview through a component.');
  }
}

export function inspectPlannedLayout(view: DesignCommandContext, roots: ReadonlySet<string> | undefined, revision: string,
  plan: { edits: readonly DesignEdit[]; ids: readonly string[] }) {
  const document = applyDesignEdits(view.document, plan.edits);
  const projected = projectDesignComponents(document, view.resources);
  const scene = resolveDesignScene(view.layoutEngine, projected, measureDesignText);
  const candidate = { ...view, document, projected, scene };
  const targets = new Set(plan.ids.filter((id) => Object.hasOwn(scene, id)));
  // Ungrouping or duplicating a selected root can produce new siblings inside the trial's scope.
  const scope = roots ? selectedBranches([...new Set([...roots, ...targets])].filter((id) => Object.hasOwn(scene, id)), scene) : projected.rootIds;
  const audit = auditDesignBoard(candidate, scope, revision, ['outOfBounds', 'textOverflow', 'fillInHug']);
  const { checked, issues, summary, issueCount } = designAuditPage(audit, 0, 85_000);
  const layers: TrialLayer[] = [];
  let layerCount = 0;
  let length = 0;
  function add(id: string) {
    const box = scene[id];
    const before = view.scene[id];
    if (!targets.has(id) && before && box.width === before.width && box.height === before.height
      && sameBounds(box.paintBounds, before.paintBounds) && sameBounds(box.visibleBounds, before.visibleBounds)) return;
    layerCount++;
    if (layers.length >= 256 || length >= 65_000) return;
    const layer = { ...designLayerEntry(candidate, id), width: box.width, height: box.height, temporary: !before || undefined,
      visibleBounds: boundsAreClipped(box.paintBounds, box.visibleBounds) ? box.visibleBounds : undefined };
    length += JSON.stringify(layer).length + 1;
    if (length <= 65_000) layers.push(layer);
  }
  // Return command targets first, followed by inserted children and other layers moved by reflow.
  for (const id of targets) add(id);
  const stack = [...scope].reverse();
  while (stack.length) {
    const id = stack.pop()!;
    if (!targets.has(id)) add(id);
    const node = projected.nodes[id];
    if (node.kind === 'frame') for (let i = node.childIds.length - 1; i >= 0; i--) stack.push(node.childIds[i]);
  }
  return { checked, issueCount, issues, summary, layerCount, layers };
}
