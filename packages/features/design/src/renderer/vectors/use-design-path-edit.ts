import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { DesignDocument, DesignPathAnchor, DesignPathGeometry } from '../../contracts/index.js';
import { isFlowChild } from '../design-canvas-edits.js';
import { roundDesignValue, toLocal, toWorld, type Point } from '../design-geometry.js';
import type { DesignScene } from '../design-layout.js';
import { toCanvasScreen, toCanvasWorld, type CanvasAction, type CanvasViewport } from '../use-design-canvas-gestures.js';
import { fitDesignPath, isDesignPath, mapPathAnchors } from './design-vector.js';

type NodeHandle = Readonly<{ index: number; part: 'anchor' | 'incoming' | 'outgoing'; point: Point }>;
type Press = Readonly<{ id: string; revision: string; pointerId: number; handle: NodeHandle; start: Point; anchors: readonly DesignPathAnchor[] }>;

export function useDesignPathEdit({ id, document, scene, viewport, revision, disabled, onAction }: Readonly<{
  id: string | undefined;
  document: DesignDocument;
  scene: DesignScene;
  viewport: CanvasViewport;
  revision: string;
  disabled: boolean;
  onAction(action: CanvasAction, revision: string): Promise<boolean>;
}>) {
  const node = id ? document.nodes[id] : undefined;
  const path = isDesignPath(node) ? node : undefined;
  const pose = id ? scene[id] : undefined;
  const anchors = useMemo(() => path && pose
    ? mapPathAnchors(path.geometry.anchors, ({ x, y }) => ({ x: x * pose.width, y: y * pose.height })) : undefined, [path, pose]);
  const press = useRef<Press>();
  const saving = useRef(false);
  const [draft, setDraft] = useState<Readonly<{ id: string; revision: string; anchors: readonly DesignPathAnchor[] }>>();
  const [focus, setFocus] = useState<Readonly<{ id: string; index: number }>>();
  const selected = focus && focus.id === id ? focus.index : undefined;
  const active = draft && draft.id === id && draft.revision === revision ? draft : undefined;
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

  function move(active: Press, pointer: Point) {
    const { index, part } = active.handle;
    const dx = pointer.x - active.start.x;
    const dy = pointer.y - active.start.y;
    const anchors = [...active.anchors];
    const before = anchors[index];
    const shift = ({ x, y }: Point) => ({ x: x + dx, y: y + dy });
    anchors[index] = part === 'anchor' ? { ...shift(before), incoming: before.incoming && shift(before.incoming), outgoing: before.outgoing && shift(before.outgoing) }
      : { ...before, [part]: shift(active.handle.point) };
    return { anchors, moved: Math.hypot(dx, dy) * viewport.scale >= 1 };
  }

  const preview = active && pose && path ? {
    id: active.id, geometry: { kind: 'path', closed: path.geometry.closed,
      anchors: mapPathAnchors(active.anchors, ({ x, y }) => ({ x: x / pose.width, y: y / pose.height })) } satisfies DesignPathGeometry,
  } : undefined;

  return {
    overlay: path && pose && anchors ? { pose, anchors: active?.anchors ?? anchors, closed: path.geometry.closed, selected } : undefined,
    preview,
    isDragging: () => Boolean(press.current),
    cancel,
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!id || !anchors || disabled || saving.current || event.button !== 0 || press.current) return false;
      const start = localPoint(event);
      const handle = handleAt(start);
      if (!handle) return false;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      setFocus({ id, index: handle.index });
      press.current = { id, revision, pointerId: event.pointerId, handle, start, anchors };
      return true;
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const active = press.current;
      if (!active || active.pointerId !== event.pointerId || active.id !== id || active.revision !== revision || disabled) return false;
      const moved = move(active, localPoint(event));
      setDraft({ id: active.id, revision, anchors: moved.anchors });
      return true;
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const active = press.current;
      if (!active || active.pointerId !== event.pointerId) return false;
      press.current = undefined;
      if (!path || !pose || active.id !== id || active.revision !== revision || disabled) { setDraft(undefined); return true; }
      const moved = move(active, localPoint(event));
      if (!moved.moved) { setDraft(undefined); return true; }
      const { bounds, geometry } = fitDesignPath(moved.anchors, path.geometry.closed);
      const parentPose = pose.parentId ? scene[pose.parentId] : undefined;
      // Rebase the layer around the new bounds while preserving the world position of untouched nodes.
      const center = toLocal(parentPose, toWorld(pose, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }));
      const position = isFlowChild(document, scene, id) ? { x: path.x, y: path.y }
        : { x: roundDesignValue(center.x - bounds.width / 2), y: roundDesignValue(center.y - bounds.height / 2) };
      saving.current = true;
      setDraft({ id: active.id, revision, anchors: moved.anchors });
      void onAction({ kind: 'edit-path', id: active.id, node: { ...path, ...bounds, ...position, geometry } }, revision).finally(() => {
        saving.current = false;
        setDraft(undefined);
      });
      return true;
    },
    onPointerCancel(event: PointerEvent<HTMLDivElement>) {
      if (press.current?.pointerId === event.pointerId) cancel();
    },
  };
}
