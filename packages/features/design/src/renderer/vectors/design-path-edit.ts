import type { DesignNode, DesignPathAnchor } from '../../contracts/index.js';
import { normalizeDesignRotation } from '../../contracts/design-variables.js';
import { isStraightDesignPath } from '../../contracts/vector-geometry.js';
import { rotatePoint, roundDesignValue, toLocal, toLocalVector, toWorld, toWorldVector, type DesignTransform, type Point } from '../design-geometry.js';
import { designPathAnchorsAtSize, fitDesignPath, isDesignPath, type DesignPathNode } from './design-vector.js';

export type DesignSegmentMeasurements = Readonly<{ length: number; angle: number }>;
export type DesignSegment = DesignSegmentMeasurements & Readonly<{ start: Point }>;

export function designSegmentMeasurements(start: Point, end: Point, pose?: DesignTransform): DesignSegmentMeasurements {
  const { x, y } = toWorldVector(pose, { x: end.x - start.x, y: end.y - start.y });
  return { length: Math.hypot(x, y), angle: normalizeDesignRotation(Math.atan2(y, x) * 180 / Math.PI) };
}

export function measureDesignSegment(node: DesignNode, box: DesignTransform & Readonly<{ width: number; height: number }>): DesignSegment | undefined {
  if (!isDesignPath(node) || !isStraightDesignPath(node.geometry)) return;
  const [start, end] = designPathAnchorsAtSize(node.geometry, box);
  return { start, ...designSegmentMeasurements(start, end, box) };
}

export function rebaseDesignPath(path: DesignPathNode, anchors: readonly DesignPathAnchor[], pose: DesignTransform,
  parent: DesignTransform | undefined, inFlow: boolean): DesignPathNode {
  const straight = isStraightDesignPath(path.geometry);
  const { bounds, geometry } = fitDesignPath(anchors, path.geometry.closed, straight ? 'exact' : 'rounded');
  // Rebase around the new bounds while preserving untouched anchors under rotations and flips.
  const center = toLocal(parent, toWorld(pose, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }));
  let x = center.x - bounds.width / 2;
  let y = center.y - bounds.height / 2;
  if (inFlow) ({ x, y } = path);
  else if (!straight) { x = roundDesignValue(x); y = roundDesignValue(y); }
  return { ...path, ...bounds, x, y, geometry: { ...path.geometry, ...geometry },
    widthMode: straight && path.widthMode === 'fill' ? 'fixed' : path.widthMode,
    heightMode: straight && path.heightMode === 'fill' ? 'fixed' : path.heightMode };
}

export function reshapeDesignSegment(node: DesignNode, segment: DesignSegment, pose: DesignTransform,
  parent: DesignTransform | undefined, inFlow: boolean, values: Partial<DesignSegmentMeasurements>): DesignNode {
  if (!isDesignPath(node) || !isStraightDesignPath(node.geometry)) return node;
  const { start } = segment;
  const length = values.length ?? segment.length;
  const angle = values.angle ?? segment.angle;
  if (length <= 0) return node;
  const direction = rotatePoint({ x: length, y: 0 }, normalizeDesignRotation(angle));
  const offset = toLocalVector(pose, direction);
  const end = { x: start.x + offset.x, y: start.y + offset.y };
  if (!Number.isFinite(end.x) || !Number.isFinite(end.y) || (end.x === start.x && end.y === start.y)) return node;
  return rebaseDesignPath(node, [start, end], pose, parent, inFlow);
}
