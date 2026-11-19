import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DesignDocument } from '../../contracts/index.js';
import { toLocal, type DesignTransform, type Point } from '../design-geometry.js';
import { designDrawingPlacement } from '../design-insertion.js';
import { findDesignFrameAtPoint } from '../design-layer-drop.js';
import type { DesignScene } from '../design-layout.js';
import { toCanvasScreen, toCanvasWorld, type CanvasViewport } from '../use-design-canvas-gestures.js';
import { freehandDesignNode, type DrawingPreview, type DrawingSample, type FreehandInk, type FreehandTool } from './design-drawing.js';
import { trackDesignDrawingPointer } from './design-drawing-pointer.js';

type Stroke = {
  id: string;
  pointerId: number;
  surface: HTMLDivElement;
  events: AbortController;
  revision: string;
  tool: FreehandTool;
  parentId: string | null;
  parent?: DesignTransform;
  viewport: CanvasViewport;
  ink: FreehandInk;
  points: [DrawingSample, ...DrawingSample[]];
};

type FreehandOptions = Readonly<{
  tool?: FreehandTool;
  ink?: FreehandInk;
  disabled: boolean;
  document: DesignDocument;
  scene: DesignScene;
  viewport: CanvasViewport;
  revision: string;
  onCommit(stroke: DrawingPreview, revision: string): Promise<boolean>;
}>;

export function useDesignFreehand(options: FreehandOptions) {
  const { tool, ink, disabled, document, scene, viewport, revision } = options;
  const latest = useRef(options);
  const stroke = useRef<Stroke>();
  const frame = useRef<number>();
  const [preview, setPreview] = useState<DrawingPreview & { revision: string; tool: FreehandTool }>();
  const stopFrame = useCallback(() => {
    if (frame.current === undefined) return;
    cancelAnimationFrame(frame.current);
    frame.current = undefined;
  }, []);
  const endGesture = useCallback(() => {
    stroke.current?.events.abort();
    stroke.current = undefined;
    stopFrame();
  }, [stopFrame]);
  const cancel = useCallback(() => {
    if (!stroke.current) return;
    endGesture();
    setPreview(undefined);
  }, [endGesture]);
  useLayoutEffect(() => endGesture, [endGesture]);
  useLayoutEffect(() => {
    latest.current = options;
    const active = stroke.current;
    if (active && (active.tool !== options.tool || active.revision !== options.revision || options.disabled)) cancel();
  }, [cancel, options]);

  function makePreview(active: Stroke) {
    // Focusing the canvas can commit a toolbar input after the pointer goes down.
    const { ink, document, scene } = latest.current;
    const node = freehandDesignNode(active.points, ink ?? active.ink);
    const { parentId, placement } = designDrawingPlacement(document, scene, active.parentId, node);
    return { id: active.id, parentId, node: { ...node, ...placement },
      revision: active.revision, tool: active.tool };
  }

  function addPoint(active: Stroke, event: PointerEvent, finish = false) {
    const coalesced = finish ? [] : event.getCoalescedEvents?.() ?? [];
    let changed = false;
    for (const pointer of coalesced.length ? coalesced : [event]) {
      const screen = toCanvasScreen(active.surface, { x: pointer.clientX, y: pointer.clientY });
      const point = toLocal(active.parent, toCanvasWorld(active.viewport, screen));
      const previous = active.points[active.points.length - 1];
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < (finish ? 0.001 : 0.75 / active.viewport.scale)) continue;
      active.points.push(pressurePoint(point, pointer));
      changed = true;
    }
    // Preserve the entire stroke when a long drag exceeds the input buffer.
    if (active.points.length > 2048) {
      const [first, ...remaining] = active.points;
      active.points = [first, ...remaining.filter((_, index, points) => index % 2 === 1 || index === points.length - 1)];
    }
    return changed;
  }

  function finish(active: Stroke, release?: PointerEvent) {
    if (release) addPoint(active, release, true);
    const completed = makePreview(active);
    endGesture();
    void latest.current.onCommit(completed, active.revision);
    setPreview(undefined);
  }

  function track(active: Stroke, view: Window) {
    trackDesignDrawingPointer(view, active.pointerId, active.events.signal, {
      move(event) {
        if (!addPoint(active, event) || frame.current !== undefined) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = undefined;
          if (stroke.current === active) setPreview(makePreview(active));
        });
      },
      finish: (release) => finish(active, release),
      cancel,
    });
  }

  return {
    preview: preview?.revision === revision && preview.tool === tool ? preview : undefined,
    isDrawing: () => Boolean(stroke.current),
    cancel,
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (!tool || !ink || event.button !== 0) return false;
      if (disabled || stroke.current) return true;
      const surface = event.currentTarget;
      const view = surface.ownerDocument.defaultView;
      if (!view) return false;
      const screen = toCanvasScreen(surface, { x: event.clientX, y: event.clientY });
      const world = toCanvasWorld(viewport, screen);
      const parentId = findDesignFrameAtPoint(document, scene, world);
      const parent = parentId === null ? undefined : scene[parentId];
      const active: Stroke = { id: crypto.randomUUID(), pointerId: event.pointerId, surface, events: new AbortController(),
        revision, tool, parentId, parent, viewport, ink,
        points: [pressurePoint(toLocal(parent, world), event.nativeEvent)] };
      event.preventDefault();
      surface.focus({ preventScroll: true });
      stroke.current = active;
      track(active, view);
      surface.setPointerCapture?.(event.pointerId);
      setPreview(makePreview(active));
      return true;
    },
  };
}

function pressurePoint(point: Point, event: PointerEvent): DrawingSample {
  return event.pointerType === 'pen' && event.pressure > 0 ? { ...point, pressure: event.pressure } : point;
}
