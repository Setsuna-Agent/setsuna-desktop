import type { DesignAgent } from '../../contracts/design-task.js';
import type { DesignDocument } from '../../contracts/document.js';
import { selectedBranches } from '../design-canvas-edits.js';
import { containsBounds, toLocalVector, toWorld, unionBounds, type Point } from '../design-geometry.js';
import type { DesignScene } from '../design-layout.js';
import { designPrototypeBoardFor } from '../prototype/design-prototype.js';

export type DesignBoardFocus = Readonly<{ agent?: DesignAgent; boardId: string | null; ids: readonly string[]; point: Point }>;
export type DesignAgentFocus = readonly DesignBoardFocus[];

export function designAgentFocus(document: DesignDocument, scene: DesignScene, ids: readonly string[]): DesignAgentFocus | undefined {
  const groups = new Map<string | null, string[]>();
  for (const id of selectedBranches(ids.filter((id) => scene[id]?.visible && scene[id].visibleBounds), scene)) {
    const root = designPrototypeBoardFor(id, scene);
    const node = root ? document.nodes[root] : undefined;
    // Loose layers share the canvas. Nested frames belong to their top-level artboard.
    const boardId = root && node?.kind === 'frame' && !node.group ? root : null;
    const group = groups.get(boardId);
    if (group) group.push(id);
    else groups.set(boardId, [id]);
  }
  if (!groups.size) return;
  return Array.from(groups, ([boardId, ids]) => ({ boardId, ids, point: designFocusCorner(scene, ids)! }));
}

export function designFocusCorner(scene: DesignScene, ids: readonly string[]): Point | undefined {
  const box = scene[ids[0]];
  if (ids.length === 1 && box?.visibleBounds && containsBounds(box.visibleBounds, box.paintBounds)) {
    // Anchor the pointer to the outward corner of rotated and reflected layers.
    const direction = toLocalVector(box, { x: 1, y: 1 });
    return toWorld(box, { x: direction.x >= 0 ? box.width : 0, y: direction.y >= 0 ? box.height : 0 });
  }
  const bounds = unionBounds(ids.flatMap((id) => scene[id]?.visibleBounds ?? []));
  return bounds && { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
}
