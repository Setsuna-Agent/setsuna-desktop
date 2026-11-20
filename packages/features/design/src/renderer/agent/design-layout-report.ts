import type { DesignNode, DesignText } from '../../contracts/document.js';
import { designLayoutChecks } from '../../contracts/design-task.js';
import { designFrameMask } from '../../contracts/design-references.js';
import { containsBounds, intersectBounds, layerOutline } from '../design-geometry.js';
import { orderDesignBranches } from '../design-canvas-edits.js';
import { designSizeMode, type DesignLayerBox } from '../design-layout.js';
import { createPlainDesignText } from '../design-text.js';
import { layoutRichDesignText } from '../text/design-rich-text.js';
import type { DesignCommandContext } from './design-command.js';
import { designAuditSiblings } from './design-audit-siblings.js';
import { checkDesignTextContrast, opaqueInteriorColor } from './design-text-contrast.js';
import { boundsAreClipped, layoutTolerance as tolerance } from './design-clipping-groups.js';

const pageSize = 32;
export type DesignReportView = Pick<DesignCommandContext, 'projected' | 'scene'>;

export function designLayerPath({ scene, projected }: DesignReportView, roots: ReadonlySet<string>, id: string) {
  const path = [];
  for (let current: string | null = id; current && path.length < 8; current = scene[current].parentId) {
    const layer = projected.nodes[current];
    path.unshift((layer.name || layer.kind + ' (' + current + ')').slice(0, 120));
    if (roots.has(current)) break;
  }
  return path;
}

function textOverflow(node: DesignText, box: DesignLayerBox) {
  if (node.runs?.length) {
    const { pieces, height } = layoutRichDesignText(node, box.width);
    if (height > box.height + tolerance || pieces.some((piece) => piece.x < -tolerance || piece.x + piece.width > box.width + tolerance)) return 'glyphOverflow';
  } else {
    const shape = createPlainDesignText(node, box.width);
    try {
      // Konva may drop a glyph if even one character cannot fit the wrapping width.
      const lines = shape.textArr.map((line) => line.text).join('').replace(/\s/gu, '');
      if (lines !== node.text.replace(/\s/gu, '') || shape.getTextWidth() > box.width + tolerance
        || shape.height() > box.height + tolerance) return 'glyphOverflow';
    } finally { shape.destroy(); }
  }
}

