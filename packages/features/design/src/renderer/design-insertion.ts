import type { DesignDocument } from '../contracts/index.js';
import { canContainDesignLayers } from './context/design-layer-commands.js';
import { containsBounds, intersectBounds, roundDesignValue, toLocal, toWorld, type Bounds, type Point } from './design-geometry.js';
import type { DesignLayerBox, DesignScene } from './design-layout.js';

export type DesignInsertionTarget = Readonly<{ parentId: string | null; center: Point }>;

export function resolveDesignInsertion(
  document: DesignDocument, scene: DesignScene, area: Bounds, selectedId: string | null, canInsert: (id: string) => boolean = () => true,
): DesignInsertionTarget {
  const center = midpoint(area);
  const parentId = selectedFrame() ?? nearestArtboard();
  if (parentId === null) return { parentId, center };
  const frame = scene[parentId];
  const visible = frame.visibleBounds && intersectBounds(area, frame.visibleBounds);
  if (visible) {
    return { parentId, center: containsBounds(visible, { ...center, width: 0, height: 0 }) ? center : midpoint(visible) };
  }
  const position = toWorld(frame, { x: frame.width / 2, y: frame.height / 2 });
  return { parentId, center: position };

  function canUse(id: string) {
    const box = scene[id];
    return Boolean(canContainDesignLayers(document.nodes[id]) && box?.visible && !box.locked && box.visibleBounds && canInsert(id));
  }

  function selectedFrame() {
    for (let id = selectedId; id !== null; id = scene[id]?.parentId ?? null) {
      if (canUse(id)) return id;
    }
    return null;
  }

  function nearestArtboard() {
    let closest: string | null = null;
    let distance = Infinity;
    let inView = false;
    // Iterate from the front, so overlapping artboards resolve in paint order.
    for (let index = document.rootIds.length - 1; index >= 0; index--) {
      const id = document.rootIds[index];
      const node = document.nodes[id];
      if (node.kind !== 'frame' || node.group || !canUse(id)) continue;
      const box = scene[id];
      const visible = Boolean(box.visibleBounds && intersectBounds(area, box.visibleBounds));
      if (inView && !visible) continue;
      const { x, y } = toLocal(box, center);
      const gap = Math.hypot(Math.max(0, -x, x - box.width), Math.max(0, -y, y - box.height));
      if ((visible && !inView) || gap < distance) {
        closest = id;
        inView = visible;
        distance = gap;
      }
    }
    return closest;
  }
}

export function centerDesignLayer(center: Point, size: Readonly<{ width: number; height: number }>, frame?: DesignLayerBox): Point {
  const local = toLocal(frame, center);
  const x = local.x - size.width / 2;
  const y = local.y - size.height / 2;
  return {
    x: roundDesignValue(frame ? Math.max(0, Math.min(frame.width - size.width, x)) : x),
    y: roundDesignValue(frame ? Math.max(0, Math.min(frame.height - size.height, y)) : y),
  };
}

function midpoint({ x, y, width, height }: Bounds): Point {
  return { x: x + width / 2, y: y + height / 2 };
}
