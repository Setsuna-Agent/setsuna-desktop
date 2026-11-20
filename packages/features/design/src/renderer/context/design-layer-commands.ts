import type { DesignDocument, DesignEdit, DesignLayout, DesignNode } from '../../contracts/index.js';
import type { DesignScene } from '../design-layout.js';

export type DesignLayerCommand =
  | 'copy' | 'paste' | 'replace' | 'front' | 'back' | 'group' | 'frame' | 'ungroup'
  | 'addLayout' | 'removeLayout' | 'component' | 'detach' | 'flipX' | 'flipY' | 'delete'
  | 'mask' | 'removeMask' | 'union' | 'subtract';
export type DesignLayerActions = Partial<Record<DesignLayerCommand, () => void>>;

export function restackDesignLayers(document: DesignDocument, scene: DesignScene, ids: readonly string[], front: boolean): DesignEdit[] {
  const selected = new Set(ids);
  const parents = new Set(ids.map((id) => scene[id].parentId));
  return [...parents].flatMap((parentId): DesignEdit[] => {
    const parent = parentId ? document.nodes[parentId] : undefined;
    const order = parent?.kind === 'frame' ? parent.childIds : document.rootIds;
    const moving = order.filter((id) => selected.has(id));
    const stationary = order.filter((id) => !selected.has(id));
    const next = front ? [...stationary, ...moving] : [...moving, ...stationary];
    if (next.every((id, index) => id === order[index])) return [];
    const beforeId = front ? null : stationary[0] ?? null;
    return moving.map((nodeId) => ({ kind: 'reorder', nodeId, beforeId }));
  });
}

export const designLayoutDefaults = { direction: 'vertical', gap: 12, padding: 16, align: 'start' } as const satisfies DesignLayout;

export function defaultDesignAutoLayout(scene: DesignScene, ids: readonly string[]): DesignLayout {
  const boxes = ids.map((id) => scene[id]);
  const xs = boxes.map((box) => box.x + box.width / 2);
  const ys = boxes.map((box) => box.y + box.height / 2);
  const direction = Math.max(...xs) - Math.min(...xs) > Math.max(...ys) - Math.min(...ys) ? 'horizontal' : 'vertical';
  return { ...designLayoutDefaults, direction };
}

export function canContainDesignLayers(node: DesignNode | undefined) {
  return node?.kind === 'frame' && !node.instanceOf;
}