export function designLayoutReport(view: DesignReportView, roots: readonly string[], revision: string, offset: number,
  includeExpectedOverlaps: boolean, requestedChecks: unknown, limit = pageSize) {
  if (requestedChecks !== undefined && (!Array.isArray(requestedChecks) || !requestedChecks.length || requestedChecks.some((check) => !designLayoutChecks.includes(check)))) {
    throw new Error('checks must contain one or more of: ' + designLayoutChecks.join(', '));
  }
  const checks = new Set<string>(Array.isArray(requestedChecks) ? requestedChecks : designLayoutChecks.filter((check) => check !== 'possibleOverlap'));
  const { projected, scene } = view;
  const rootIds = new Set(roots);
  const ids: string[] = [];
  const possibleOverlap = checks.has('possibleOverlap');
  const behind = designAuditSiblings(view);
  const inScope = new Set<string>();
  function collect(id: string) {
    const node = projected.nodes[id];
    if (!scene[id].visible || node.opacity === 0) return;
    inScope.add(id);
    ids.push(id);
    if (node.kind === 'frame') {
      const mask = designFrameMask(projected, node)?.id;
      for (const child of node.childIds) if (child !== mask) collect(child);
    }
  }
  for (const id of roots.length > 1 ? orderDesignBranches(projected, roots) : roots) {
    let visible = true;
    for (let current: string | null = id; current; current = scene[current].parentId) {
      const parentId: string | null = scene[current].parentId;
      const parent: DesignNode | undefined = parentId ? projected.nodes[parentId] : undefined;
      if (projected.nodes[current].opacity === 0 || (parent && parent.kind === 'frame' && parent.maskId === current)) { visible = false; break; }
    }
    if (visible) collect(id);
  }
  const page = ids.slice(offset, offset + limit);
  const findings = [];
  const unverifiedContrast = [];
  for (const id of page) {
    const node = projected.nodes[id];
    const box = scene[id];
    if (checks.has('outOfBounds') && box.parentId) {
      const parent = scene[box.parentId];
      const bounds = layerOutline(box, node);
      const outside = bounds.x < -tolerance || bounds.y < -tolerance || bounds.x + bounds.width > parent.width + tolerance
        || bounds.y + bounds.height > parent.height + tolerance;
      const clipped = boundsAreClipped(box.paintBounds, box.visibleBounds);
      if (outside || clipped) {
        const frame = projected.nodes[box.parentId];
        const visibility: 'clipped' | 'unverifiedClipping' | 'outsideParent' = clipped ? 'clipped' : frame.kind === 'frame' && frame.clip !== false ? 'unverifiedClipping' : 'outsideParent';
        findings.push({ kind: 'outOfBounds' as const, visibility, id, name: node.name?.slice(0, 120) || node.kind, path: designLayerPath(view, rootIds, id),
          parentId: box.parentId, bounds, parentSize: { width: parent.width, height: parent.height } });
      }
    }
    if (checks.has('fillInHug') && box.parentId && !node.absolute) {
      const parent = projected.nodes[box.parentId];
      if (parent.kind === 'frame' && parent.layout) {
        const axes = (['width', 'height'] as const).filter((axis) => {
          const mode = axis === 'width' ? node.widthMode : 'heightMode' in node ? node.heightMode : undefined;
          const parentMode = axis === 'width' ? parent.widthMode : parent.heightMode;
          return mode === 'fill' && parentMode === 'hug' && designSizeMode(node, parent, axis) === 'fixed';
        });
        if (axes.length) findings.push({ kind: 'fillInHug' as const, id, parentId: box.parentId, axes, width: box.width, height: box.height });
      }
    }
    const canHideText = (node.kind === 'frame' || node.kind === 'rectangle') && checks.has('occludedText');
    if ((possibleOverlap || canHideText || includeExpectedOverlaps) && box.visibleBounds) {
      const peers: string[] = [];
      const backdrops: string[] = [];
      const hiddenTextIds: string[] = [];
      let count = 0;
      let expectedCount = 0;
      let hiddenCount = 0;
      for (const { id: other } of behind(id, box.visibleBounds)) {
        if (!inScope.has(other)) continue;
        const lower = projected.nodes[other];
        const bounds = scene[other].visibleBounds;
        const overlap = bounds && intersectBounds(bounds, box.visibleBounds);
        if (overlap && overlap.width > tolerance && overlap.height > tolerance) {
          if (lower.kind === 'text' && opaqueInteriorColor(node, box, bounds)) {
            if (canHideText && ++hiddenCount <= 4) hiddenTextIds.push(other);
            continue;
          }
          // A label or glyph fully contained by a lower card or badge is a common composition.
          if ((node.kind === 'text' || node.kind === 'vector') && !scene[other].angle
            && (lower.kind === 'rectangle' || lower.kind === 'ellipse' || (lower.kind === 'frame' && !lower.childIds.length))
            && containsBounds(bounds, box.visibleBounds)) {
            if (++expectedCount <= 4) backdrops.push(other);
            continue;
          }
          if (possibleOverlap && ++count <= 4) peers.push(other);
        }
      }
      if (count) findings.push({ kind: 'possibleOverlap' as const, id, peers, count });
      if (hiddenCount) findings.push({ kind: 'occludedText' as const, id, hiddenTextIds, count: hiddenCount });
      if (includeExpectedOverlaps && expectedCount) findings.push({ kind: 'expectedOverlap' as const, id, peers: backdrops, count: expectedCount });
    }
    if (node.kind === 'text' && node.text.trim()) {
      if (checks.has('textOverflow')) {
        if (boundsAreClipped(box.paintBounds, box.visibleBounds)) findings.push({ kind: 'textOverflow' as const, id, reason: 'clipped' as const });
        const reason = textOverflow(node, box);
        if (reason) findings.push({ kind: 'textOverflow' as const, id, reason });
      }
      if (!checks.has('lowContrast') || !box.visibleBounds) continue;
      const contrast = checkDesignTextContrast(view, id, node, box.visibleBounds, behind);
      if (contrast === undefined) unverifiedContrast.push(id);
      else if (contrast) findings.push({ kind: 'lowContrast' as const, id, ...contrast });
    }
  }
  const next = offset + page.length;
  return { revision, total: ids.length, checked: page.length, findings, unverifiedContrast, ...(next < ids.length ? { nextOffset: next } : {}) };
}
