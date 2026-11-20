import { splitDesignColor } from '../../contracts/design-color.js';
import type { DesignNode, DesignText } from '../../contracts/document.js';
import { containsBounds, type Bounds } from '../design-geometry.js';
import { designFills } from '../design-paint.js';
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

function interiorCovers(node: DesignNode, bounds: Bounds, text: Bounds) {
  if (node.kind !== 'frame' && node.kind !== 'rectangle') return false;
  const inset = Math.max(0, ...(node.strokes ?? []).filter((stroke) => !stroke.hidden && stroke.opacity !== 0)
    .map((stroke) => stroke.alignment === 'outside' ? 0 : stroke.width / (stroke.alignment === 'inside' ? 1 : 2)));
  if (!containsBounds({ x: bounds.x + inset, y: bounds.y + inset, width: bounds.width - 2 * inset, height: bounds.height - 2 * inset }, text)) return false;
  const radius = Math.max(...(node.cornerRadii ?? [node.cornerRadius ?? 0]));
  return (text.x >= bounds.x + radius && text.x + text.width <= bounds.x + bounds.width - radius)
    || (text.y >= bounds.y + radius && text.y + text.height <= bounds.y + bounds.height - radius);
}

export function opaqueInteriorColor(node: DesignNode, box: DesignLayerBox, bounds: Bounds) {
  if ((node.kind !== 'frame' && node.kind !== 'rectangle') || box.angle || !box.visibleBounds || (node.opacity ?? 1) < 1 || !containsBounds(box.visibleBounds, bounds)) return;
  const paint = simplePaint(node);
  if (paint?.alpha === 1 && interiorCovers(node, box.paintBounds, bounds)) return paint.color;
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
        if (!box.angle && paint?.alpha === 1 && interiorCovers(parent, box.paintBounds, bounds)) return paint.color;
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
