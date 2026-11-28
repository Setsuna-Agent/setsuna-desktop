import type { DesignDocument, DesignNode, DesignPaint } from '../../contracts/document.js';
import { designFrameMask } from '../../contracts/design-references.js';
import { maxDesignPreviewLayerNameLength, type DesignPreviewLayer,
  type DesignPreviewLayerKind } from '../../contracts/design-preview-layers.js';
import { roundDesignValue } from '../design-geometry.js';
import type { DesignScene } from '../design-layout.js';
import { colorWithOpacity, designFills, visibleDesignStrokes } from '../design-paint.js';
import type { DesignPreviewGeometry } from './design-preview-geometry.js';

export function designPreviewLayerTree(document: DesignDocument, scene: DesignScene, boardId: string, boardName: string,
  geometry: DesignPreviewGeometry, keys?: Map<string, number>): DesignPreviewLayer {
  const board = scene[boardId];
  const hasArtwork = board.visible && board.width > 0 && board.height > 0;
  const paths = geometry.forBoard(board);

  function visit(id: string, clip: ReturnType<typeof paths.intersect>): DesignPreviewLayer | undefined {
    const root = id === boardId;
    const node = document.nodes[id];
    const box = scene[id];
    if (!box || !clip || (!root && (!box.visible || node.opacity === 0))) return;
    const visible = paths.clippedLayer(node, box, clip);
    const children: DesignPreviewLayer[] = [];
    if (node.kind === 'frame' && !node.instanceOf && hasArtwork && box.visible && node.opacity !== 0) {
      const frameClip = node.clip === false ? clip : visible;
      const mask = designFrameMask(document, node);
      const childClip = mask ? paths.intersect(paths.mask(mask.node, scene[mask.id]), frameClip) : frameClip;
      // The document paints back to front. Retain that order for selecting the topmost hit.
      for (const childId of node.childIds) {
        if (childId === mask?.id) continue;
        const child = visit(childId, childClip);
        if (child) children.push(child);
      }
    }
    if (!root && !visible && !children.length) return;
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
      ...paths.outline(root ? paths.crop : visible),
      pickable: pickable ? undefined : false,
      fills: fills.filter(isSolidPaint).map((paint) => colorWithOpacity(paint.color, paint.opacity)),
      strokes: strokes.filter(isSolidPaint).map((paint) => ({
        color: colorWithOpacity(paint.color, paint.opacity), width: roundDesignValue(paint.width),
      })),
      typography: node.kind === 'text' ? { family: shortLabel(node.fontFamily), size: node.fontSize, weight: node.fontWeight } : undefined,
      children,
    };
  }

  return visit(boardId, paths.crop)!;
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
