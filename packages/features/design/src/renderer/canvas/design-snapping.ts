import type { DesignDocument } from '../../contracts/index.js';
import {
  boundsBetween, containsBounds, directionOfRotation, intersectBounds, layerOutline, toLocal, toWorld, transformedBounds,
  type Bounds, type DesignTransform, type Point,
} from '../design-geometry.js';
import type { DesignScene } from '../design-layout.js';

type Axis = 'x' | 'y';
type Anchor = 0 | 1 | 0.5;
type SnapTarget = Readonly<{ outline: Bounds; visible: Bounds }>;
type SnapMatch = Readonly<{ at: number; anchor: Anchor; offset: number; visible: Bounds }>;
type SnapMatches = Readonly<Partial<Record<Axis, SnapMatch>>>;
type SnapAnchors = Readonly<Record<Axis, readonly Anchor[]>>;
type DrawingCorners = Readonly<{ start: Point; end: Point }>;
export type DesignGuide = Readonly<{ axis: Axis; points: number[] }>;
export type DesignSnapTargets = Readonly<{ frame?: SnapTarget; siblings: readonly SnapTarget[]; pose?: DesignTransform }>;

const axes = ['x', 'y'] as const;
const dimensions = { x: 'width', y: 'height' } as const;
const edges = [0, 1] as const;
const center = [0.5] as const;
const allAnchors = [0, 1, 0.5] as const;
const moveAnchors: SnapAnchors = { x: allAnchors, y: allAnchors };
const drawAnchors: SnapAnchors = { x: edges, y: edges };

export function designSnapTargets(document: DesignDocument, scene: DesignScene, parentId: string | null, excluded: readonly string[], range: Bounds): DesignSnapTargets {
  const pose = parentId === null ? undefined : scene[parentId];
  const parent = parentId === null ? undefined : document.nodes[parentId];
  const frame = parent?.kind === 'frame' ? parent : undefined;
  const excludedIds = new Set(excluded);

  function target(id: string, outline: Bounds): SnapTarget | undefined {
    const box = scene[id];
    const visible = box.visibleBounds;
    if (!box.visible || !visible || !intersectBounds(range, visible)) return;
    if (containsBounds(visible, box.paintBounds)) return { outline, visible: outline };
    const shown = intersectBounds(outline, localVisibleBounds(visible, pose));
    return shown ? { outline, visible: shown } : undefined;
  }

  return {
    pose,
    frame: parentId !== null && pose && frame && !frame.group
      ? target(parentId, { x: 0, y: 0, width: pose.width, height: pose.height }) : undefined,
    siblings: (frame?.childIds ?? document.rootIds).flatMap((id) => {
      if (excludedIds.has(id)) return [];
      const box = scene[id];
      const match = target(id, pose ? layerOutline(box, document.nodes[id]) : box.paintBounds);
      return match ? [match] : [];
    }),
  };
}

function localVisibleBounds(bounds: Bounds, pose: DesignTransform | undefined) {
  if (!pose) return bounds;
  const origin = toLocal(pose, bounds);
  return transformedBounds({ ...bounds, absoluteX: origin.x, absoluteY: origin.y,
    angle: -pose.angle * directionOfRotation(pose), scaleX: pose.scaleX, scaleY: pose.scaleY });
}

export function snapDesignBounds(moving: Bounds, targets: DesignSnapTargets, scale: number, anchors = moveAnchors): SnapMatches {
  function matchAxis(axis: Axis) {
    const size = dimensions[axis];
    let limit = 10 / scale;
    let match: SnapMatch | undefined;
    function check(target: SnapTarget, anchor: Anchor, ratio: Anchor) {
      const at = target.outline[axis] + target.outline[size] * ratio;
      if (at < target.visible[axis] - 1e-9 || at > target.visible[axis] + target.visible[size] + 1e-9) return;
      const offset = at - (moving[axis] + moving[size] * anchor);
      const distance = Math.abs(offset);
      if (distance >= limit) return;
      match = { at, anchor, offset, visible: target.visible };
      limit = distance;
    }

    // A nearby frame edge takes precedence over guides from content inside the frame.
    if (targets.frame) {
      for (const anchor of anchors[axis]) if (anchor !== 0.5) check(targets.frame, anchor, anchor);
      if (match) return match;
    }
    limit = 6 / scale;
    for (const sibling of targets.siblings) {
      for (const anchor of anchors[axis]) {
        for (const ratio of anchor === 0.5 ? center : edges) check(sibling, anchor, ratio);
      }
    }
    if (targets.frame && anchors[axis].includes(0.5)) check(targets.frame, 0.5, 0.5);
    return match;
  }

  return { x: matchAxis('x'), y: matchAxis('y') };
}

