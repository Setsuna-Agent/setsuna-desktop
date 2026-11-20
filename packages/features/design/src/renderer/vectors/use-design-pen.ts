import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { maxDesignPathAnchors, type DesignDocument, type DesignPathAnchor } from '../../contracts/index.js';
import { toLocal, type Point } from '../design-geometry.js';
import { findDesignFrameAtPoint } from '../design-layer-drop.js';
import type { DesignScene } from '../design-layout.js';
import { toCanvasScreen, toCanvasWorld, type CanvasAction, type CanvasViewport } from '../use-design-canvas-gestures.js';

type Draft = Readonly<{
  revision: string;
  parentId: string | null;
  anchors: readonly DesignPathAnchor[];
  cursor?: Point;
  closing?: boolean;
  closed?: boolean;
}>;
type Press = Readonly<{ pointerId: number; start: Point; screen: Point; before: Draft; closing: boolean }>;

export function useDesignPen({ enabled, disabled, document, scene, viewport, revision, snapToPixelGrid, onAction }: Readonly<{
  enabled: boolean;
  disabled: boolean;
  document: DesignDocument;
  scene: DesignScene;
  viewport: CanvasViewport;
  revision: string;
  snapToPixelGrid: boolean;
  onAction(action: CanvasAction, revision: string): Promise<boolean>;
}>) {
  const [preview, setPreview] = useState<Draft>();
  const draft = useRef<Draft>();
  const press = useRef<Press>();
  const saving = useRef(false);
  const publish = useCallback((next: Draft | undefined) => {
    draft.current = next;
    setPreview(next);
  }, []);
  const cancel = useCallback(() => {
    press.current = undefined;
    if (draft.current) publish(undefined);
  }, [publish]);

  useEffect(() => {
    if (!enabled || (draft.current && draft.current.revision !== revision)) cancel();
  }, [cancel, enabled, revision]);

  function worldPoint(screen: Point, altKey: boolean) {
    const world = toCanvasWorld(viewport, screen);
    return snapToPixelGrid && !altKey ? { x: Math.round(world.x), y: Math.round(world.y) } : world;
  }

  function withinStart(current: Draft, point: Point) {
    const first = current.anchors[0];
    return current.anchors.length >= 3 && Math.hypot(first.x - point.x, first.y - point.y) <= 9 / viewport.scale;
  }

  function placeAnchor(active: Press, screen: Point, point: Point): Draft {
    const moved = Math.hypot(screen.x - active.screen.x, screen.y - active.screen.y) >= 3;
    const { start } = active;
    const anchor = moved ? { ...start, incoming: { x: 2 * start.x - point.x, y: 2 * start.y - point.y }, outgoing: point } : start;
    return { ...active.before, anchors: [...active.before.anchors, anchor], cursor: undefined, closing: false };
  }

  function finish(current: Draft, closed: boolean) {
    if (saving.current || current.revision !== revision || current.anchors.length < (closed ? 3 : 2)) return;
    press.current = undefined;
    saving.current = true;
    const pending = { ...current, cursor: undefined, closing: false, closed };
    publish(pending);
    void onAction({ kind: 'path', parentId: current.parentId, anchors: current.anchors, closed }, current.revision)
      .then((saved) => {
        if (draft.current !== pending) return;
        if (saved) cancel();
        else publish({ ...pending, closed: false });
      })
      .finally(() => { saving.current = false; });
  }

  return {
    preview: enabled && preview?.revision === revision ? preview : undefined,
    cancel,
    isPlacingAnchor: () => Boolean(press.current),
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!enabled || disabled || event.button !== 0) return false;
      if (press.current || saving.current) return true;
      const screen = toCanvasScreen(event.currentTarget, { x: event.clientX, y: event.clientY });
      const world = worldPoint(screen, event.altKey);
      const before = draft.current?.revision === revision ? draft.current : {
        revision, parentId: findDesignFrameAtPoint(document, scene, world), anchors: [],
      };
      const point = toLocal(before.parentId ? scene[before.parentId] : undefined, world);
      const closing = withinStart(before, point);
      const last = before.anchors.at(-1);
      if (!closing && (before.anchors.length >= maxDesignPathAnchors || (last && last.x === point.x && last.y === point.y))) return true;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      const active = { pointerId: event.pointerId, start: point, screen, before, closing };
      press.current = active;
      publish(closing ? { ...before, cursor: before.anchors[0], closing: true } : placeAnchor(active, screen, point));
      return true;
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = draft.current;
      if (!enabled || disabled || saving.current || current?.revision !== revision) return;
      const active = press.current;
      if (active && (active.pointerId !== event.pointerId || active.closing)) return;
      const screen = toCanvasScreen(event.currentTarget, { x: event.clientX, y: event.clientY });
      const point = toLocal(current.parentId ? scene[current.parentId] : undefined, worldPoint(screen, event.altKey));
      if (active) publish(placeAnchor(active, screen, point));
      else {
        const closing = withinStart(current, point);
        publish({ ...current, cursor: closing ? current.anchors[0] : point, closing });
      }
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const active = press.current;
      if (!active || active.pointerId !== event.pointerId) return false;
      press.current = undefined;
      if (!enabled || disabled || active.before.revision !== revision) { cancel(); return true; }
      if (active.closing) finish(active.before, true);
      else {
        const screen = toCanvasScreen(event.currentTarget, { x: event.clientX, y: event.clientY });
        const point = toLocal(active.before.parentId ? scene[active.before.parentId] : undefined, worldPoint(screen, event.altKey));
        publish(placeAnchor(active, screen, point));
      }
      return true;
    },
    onPointerCancel(event: PointerEvent<HTMLDivElement>) {
      const active = press.current;
      if (active?.pointerId !== event.pointerId) return;
      press.current = undefined;
      publish(active.before.anchors.length ? active.before : undefined);
    },
    onPointerLeave() {
      const current = draft.current;
      if (current?.cursor && !press.current) publish({ ...current, cursor: undefined, closing: false });
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const current = draft.current;
      if (!enabled || disabled || current?.revision !== revision || saving.current) return false;
      if (event.key === 'Escape') {
        if (current.anchors.length >= 2) finish(current, false);
        else cancel();
      } else if (event.key === 'Enter' && !press.current) finish(current, false);
      else if (event.key === 'Backspace' || ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z')) {
        if (press.current) return true;
        const anchors = current.anchors.slice(0, -1);
        publish(anchors.length ? { ...current, anchors, cursor: undefined, closing: false } : undefined);
      } else return false;
      return true;
    },
  };
}
