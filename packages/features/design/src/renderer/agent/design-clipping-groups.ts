import { designFrameMask } from '../../contracts/design-references.js';
import { intersectBounds, type Bounds } from '../design-geometry.js';
import type { DesignReportView } from './design-layout-report.js';

export const layoutTolerance = 0.5;

export function boundsAreClipped(paint: Bounds, visible: Bounds | null) {
  return !visible || visible.width + layoutTolerance < paint.width || visible.height + layoutTolerance < paint.height;
}

// Attribute each layer to the nearest boundary that cuts its own paint bounds. Comparing
// against inherited visibleBounds here would misattribute an outer clip to every inner frame.
export function groupDesignClipping({ projected, scene }: DesignReportView, roots: ReadonlySet<string>, clipped: Iterable<string>) {
  const groups = new Map<string, { id: string; clipperId?: string; affectedCount: number; examples: string[] }>();
  const boundaries = new Map<string, Bounds | null | undefined>();
  function clipBoundary(id: string) {
    if (boundaries.has(id)) return boundaries.get(id);
    const node = projected.nodes[id];
    if (node.kind !== 'frame') return;
    let boundary: Bounds | null | undefined = node.clip === false ? undefined : scene[id].paintBounds;
    const mask = designFrameMask(projected, node);
    if (mask) {
      const bounds = scene[mask.id].paintBounds;
      boundary = boundary ? intersectBounds(boundary, bounds) : bounds;
    }
    boundaries.set(id, boundary);
    return boundary;
  }
  for (const id of clipped) {
    const paint = scene[id].paintBounds;
    let current = id;
    let clipperId: string | undefined;
    while (!roots.has(current) && scene[current].parentId) {
      current = scene[current].parentId!;
      const boundary = clipBoundary(current);
      if (boundary !== undefined && boundsAreClipped(paint, boundary && intersectBounds(paint, boundary))) {
        clipperId = current;
        break;
      }
    }
    // When inspection starts inside a clipped subtree, keep all reported locations in scope.
    // A scoped frame can itself be clipped by an external ancestor and also clip its own children.
    const key = clipperId === undefined ? 'inherited:' + current : 'local:' + clipperId;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { id, clipperId, affectedCount: 1, examples: [id] });
      continue;
    }
    group.affectedCount++;
    if (group.examples.length < 4) group.examples.push(id);
    // A clipped card and its contents should focus the card. Sibling overflows focus their container.
    let ancestor = id;
    while (ancestor !== group.id && ancestor !== current && scene[ancestor].parentId) ancestor = scene[ancestor].parentId!;
    if (ancestor !== group.id) group.id = current;
  }
  return [...groups.values()];
}
