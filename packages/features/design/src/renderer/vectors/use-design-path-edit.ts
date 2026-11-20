import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { DesignDocument, DesignPathAnchor, DesignPathGeometry } from '../../contracts/index.js';
import { isStraightDesignPath } from '../../contracts/vector-geometry.js';
import { applyDesignSnap, constrainDesignSegment, designSnapGuides, designSnapTargets, snapDesignBounds,
  type DesignGuide, type DesignSnapTargets } from '../canvas/design-snapping.js';
import type { DesignCanvasSettings } from '../context/design-canvas-settings.js';
import { isFlowChild } from '../design-canvas-edits.js';
import { boundsBetween, toLocal, toWorld, type Point } from '../design-geometry.js';
import type { DesignScene } from '../design-layout.js';
import { designCanvasSnapRange, snapDesignPoint, toCanvasScreen, toCanvasWorld, type CanvasAction, type CanvasViewport } from '../use-design-canvas-gestures.js';
import { designSegmentMeasurements, rebaseDesignPath } from './design-path-edit.js';
import { designPathAnchorsAtSize, isDesignPath, mapPathAnchors } from './design-vector.js';

type NodeHandle = Readonly<{ index: number; part: 'anchor' | 'incoming' | 'outgoing'; point: Point }>;
type Press = Readonly<{ id: string; revision: string; pointerId: number; handle: NodeHandle; start: Point;
  anchors: readonly DesignPathAnchor[]; snap?: DesignSnapTargets }>;
type Draft = Readonly<{ id: string; revision: string; anchors: readonly DesignPathAnchor[]; guides?: readonly DesignGuide[] }>;

