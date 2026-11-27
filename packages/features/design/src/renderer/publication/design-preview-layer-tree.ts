import type { DesignDocument, DesignNode, DesignPaint } from '../../contracts/document.js';
import { designFrameMask } from '../../contracts/design-references.js';
import { maxDesignPreviewLayerNameLength, maxDesignPreviewOutlinePoints, type DesignPreviewLayer,
  type DesignPreviewLayerKind } from '../../contracts/design-preview-layers.js';
import { roundDesignValue, toLocal, toWorld } from '../design-geometry.js';
import type { DesignLayerBox, DesignScene } from '../design-layout.js';
import { colorWithOpacity, designFills, visibleDesignStrokes } from '../design-paint.js';

type Point = DesignPreviewLayer['outline'][number];
const unitBox: readonly Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
const ellipse = Array.from({ length: 24 }, (_, index): Point => {
  const angle = index * Math.PI * 2 / 24;
  return [(1 + Math.cos(angle)) / 2, (1 + Math.sin(angle)) / 2];
});

export function designPreviewLayerTree(document: DesignDocument, scene: DesignScene, boardId: string, boardName: string,
  keys?: Map<string, number>): DesignPreviewLayer {
  const board = scene[boardId];
  const hasArtwork = board.visible && board.width > 0 && board.height > 0;

  // The PNG strips the artboard's world transform. Use the same artboard-local space for picking and highlights.
  function shape(node: DesignNode, box: DesignLayerBox): readonly Point[] {
    if (box.width <= 0 || box.height <= 0) return [];
    return (node.kind === 'ellipse' ? ellipse : unitBox).map(([x, y]) => {
      const local = toLocal(board, toWorld(box, { x: x * box.width, y: y * box.height }));
      return [local.x / board.width, local.y / board.height];
    });
  }

  function visit(id: string, clip: readonly Point[], root = false): DesignPreviewLayer | undefined {
    const node = document.nodes[id];
    const box = scene[id];
    if (!box || !clip.length || (!root && (!box.visible || node.opacity === 0))) return;
    const visible = root ? unitBox : intersectPreviewOutlines(shape(node, box), clip);
    const children: DesignPreviewLayer[] = [];
    if (node.kind === 'frame' && !node.instanceOf && hasArtwork && box.visible && node.opacity !== 0) {
      const frameClip = node.clip === false ? clip : visible;
      const mask = designFrameMask(document, node);
      const childClip = mask ? intersectPreviewOutlines(shape(mask.node, scene[mask.id]), frameClip) : frameClip;
      // The document paints back to front. Retain that order for selecting the topmost hit.
      for (const childId of node.childIds) {
        if (childId === mask?.id) continue;
        const child = visit(childId, childClip);
        if (child) children.push(child);
      }
    }
    if (!visible.length && !children.length) return;
    const fills = designFills(node).filter((paint) => !paint.hidden && paint.opacity !== 0);
    const strokes = visibleDesignStrokes(node);
    // The viewer can retain a selection across modes without receiving the source layer IDs.
    if (keys && !keys.has(id)) keys.set(id, keys.size);
    // A transparent container is still selectable in the tree but shouldn't block the artwork beneath it.
    const pickable = root || node.kind !== 'frame' || node.instanceOf || fills.length || strokes.length;
    return {
      kind: root ? 'artboard' : layerKind(node),
      key: keys?.get(id),
      name: root ? boardName : shortLabel(node.name),
      bounds: [roundDesignValue(box.x), roundDesignValue(box.y), roundDesignValue(box.width), roundDesignValue(box.height)],
      rotation: roundDesignValue(node.rotation ?? 0),
      opacity: node.opacity ?? 1,
      outline: previewOutline(visible),
      pickable: pickable ? undefined : false,
      fills: fills.filter(isSolidPaint).map((paint) => colorWithOpacity(paint.color, paint.opacity)),
      strokes: strokes.filter(isSolidPaint).map((paint) => ({
        color: colorWithOpacity(paint.color, paint.opacity), width: roundDesignValue(paint.width),
      })),
      typography: node.kind === 'text' ? { family: shortLabel(node.fontFamily), size: node.fontSize, weight: node.fontWeight } : undefined,
      children,
    };
  }

  return visit(boardId, unitBox, true)!;
}

function shortLabel(value?: string) {
  return value?.trim().slice(0, maxDesignPreviewLayerNameLength) || undefined;
}

function layerKind(node: DesignNode): DesignPreviewLayerKind {
  if (node.kind === 'vector') return node.geometry.kind;
  if (node.kind !== 'frame') return node.kind;
  if (node.instanceOf) return 'instance';
  if (node.component) return 'component';
  return node.group ? 'group' : 'frame';
}

function isSolidPaint(paint: DesignPaint) {
  return !paint.gradient && !paint.image && !paint.shader;
}

function previewOutline(points: readonly Point[]): readonly Point[] {
  // Preserve an inscribed outline when many nested clips produce more vertices than the preview needs.
  const outline = points.length <= maxDesignPreviewOutlinePoints ? points : Array.from({ length: maxDesignPreviewOutlinePoints },
    (_, index) => points[Math.floor(index * points.length / maxDesignPreviewOutlinePoints)]);
  const coordinate = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
  return outline.map(([x, y]) => [coordinate(x), coordinate(y)]);
}

function signedArea(points: readonly Point[]) {
  return points.reduce((area, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length];
    return area + x * nextY - y * nextX;
  }, 0);
}

function intersectPreviewOutlines(shape: readonly Point[], clip: readonly Point[]): readonly Point[] {
  if (shape.length < 3 || clip.length < 3) return [];
  const direction = signedArea(clip) < 0 ? -1 : 1;
  let outline = shape;
  // Clip the convex outline against each visible edge so clipped layers do not receive clicks.
  for (let index = 0; index < clip.length && outline.length; index += 1) {
    const [x, y] = clip[index];
    const [nextX, nextY] = clip[(index + 1) % clip.length];
    const side = ([px, py]: Point) => direction * ((nextX - x) * (py - y) - (nextY - y) * (px - x));
    const inside: Point[] = [];
    let from = outline[outline.length - 1];
    let fromSide = side(from);
    for (const to of outline) {
      const toSide = side(to);
      if ((fromSide < 0) !== (toSide < 0)) {
        const fraction = fromSide / (fromSide - toSide);
        inside.push([from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction]);
      }
      if (toSide >= 0) inside.push(to);
      from = to;
      fromSide = toSide;
    }
    outline = inside;
  }
  return outline.length >= 3 && Math.abs(signedArea(outline)) > Number.EPSILON ? outline : [];
}