export function resizeSnapAnchors(direction: Point): SnapAnchors {
  return { x: Math.abs(direction.x) < 0.5 ? [] : [direction.x < 0 ? 0 : 1],
    y: Math.abs(direction.y) < 0.5 ? [] : [direction.y < 0 ? 0 : 1] };
}

export function applyDesignSnap(point: Point, fallback: Point, matches: SnapMatches): Point {
  return { x: matches.x ? point.x + matches.x.offset : fallback.x,
    y: matches.y ? point.y + matches.y.offset : fallback.y };
}

export function constrainDesignSegment(start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const length = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + Math.round(Math.cos(angle)) * length, y: start.y + Math.round(Math.sin(angle)) * length };
}

export function designDrawingBounds(corners: DrawingCorners, fallback: DrawingCorners, { segment, constrain }: Readonly<{ segment: boolean; constrain: boolean }>,
  targets: DesignSnapTargets | undefined, scale: number) {
  const matchCorner = (point: Point): SnapMatches => targets
    ? snapDesignBounds({ ...point, width: 0, height: 0 }, targets, scale, drawAnchors) : {};
  const origin = matchCorner(corners.start);
  const tip = matchCorner(corners.end);
  const start = { x: origin.x?.at ?? fallback.start.x, y: origin.y?.at ?? fallback.start.y };
  let end = { x: tip.x?.at ?? fallback.end.x, y: tip.y?.at ?? fallback.end.y };
  // A straight segment can run along a single edge. Keep a free coordinate if a box side or the entire segment would collapse.
  if (!segment || (end.x === start.x && end.y === start.y)) {
    end = { x: end.x === start.x ? fallback.end.x : end.x, y: end.y === start.y ? fallback.end.y : end.y };
  }
  if (constrain && segment) end = constrainDesignSegment(start, end);
  else if (constrain) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(Math.abs(dx), Math.abs(dy));
    end = { x: start.x + (Math.sign(dx) || 1) * length, y: start.y + (Math.sign(dy) || 1) * length };
  }
  const bounds = boundsBetween(start, end);
  if (!targets) return { bounds, start, end };
  const startGuides = designSnapGuides(bounds, origin, targets.pose, start);
  const endGuides = designSnapGuides(bounds, tip, targets.pose, end).filter(({ axis }) =>
    start[axis] !== end[axis] || !startGuides.some((guide) => guide.axis === axis));
  return { bounds, start, end, guides: [...startGuides, ...endGuides] };
}

export function designSnapGuides(bounds: Bounds, matches: SnapMatches, pose: DesignTransform | undefined, corner?: Point): DesignGuide[] {
  const guides: DesignGuide[] = [];
  for (const axis of axes) {
    const match = matches[axis];
    if (!match) continue;
    // A constrained drag may stop short of the chosen target.
    const edge = corner?.[axis] ?? bounds[axis] + bounds[dimensions[axis]] * match.anchor;
    if (Math.abs(edge - match.at) > 0.011) continue;
    const cross = axis === 'x' ? 'y' : 'x';
    const size = dimensions[cross];
    const start = Math.min(bounds[cross], match.visible[cross]);
    const end = Math.max(bounds[cross] + bounds[size], match.visible[cross] + match.visible[size]);
    const a = toWorld(pose, axis === 'x' ? { x: match.at, y: start } : { x: start, y: match.at });
    const b = toWorld(pose, axis === 'x' ? { x: match.at, y: end } : { x: end, y: match.at });
    guides.push({ axis, points: [a.x, a.y, b.x, b.y] });
  }
  return guides;
}
