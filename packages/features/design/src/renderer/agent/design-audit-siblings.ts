import { intersectBounds, unionBounds, type Bounds } from '../design-geometry.js';
import type { DesignReportView } from './design-layout-report.js';

type Entry = { id: string; order: number; bounds: Bounds };
type Branch = { bounds: Bounds } & ({ entries: Entry[] } | { children: Branch[] });

function partition(entries: Entry[]): Branch {
  const bounds = unionBounds(entries.map((entry) => entry.bounds))!;
  if (entries.length <= 12) return { bounds, entries };
  const horizontal = bounds.width >= bounds.height;
  const center = ({ bounds: box }: Entry) => horizontal ? box.x + box.width / 2 : box.y + box.height / 2;
  entries.sort((a, b) => center(a) - center(b));
  const mid = Math.floor(entries.length / 2);
  return { bounds, children: [partition(entries.slice(0, mid)), partition(entries.slice(mid))] };
}

/** Include siblings outside the audited selection: their paint still contributes to its backdrop. */
export function designAuditSiblings({ projected, scene }: DesignReportView) {
  const groups = new Map<string | null, { order: Map<string, number>; tree?: Branch }>();
  return (id: string, bounds: Bounds) => {
    const parentId = scene[id].parentId;
    let group = groups.get(parentId);
    if (!group) {
      const frame = parentId && projected.nodes[parentId];
      const ids = frame && frame.kind === 'frame' ? frame.childIds : projected.rootIds;
      const order = new Map<string, number>();
      const entries: Entry[] = [];
      ids.forEach((sibling, index) => {
        order.set(sibling, index);
        const box = scene[sibling];
        if (box.visible && box.visibleBounds && projected.nodes[sibling].opacity !== 0
          && !(frame && frame.kind === 'frame' && frame.maskId === sibling)) {
          entries.push({ id: sibling, order: index, bounds: box.visibleBounds });
        }
      });
      group = { order, tree: entries.length ? partition(entries) : undefined };
      groups.set(parentId, group);
    }
    const before = group.order.get(id)!;
    const hits: Entry[] = [];
    function visit(branch: Branch) {
      if (!intersectBounds(bounds, branch.bounds)) return;
      if ('children' in branch) branch.children.forEach(visit);
      else for (const entry of branch.entries) {
        if (entry.order < before && intersectBounds(bounds, entry.bounds)) hits.push(entry);
      }
    }
    if (group.tree) visit(group.tree);
    return hits.sort((a, b) => a.order - b.order);
  };
}
