import { splitDesignColor } from '../../contracts/design-color.js';
import type { DesignNode, DesignText } from '../../contracts/document.js';
import { containsBounds, type Bounds } from '../design-geometry.js';
import { designFills, layerCornerRadius } from '../design-paint.js';
import type { DesignLayerBox } from '../design-layout.js';
import { designTextSegments } from '../text/design-rich-text.js';
import type { designAuditSiblings } from './design-audit-siblings.js';
import type { DesignReportView } from './design-layout-report.js';

function simplePaint(node: DesignNode) {
  const fills = designFills(node).filter((fill) => !fill.hidden && fill.opacity !== 0);
  if (!fills.length) return null;
  const fill = fills.at(-1)!;
  if (fill.gradient || fill.image || fill.shader || (fill.blendMode && fill.blendMode !== 'normal')) return;
  const { color, opacity } = splitDesignColor(fill.color);
  const alpha = opacity * (fill.opacity ?? 1);
  if (fills.length === 1 || alpha === 1) return { color, alpha };
}

function interiorCovers(node: DesignNode, box: DesignLayerBox, text: Bounds) {
  if (node.kind !== 'frame' && node.kind !== 'rectangle') return false;
  const bounds = box.paintBounds;
  const inset = Math.max(0, ...(node.strokes ?? []).filter((stroke) => !stroke.hidden && stroke.opacity !== 0)
    .map((stroke) => stroke.alignment === 'outside' ? 0 : stroke.width / (stroke.alignment === 'inside' ? 1 : 2)));
  const left = text.x - bounds.x;
  const top = text.y - bounds.y;
  const right = bounds.x + bounds.width - (text.x + text.width);
  const bottom = bounds.y + bounds.height - (text.y + text.height);
  if (Math.min(left, top, right, bottom) < inset) return false;
  const radius = layerCornerRadius(node, bounds.width, bounds.height);
  if (radius === 0) return true;
  const [topLeft, topRight, bottomRight, bottomLeft] = typeof radius === 'number' ? [radius, radius, radius, radius] : radius;
  const [localLeft, localRight] = box.scaleX < 0 ? [right, left] : [left, right];
  const [localTop, localBottom] = box.scaleY < 0 ? [bottom, top] : [top, bottom];
  // The text box fits if its nearest corner to each arc stays inside the stroke's inner edge.
  function insideArc(r: number, dx: number, dy: number) {
    return Math.hypot(Math.max(0, r - dx), Math.max(0, r - dy)) <= Math.max(0, r - inset);
  }
  return insideArc(topLeft, localLeft, localTop) && insideArc(topRight, localRight, localTop)
    && insideArc(bottomRight, localRight, localBottom) && insideArc(bottomLeft, localLeft, localBottom);
}

export function opaqueInteriorColor(node: DesignNode, box: DesignLayerBox, bounds: Bounds) {
  if ((node.kind !== 'frame' && node.kind !== 'rectangle') || box.angle || !box.visibleBounds || (node.opacity ?? 1) < 1 || !containsBounds(box.visibleBounds, bounds)) return;
  const paint = simplePaint(node);
  if (paint?.alpha === 1 && interiorCovers(node, box, bounds)) return paint.color;
}

function background(view: DesignReportView, id: string, bounds: Bounds, behind: ReturnType<typeof designAuditSiblings>) {
  const { scene, projected } = view;
  // A translucent ancestor composites the entire subtree against its backdrop.
  for (let parent = scene[id].parentId; parent; parent = scene[parent].parentId) {
    if ((projected.nodes[parent].opacity ?? 1) < 1) return;
  }
  for (let current: string | null = id; current; ) {
    const parentId: string | null = scene[current].parentId;
    const parent = parentId ? projected.nodes[parentId] : undefined;
    const siblings = behind(current, bounds);
    for (let i = siblings.length - 1; i >= 0; i--) {
      const sibling = siblings[i].id;
      const box = scene[sibling];
      const node = projected.nodes[sibling];
      // A partially covering or nonuniform sibling makes the actual backdrop ambiguous.
      if (node.kind !== 'rectangle' && node.kind !== 'frame') return;
      if (node.kind === 'frame' && node.childIds.length) return;
      const paint = simplePaint(node);
      if (paint === null && !node.shadow && !node.strokes?.length) continue;
      return opaqueInteriorColor(node, box, bounds);
    }
    if (parentId && parent) {
      const paint = simplePaint(parent);
      if (paint !== null) {
        const box = scene[parentId];
        if (!box.angle && paint?.alpha === 1 && interiorCovers(parent, box, bounds)) return paint.color;
        return;
      }
    }
    current = parentId;
  }
}

function channels(color: string) {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
}

function luminance(channels: number[]) {
  const [r, g, b] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// undefined means the backdrop or paint needs visual review; null means all measured runs pass.
export function checkDesignTextContrast(view: DesignReportView, id: string, node: DesignText, bounds: Bounds, behind: ReturnType<typeof designAuditSiblings>) {
  const backdrop = background(view, id, bounds, behind);
  const base = simplePaint(node);
  if (!backdrop) return;
  const bg = channels(backdrop);
  const light = luminance(bg);
  let worst: { ratio: number; minimum: number } | null = null;
  for (const { text, run } of designTextSegments(node.text, node.runs)) {
    if (!text.trim()) continue;
    const paint = run?.color ? { color: run.color, alpha: splitDesignColor(run.color).opacity } : base;
    if (!paint) return;
    const alpha = paint.alpha * (node.opacity ?? 1);
    const ink = luminance(channels(paint.color).map((value, i) => value * alpha + bg[i] * (1 - alpha)));
    const ratio = (Math.max(ink, light) + 0.05) / (Math.min(ink, light) + 0.05);
    const size = run?.fontSize ?? node.fontSize;
    const bold = (run?.fontWeight ?? node.fontWeight ?? 400) >= 700;
    const minimum = size >= 24 || (bold && size >= 56 / 3) ? 3 : 4.5;
    if (ratio < minimum && (!worst || ratio / minimum < worst.ratio / worst.minimum)) worst = { ratio, minimum };
  }
  return worst && { ...worst, ratio: Number(worst.ratio.toFixed(3)) };
}