export function useDesignPathEdit({ id, direct, document, projected, scene, viewport, revision, disabled, settings, onAction }: Readonly<{
  id: string | undefined;
  direct: boolean;
  document: DesignDocument;
  projected: DesignDocument;
  scene: DesignScene;
  viewport: CanvasViewport;
  revision: string;
  disabled: boolean;
  settings: DesignCanvasSettings;
  onAction(action: CanvasAction, revision: string): Promise<boolean>;
}>) {
  const node = id ? document.nodes[id] : undefined;
  const path = isDesignPath(node) ? node : undefined;
  const rendered = id ? projected.nodes[id] : undefined;
  const pose = id ? scene[id] : undefined;
  const anchors = useMemo(() => isDesignPath(rendered) && pose ? designPathAnchorsAtSize(rendered.geometry, pose) : undefined, [rendered, pose]);
  const press = useRef<Press>();
  const saving = useRef(false);
  const [draft, setDraft] = useState<Draft>();
  const [focus, setFocus] = useState<Readonly<{ id: string; index: number }>>();
  const selected = focus && focus.id === id ? focus.index : undefined;
  const active = draft && draft.id === id && draft.revision === revision ? draft : undefined;
  const segment = useMemo(() => direct && active && pose
    ? designSegmentMeasurements(active.anchors[0], active.anchors[1], pose) : undefined, [active, direct, pose]);
  const cancel = useCallback(() => {
    press.current = undefined;
    if (!saving.current) setDraft(undefined);
  }, []);

  useEffect(() => { cancel(); }, [cancel, id, revision]);

  function localPoint(event: PointerEvent<HTMLDivElement>) {
    return toLocal(pose, toCanvasWorld(viewport, toCanvasScreen(event.currentTarget, { x: event.clientX, y: event.clientY })));
  }

  function handleAt(point: Point): NodeHandle | undefined {
    const targets: NodeHandle[] = anchors?.map((anchor, index) => ({ index, part: 'anchor', point: anchor })) ?? [];
    if (selected !== undefined) {
      const focused = anchors?.[selected];
      if (focused?.incoming) targets.push({ index: selected, part: 'incoming', point: focused.incoming });
      if (focused?.outgoing) targets.push({ index: selected, part: 'outgoing', point: focused.outgoing });
    }
    let nearest: NodeHandle | undefined;
    let distance = 8 / viewport.scale;
    for (const target of targets) {
      const gap = Math.hypot(target.point.x - point.x, target.point.y - point.y);
      if (gap <= distance) { nearest = target; distance = gap; }
    }
    return nearest;
  }

  function move(active: Press, event: PointerEvent<HTMLDivElement>) {
    const { index, part } = active.handle;
    const pointer = localPoint(event);
    const dx = pointer.x - active.start.x;
    const dy = pointer.y - active.start.y;
    const anchors = [...active.anchors];
    const before = anchors[index];
    const shift = ({ x, y }: Point) => ({ x: x + dx, y: y + dy });
    const moved = Math.hypot(dx, dy) * viewport.scale >= 1;
    if (direct && pose) {
      const parent = pose.parentId ? scene[pose.parentId] : undefined;
      const pinned = toLocal(parent, toWorld(pose, anchors[1 - index]));
      const world = toWorld(pose, shift(before));
      const raw = toLocal(parent, world);
      const grid = !event.altKey && settings.snapToPixelGrid ? toLocal(parent, snapDesignPoint(world)) : raw;
      const targets = event.altKey ? undefined : active.snap;
      const matches = targets ? snapDesignBounds({ ...raw, width: 0, height: 0 }, targets, viewport.scale) : {};
      const snapped = applyDesignSnap(raw, grid, matches);
      const tip = event.shiftKey ? constrainDesignSegment(pinned, snapped) : snapped;
      anchors[index] = toLocal(pose, toWorld(parent, tip));
      return { anchors, moved, guides: targets && designSnapGuides(boundsBetween(pinned, tip), matches, parent, tip) };
    }
    anchors[index] = part === 'anchor' ? { ...shift(before), incoming: before.incoming && shift(before.incoming), outgoing: before.outgoing && shift(before.outgoing) }
      : { ...before, [part]: shift(active.handle.point) };
    return { anchors, moved };
  }

  const preview = active && pose && pose.width > 0 && pose.height > 0 && path ? {
    id: active.id, geometry: { ...path.geometry,
      anchors: mapPathAnchors(active.anchors, ({ x, y }) => ({ x: x / pose.width, y: y / pose.height })) } satisfies DesignPathGeometry,
  } : undefined;

  return {
    overlay: path && pose && anchors ? { pose, anchors: active?.anchors ?? anchors, closed: path.geometry.closed, selected } : undefined,
    preview,
    segment,
    guides: active?.guides,
    isDragging: () => Boolean(press.current),
    cancel,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!id || !pose || !anchors || disabled || saving.current || event.button !== 0 || press.current) return false;
      const start = localPoint(event);
      const handle = handleAt(start);
      if (!handle) return false;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      if (direct) event.currentTarget.style.cursor = 'grabbing';
      setFocus({ id, index: handle.index });
      const snap = direct && settings.snapToObjects
        ? designSnapTargets(projected, scene, pose.parentId, [id], designCanvasSnapRange(event.currentTarget, viewport)) : undefined;
      press.current = { id, revision, pointerId: event.pointerId, handle, start, anchors, snap };
      return true;
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const active = press.current;
      if (!active && direct && !disabled && handleAt(localPoint(event))) {
        event.currentTarget.style.cursor = 'grab';
        return true;
      }
      if (!active || active.pointerId !== event.pointerId || active.id !== id || active.revision !== revision || disabled) return false;
      const { anchors, guides } = move(active, event);
      setDraft({ id: active.id, revision, anchors, guides });
      return true;
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const active = press.current;
      if (!active || active.pointerId !== event.pointerId) return false;
      press.current = undefined;
      if (direct) event.currentTarget.style.cursor = '';
      if (!path || !pose || active.id !== id || active.revision !== revision || disabled) { setDraft(undefined); return true; }
      const moved = move(active, event);
      if (!moved.moved || direct && !isStraightDesignPath({ ...path.geometry, anchors: moved.anchors })) { setDraft(undefined); return true; }
      const parentPose = pose.parentId ? scene[pose.parentId] : undefined;
      const node = rebaseDesignPath(path, moved.anchors, pose, parentPose, Boolean(isFlowChild(projected, scene, id)));
      saving.current = true;
      setDraft({ id: active.id, revision, anchors: moved.anchors });
      void onAction({ kind: 'edit-path', id: active.id, node }, revision).finally(() => {
        saving.current = false;
        setDraft(undefined);
      });
      return true;
    },
    onPointerCancel(event: PointerEvent<HTMLDivElement>) {
      if (press.current?.pointerId !== event.pointerId) return;
      cancel();
      if (direct) event.currentTarget.style.cursor = '';
    },
  };
}
