import type { DesignDocument, DesignNode } from '../../contracts/index.js';
import { designFrameMask } from '../../contracts/design-references.js';
import { intersectBounds, toWorld, transformedBounds, unionBounds, type Bounds } from '../design-geometry.js';
import { designLayerImagePaths, type LoadDesignImage } from '../design-images.js';
import type { DesignLayerBox, DesignScene } from '../design-layout.js';
import { visibleDesignStrokes } from '../design-paint.js';

export type DesignExportSelection = Readonly<{ document: DesignDocument; scene: DesignScene; ids: readonly string[] }>;

export async function loadExportImages({ document, scene, ids }: DesignExportSelection, loadImage: LoadDesignImage) {
  const paths = new Set<string>();
  function visit(id: string) {
    if (!scene[id].visible) return;
    const node = document.nodes[id];
    designLayerImagePaths(node, true).forEach((path) => paths.add(path));
    if (node.kind === 'frame') node.childIds.forEach(visit);
  }
  ids.forEach(visit);
  return new Map(await Promise.all([...paths].map(async (path) => [path, await loadImage(path, { fresh: true })] as const)));
}

export function designExportBounds({ document, scene, ids }: DesignExportSelection): Bounds | undefined {
  const bounds: Bounds[] = [];
  function visit(id: string, clip?: Bounds | null) {
    const box = scene[id];
    if (!box.visible || clip === null) return;
    const node = document.nodes[id];
    const ink = paintedBounds(node, box);
    const visible = clip ? intersectBounds(clip, ink) : ink;
    if (visible) bounds.push(visible);
    if (node.kind === 'frame') {
      const childClip = node.clip === false ? clip : clip ? intersectBounds(clip, box.paintBounds) : box.paintBounds;
      const mask = designFrameMask(document, node);
      const maskBounds = mask && scene[mask.id].paintBounds;
      const maskedClip = maskBounds && childClip !== null
        ? childClip ? intersectBounds(childClip, maskBounds) : maskBounds : childClip;
      node.childIds.forEach((child) => { if (child !== mask?.id) visit(child, maskedClip); });
    }
  }
  ids.forEach((id) => visit(id));
  return unionBounds(bounds);
}

function paintedBounds(node: DesignNode, box: DesignLayerBox): Bounds {
  const shadow = node.shadow?.hidden || node.shadow?.opacity === 0 ? undefined : node.shadow;
  const outside = visibleDesignStrokes(node).reduce((outset, stroke) => {
    const alignment = node.kind === 'text' || node.kind === 'vector' ? 'center' : stroke.alignment;
    const extent = stroke.width * (alignment === 'inside' ? 0 : alignment === 'outside' ? 1 : 0.5);
    return Math.max(outset, extent);
  }, 0);
  if (!outside && !shadow) return box.paintBounds;
  function expanded(x: number, y: number, padding: number) {
    const origin = toWorld(box, { x: x - padding, y: y - padding });
    return transformedBounds({ ...box, absoluteX: origin.x, absoluteY: origin.y,
      width: box.width + padding * 2, height: box.height + padding * 2 });
  }
  const outline = expanded(0, 0, outside);
  if (!shadow) return outline;
  return unionBounds([outline, expanded(shadow.x, shadow.y, outside + shadow.blur * 2)]) ?? outline;
}
