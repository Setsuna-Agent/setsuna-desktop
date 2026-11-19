import type { DesignDocument } from '../contracts/index.js';
import { containsDesignLayer } from './components/design-components.js';
import { canContainDesignLayers } from './context/design-layer-commands.js';
import { toLocal, type Point } from './design-geometry.js';
import type { DesignScene } from './design-layout.js';

export const designLayerDragType = 'application/x-setsuna-design-layer';
export type DesignLayerDrag = Readonly<{ id: string; revision: string }>;
export type DesignLayerDestination = Readonly<{ parentId: string | null; beforeId: string | null; center?: Point }>;

export function activeDesignLayerDrag(transfer: DataTransfer, source: DesignLayerDrag | undefined, revision: string) {
  return source?.revision === revision && transfer.types.includes(designLayerDragType) ? source : undefined;
}

export function designLayerOrder(document: DesignDocument, parentId: string | null) {
  const parent = parentId ? document.nodes[parentId] : undefined;
  const frame = parent?.kind === 'frame' ? parent : undefined;
  const ids = frame?.childIds ?? document.rootIds;
  return { ids, frontFirst: !frame?.layout };
}

export function canDropDesignLayer(document: DesignDocument, scene: DesignScene, id: string, parentId: string | null) {
  if (!scene[id] || scene[id].locked) return false;
  if (parentId === null) return true;
  if (!canContainDesignLayers(document.nodes[parentId]) || scene[parentId]?.locked !== false) return false;
  return parentId === scene[id].parentId || !containsDesignLayer(document, id, parentId);
}

export function findDesignFrameAtPoint(document: DesignDocument, scene: DesignScene, point: Point, excludedId?: string) {
  // Use the original scene so the floating layer and the reflow cannot change their own drop target.
  function findFrame(ids: readonly string[]): string | null {
    for (let index = ids.length - 1; index >= 0; index--) {
      const target = ids[index];
      const frame = document.nodes[target];
      const box = scene[target];
      if (target === excludedId || frame.kind !== 'frame' || frame.instanceOf || !box.visible || box.locked) continue;
      const { x, y } = toLocal(box, point);
      const inside = x >= 0 && y >= 0 && x <= box.width && y <= box.height;
      if (inside || frame.clip === false) {
        const nested = findFrame(frame.childIds);
        if (nested) return nested;
        if (inside && (!excludedId || canDropDesignLayer(document, scene, excludedId, target))) return target;
      }
    }
    return null;
  }
  return findFrame(document.rootIds);
}

export function changesDesignLayerOrder(ids: readonly string[], id: string, beforeId: string | null) {
  const from = ids.indexOf(id);
  return beforeId !== id && (from < 0 || beforeId !== (ids[from + 1] ?? null));
}
