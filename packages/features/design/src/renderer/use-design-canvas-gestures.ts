import { useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from 'react';
import type Konva from 'konva';
import type { DesignDocument, DesignEdit, DesignLayout, DesignNode, DesignPathAnchor, DesignText, DesignVector, DesignVectorGeometry } from '../contracts/index.js';
import { isFreehandTool, type FreehandTool } from './canvas/design-drawing.js';
import { trackDesignDrawingPointer } from './canvas/design-drawing-pointer.js';
import { designDrawnVector, isSegmentDrawingTool, type VectorDrawingTool } from './canvas/design-shape-drawing.js';
import { applyDesignSnap, designDrawingBounds, designSnapGuides, designSnapTargets, resizeSnapAnchors, snapDesignBounds,
  type DesignGuide, type DesignSnapTargets } from './canvas/design-snapping.js';
import { defaultDesignCanvasSettings, type DesignCanvasSettings } from './context/design-canvas-settings.js';
import { constrainDesignWidth, isFlowChild, movePositions, planDesignCanvasDrop, selectedBranches,
  type DesignCanvasDropPreview, type LayerPlacement } from './design-canvas-edits.js';
import {
  boundsBetween, containsBounds, directionOfRotation, layerOutline, layerTransform, roundDesignValue, toLocal, toLocalVector, toWorld, toWorldVector,
  unionBounds, type Bounds, type Point,
} from './design-geometry.js';
import {
  adjustFrameLayout, frameLayoutGap, hasEditableLayout, layoutHandleAxis, layoutHandleName, layoutHandles, layoutHandleValue, type LayoutHandle,
} from './design-layout-adjustment.js';
import { defaultImageCrop, designImageFit, moveImageCrop } from './design-image-fit.js';
import { findDesignFrameAtPoint } from './design-layer-drop.js';
import type { DesignLayerBox, DesignScene } from './design-layout.js';

export type CanvasInteraction = 'edit' | 'navigate' | 'disabled';
export type CanvasViewport = Point & Readonly<{ scale: number }>;
export type DrawingTool = 'frame' | 'rectangle' | 'ellipse' | 'text' | 'web' | 'script' | VectorDrawingTool;
export type DesignTool = 'select' | 'hand' | 'pen' | FreehandTool | DrawingTool;
export type LayerPlacements = Readonly<Record<string, LayerPlacement>>;

type Anchor = Readonly<{ x: number; y: number }>;
export const designAnchors: readonly Anchor[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

export type BeginCanvasPick = (additive: boolean) => ((ids: readonly string[]) => void) | undefined;
type Start = Readonly<{ pick?: ReturnType<BeginCanvasPick>; pointerId: number; revision: string; screen: Point; world: Point; viewport: CanvasViewport }>;
type LayoutGesture = Start & Readonly<{ kind: 'layout'; id: string; handle: LayoutHandle; layout: DesignLayout; value: number; box: DesignLayerBox }>;
type MoveSnap = Readonly<{ outline: Bounds; targets: DesignSnapTargets }>;
type ResizeSnap = Readonly<{ anchors: ReturnType<typeof resizeSnapAnchors>; targets: DesignSnapTargets }>;
type ResizeGesture = Start & Readonly<{ kind: 'resize'; id: string; anchor: Anchor; snap?: ResizeSnap }>;
type DrawGesture = Start & Readonly<{ kind: 'draw'; tool: DrawingTool; parentId: string | null; snap?: DesignSnapTargets; events: AbortController }>;
type Gesture = Start & (
  | { kind: 'pan' }
  | { kind: 'marquee'; additive: boolean; clickedId: string | null }
  | { kind: 'move'; id: string; ids: readonly string[]; selection: readonly string[]; additive: boolean; fromHandle: boolean; snapBounds?: Bounds; snap?: MoveSnap }
  | { kind: 'rotate'; id: string }
  | { kind: 'crop'; id: string; crop: Point; overhang: Point; box: DesignLayerBox }
) | LayoutGesture | ResizeGesture;
export type CanvasAction =
  | Readonly<{ kind: 'draw'; tool: DrawingTool; parentId: string | null; bounds: Bounds; click: boolean; geometry?: DesignVectorGeometry }>
  | Readonly<{ kind: 'path'; parentId: string | null; anchors: readonly DesignPathAnchor[]; closed: boolean }>
  | Readonly<{ kind: 'edit-path'; id: string; node: DesignVector }>
  | Readonly<{ kind: 'gradient'; id: string; node: DesignNode }>
  | Readonly<{ kind: 'move'; placements: LayerPlacements }>
  | Readonly<{ kind: 'drop'; id: string; edits: readonly DesignEdit[] }>
  | Readonly<{ kind: 'transform'; id: string; placement: LayerPlacement }>
  | Readonly<{ kind: 'layout'; id: string; layout: DesignLayout }>
  | Readonly<{ kind: 'crop'; id: string; crop: Point }>;
export type CanvasLayoutPreview = Readonly<{ id: string; handle: LayoutHandle; layout: DesignLayout; value: number }>;
type Preview = Readonly<{
  placements?: LayerPlacements;
  guides?: readonly DesignGuide[];
  marquee?: Bounds;
  drawing?: Extract<CanvasAction, { kind: 'draw' }>;
  layerDrop?: DesignCanvasDropPreview;
  layout?: CanvasLayoutPreview;
  crop?: Readonly<{ id: string; value: Point }>;
}>;

export function useDesignCanvasGestures({
  stage, document, projected = document, scene, revision, tool, selectedIds, croppingId, layoutAdjustmentId, interaction, viewport, setViewport, onSelect, beginPick, onEditText, onAction,
  settings = defaultDesignCanvasSettings,
}: Readonly<{
  stage: RefObject<Konva.Stage>;
  document: DesignDocument;
  projected?: DesignDocument;
  scene: DesignScene;
  revision: string;
  tool: DesignTool;
  selectedIds: readonly string[];
  croppingId?: string;
  layoutAdjustmentId?: string;
  interaction: CanvasInteraction;
  viewport: CanvasViewport;
  settings?: DesignCanvasSettings;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;
  beginPick?: BeginCanvasPick;
  onSelect(ids: readonly string[]): void;
  onEditText(id: string, node: DesignText): void;
  onAction(action: CanvasAction, revision: string): Promise<boolean>;
}>) {
  const gesture = useRef<Gesture | DrawGesture>();
  const drawingHandlers = useRef({ calculateDrawing, commit });
  const lastTextClick = useRef<{ id: string; at: number; screen: Point; revision: string }>();
  const finishing = useRef(false);
  const [preview, setPreview] = useState<Preview & { revision: string }>();
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);
  useLayoutEffect(() => {
    drawingHandlers.current = { calculateDrawing, commit };
    const active = gesture.current;
    if (active && !isCurrent(active)) cancel();
  });
  useLayoutEffect(() => () => {
    const active = gesture.current;
    if (active?.kind === 'draw') {
      active.events.abort();
      gesture.current = undefined;
    }
  }, []);

  function onPointerDown(event: PointerEvent<HTMLElement>, handle?: Readonly<{ id: string; surface: HTMLDivElement }>) {
    if (interaction === 'disabled' || finishing.current || gesture.current || (event.button !== 0 && event.button !== 1)) return;
    const surface = handle?.surface ?? event.currentTarget;
    const wantsPan = space || tool === 'hand' || event.button === 1;
    if (interaction === 'navigate' && !wantsPan && tool !== 'select') {
      surface.focus({ preventScroll: true });
      return;
    }
    const screen = toCanvasScreen(surface, { x: event.clientX, y: event.clientY });
    const world = toCanvasWorld(viewport, screen);
    // Capture the draft caret before focusing the canvas. Only a completed pick consumes it.
    const pick = !handle && !wantsPan && tool === 'select' ? beginPick?.(event.shiftKey) : undefined;
    const start: Start = { pointerId: event.pointerId, revision, screen, world, viewport, pick };
    const hit = handle ? undefined : stage.current?.getIntersection(screen);
    const hitId = handle?.id ?? hit?.findAncestor('.design-hit-layer', true)?.id();
    const layerId = hitId && Object.hasOwn(document.nodes, hitId) && scene[hitId]?.visible && !scene[hitId]?.locked ? hitId : null;
    if (handle && (wantsPan || tool !== 'select' || layerId === null)) return;
    const selected = selectedBranches(selectedIds, scene);
    const primary = selected.length === 1 ? selected[0] : null;
    const isFrameInterior = hit?.hasName('design-frame-interior') && (layerId !== primary || event.shiftKey);
    const anchorIndex = designAnchors.findIndex((_, index) => hit?.hasName(`design-anchor-${index}`));
    const layoutGesture = layoutAdjustmentId && layoutAdjustmentId === primary && tool === 'select' && !wantsPan
      ? startLayoutGesture(layoutAdjustmentId, canvasLayoutHandle(hit), start) : undefined;

    if (wantsPan) {
      gesture.current = { ...start, kind: 'pan' };
      surface.style.cursor = '';
      setPanning(true);
    } else if (interaction === 'navigate') {
      gesture.current = { ...start, kind: 'marquee', additive: event.shiftKey, clickedId: layerId };
    } else if (tool === 'pen' || isFreehandTool(tool)) {
      return;
    } else if (tool !== 'select') {
      const parentId = findDesignFrameAtPoint(projected, scene, world);
      const snap = tool !== 'text' && settings.snapToObjects
        ? designSnapTargets(projected, scene, parentId, [], designCanvasSnapRange(surface, viewport)) : undefined;
      gesture.current = { ...start, kind: 'draw', tool, parentId, snap, events: new AbortController() };
    } else if (layoutGesture) {
      gesture.current = layoutGesture;
      surface.style.cursor = layoutCursor(layoutGesture.layout, layoutGesture.handle, layoutGesture.box);
    } else if (primary && croppingId === primary && layerId === primary) {
      const node = projected.nodes[primary];
      const box = scene[primary];
      const image: unknown = hit?.hasName('design-image-pixels') ? hit.getAttr('image') : undefined;
      if (node.kind !== 'image' || !(image instanceof HTMLImageElement) || !image.naturalWidth || !image.naturalHeight) return;
      const { overhang } = designImageFit(node, box.width, box.height, image.naturalWidth, image.naturalHeight);
      if (!overhang || Math.max(overhang.x, overhang.y) <= 0.01) return;
      gesture.current = { ...start, kind: 'crop', id: primary, box, overhang, crop: node.crop ?? defaultImageCrop };
      surface.style.cursor = 'grabbing';
    } else if (primary && hit?.hasName('design-rotate')) {
      gesture.current = { ...start, kind: 'rotate', id: primary };
    } else if (primary && anchorIndex >= 0) {
      const anchor = designAnchors[anchorIndex];
      const box = scene[primary];
      const orientation = layerTransform(box, projected.nodes[primary]);
      const quarterTurns = orientation.angle / 90;
      const parallel = Math.abs(quarterTurns - Math.round(quarterTurns)) < 1e-9;
      const snap = settings.snapToObjects && parallel && !isFlowChild(projected, scene, primary) ? {
        anchors: resizeSnapAnchors(toWorldVector(orientation, anchor)),
          targets: designSnapTargets(projected, scene, box.parentId, [primary], designCanvasSnapRange(surface, viewport)),
      } : undefined;
      gesture.current = { ...start, kind: 'resize', id: primary, anchor, snap };
    } else if (!layerId || isFrameInterior) {
      gesture.current = { ...start, kind: 'marquee', additive: event.shiftKey, clickedId: layerId };
    } else {
      const keepSelection = selectedIds.includes(layerId) && (!handle || selectedIds.length === 1);
      const selection = keepSelection ? selectedIds : !handle && event.shiftKey ? [...selectedIds, layerId] : [layerId];
      const branches = selectedBranches(selection, scene);
      const ids = branches.filter((id) => !scene[id].locked);
      const hasFlow = ids.some((id) => isFlowChild(projected, scene, id));
      const parentId = scene[layerId].parentId;
      const sharedParent = ids.every((id) => scene[id].parentId === parentId);
      const snapBounds = !hasFlow ? unionBounds(ids.map((id) => scene[id].paintBounds)) : undefined;
      const outline = snapBounds && sharedParent && settings.snapToObjects
        ? parentId === null ? snapBounds : unionBounds(ids.map((id) => layerOutline(scene[id], projected.nodes[id]))) : undefined;
      const snap = outline ? { outline, targets: designSnapTargets(projected, scene, parentId, ids, designCanvasSnapRange(surface, viewport)) } : undefined;
      gesture.current = { ...start, kind: 'move', id: layerId, ids: hasFlow && ids.length > 1 ? [] : ids,
        selection, additive: event.shiftKey, fromHandle: Boolean(handle), snapBounds, snap };
      if (handle) {
        if (selection !== selectedIds) onSelect(selection);
        surface.style.cursor = 'grabbing';
      }
    }
    event.preventDefault();
    surface.focus({ preventScroll: true });
    const active = gesture.current;
    if (active?.kind === 'draw') trackDrawing(active, surface, event);
    surface.setPointerCapture(event.pointerId);
  }

  function trackDrawing(active: DrawGesture, surface: HTMLElement, event: PointerEvent<HTMLElement>) {
    const view = surface.ownerDocument.defaultView;
    if (!view) { cancel(); return; }
    const start = event.nativeEvent;
    let last: Preview | undefined;
    const sample = (input: typeof start) => drawingHandlers.current.calculateDrawing(active,
      toCanvasScreen(surface, { x: input.clientX, y: input.clientY }), input);
    trackDesignDrawingPointer(view, active.pointerId, active.events.signal, {
      move(input) {
        last = sample(input);
        setPreview(last && { ...last, revision: active.revision });
      },
      finish(release) {
        active.events.abort();
        gesture.current = undefined;
        lastTextClick.current = undefined;
        const next = release ? sample(release) : last ?? sample(start);
        drawingHandlers.current.commit(next?.drawing, next, active.revision);
      },
      cancel,
    });
  }

  function startLayoutGesture(id: string, handle: LayoutHandle | undefined, start: Start): LayoutGesture | undefined {
    const frame = document.nodes[id];
    const effective = projected.nodes[id];
    const box = scene[id];
    if (!handle || !hasEditableLayout(frame) || !hasEditableLayout(effective) || !box.visible || box.locked) return;
    const { layout } = effective;
    const value = handle === 'gap' ? frameLayoutGap(projected, scene, effective, layout)?.value : layoutHandleValue(layout, handle);
    if (value === undefined) return;
    return { ...start, kind: 'layout', id, handle, layout: frame.layout, value, box };
  }

  function calculateDrawing(active: DrawGesture, screen: Point, event: Pick<PointerEvent, 'altKey' | 'shiftKey'>): Preview | undefined {
    const world = toCanvasWorld(active.viewport, screen);
    const click = Math.hypot(screen.x - active.screen.x, screen.y - active.screen.y) < 4;
    const parent = active.parentId === null ? undefined : scene[active.parentId];
    const corners = { start: toLocal(parent, active.world), end: toLocal(parent, world) };
    const fallback = settings.snapToPixelGrid && !event.altKey
      ? { start: toLocal(parent, snapDesignPoint(active.world)), end: toLocal(parent, snapDesignPoint(world)) } : corners;
    const targets = !click && !event.altKey && settings.snapToObjects ? active.snap : undefined;
    const segment = isSegmentDrawingTool(active.tool);
    const { guides, ...snapped } = designDrawingBounds(corners, fallback, { segment, constrain: event.shiftKey && active.tool !== 'text' },
      targets, active.viewport.scale);
    const vector = designDrawnVector(active.tool, snapped, click);
    if (segment && !vector) return;
    const placement = vector ?? { bounds: snapped.bounds };
    return { drawing: { kind: 'draw', tool: active.tool, parentId: active.parentId, click, ...placement }, guides };
  }

  function calculate(active: Gesture, event: PointerEvent<HTMLDivElement>): Preview | undefined {
    const screen = pointer(event);
    const world = toCanvasWorld(active.viewport, screen);
    const delta = { x: world.x - active.world.x, y: world.y - active.world.y };
    if (active.kind === 'pan') {
      setViewport({ ...active.viewport, x: active.viewport.x + screen.x - active.screen.x, y: active.viewport.y + screen.y - active.screen.y });
      return;
    }
    if (Math.hypot(screen.x - active.screen.x, screen.y - active.screen.y) < 4) return;
    if (active.kind === 'crop') {
      const value = moveImageCrop(active.crop, active.overhang, toLocalVector(active.box, delta));
      return value.x !== active.crop.x || value.y !== active.crop.y ? { crop: { id: active.id, value } } : undefined;
    }
    if (active.kind === 'layout') {
      const change = adjustFrameLayout(active.layout, active.handle, active.value, toLocalVector(active.box, delta),
        settings.snapToPixelGrid && !event.altKey);
      return change ? { layout: { ...change, id: active.id, handle: active.handle } } : undefined;
    }
    if (active.kind === 'marquee') return { marquee: boundsBetween(active.world, world) };
    if (active.kind === 'move') {
      if (!active.ids.length) return;
      const restricted = event.shiftKey
        ? Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y } : delta;
      if (active.ids.length === 1) {
        const [id] = active.ids;
        const node = document.nodes[id];
        const box = scene[id];
        // A top-level artboard can overlap other boards while being arranged on the canvas.
        if (box.parentId !== null || node.kind !== 'frame' || node.group || node.instanceOf) {
          const center = toWorld(box, { x: box.width / 2, y: box.height / 2 });
          const drop = planDesignCanvasDrop(document, scene, id, { x: center.x + restricted.x, y: center.y + restricted.y }, projected);
          if (drop.order || isFlowChild(projected, scene, id)) return { layerDrop: { phase: 'hover', drop } };
        }
      }
      const snapBounds = event.altKey ? undefined : active.snapBounds;
      const grid = snapBounds && settings.snapToPixelGrid ? {
        x: snapMoveAxis(snapBounds.x, restricted.x, event.shiftKey),
        y: snapMoveAxis(snapBounds.y, restricted.y, event.shiftKey),
      } : restricted;
      if (!active.snap || !settings.snapToObjects || event.altKey || event.shiftKey) return { placements: movePositions(scene, active.ids, grid) };
      const { outline, targets } = active.snap;
      const local = toLocalVector(targets.pose, restricted);
      const matches = snapDesignBounds(translateBounds(outline, local), targets, active.viewport.scale);
      if (!matches.x && !matches.y) return { placements: movePositions(scene, active.ids, grid) };
      const point = applyDesignSnap(local, toLocalVector(targets.pose, grid), matches);
      return { placements: movePositions(scene, active.ids, toWorldVector(targets.pose, point)),
        guides: designSnapGuides(translateBounds(outline, point), matches, targets.pose) };
    }

    const box = scene[active.id];
    const parent = box.parentId ? scene[box.parentId] : undefined;
    if (active.kind === 'rotate') {
      const center = toWorld(box, { x: box.width / 2, y: box.height / 2 });
      const dragAngle = Math.atan2(world.y - center.y, world.x - center.x) - Math.atan2(active.world.y - center.y, active.world.x - center.x);
      const degrees = (projected.nodes[active.id].rotation ?? 0) + directionOfRotation(parent) * dragAngle * 180 / Math.PI;
      const snap = event.shiftKey ? Math.round(degrees / 15) * 15 : degrees;
      const rotation = roundDesignValue(((snap + 180) % 360 + 360) % 360 - 180);
      return { placements: { [active.id]: { x: box.x, y: box.y, rotation } } };
    }
    return resize(active, box, parent, delta, event);
  }

  function resize(active: ResizeGesture, box: DesignLayerBox, parent: DesignLayerBox | undefined, delta: Point, event: PointerEvent<HTMLDivElement>): Preview {
    const { id, anchor, snap } = active;
    const node = projected.nodes[id];
    const canSnap = !event.altKey && !event.shiftKey;
    const grid = canSnap && settings.snapToPixelGrid ? snapResizeDelta(box, anchor, delta) : delta;
    const place = (movement: Point) => resizeWithAnchor(node, box, parent, anchor, movement, event.shiftKey);
    if (!snap || !canSnap || !settings.snapToObjects) {
      const placement = place(grid);
      return { placements: { [id]: isFlowChild(projected, scene, id) ? { ...placement, x: box.x, y: box.y } : placement } };
    }
    const local = toLocalVector(parent, delta);
    const orientation = projected.nodes[id];
    const raw = place(delta);
    const matches = snapDesignBounds(layerOutline(raw, orientation), snap.targets, active.viewport.scale, snap.anchors);
    if (!matches.x && !matches.y) return { placements: { [id]: grid === delta ? raw : place(grid) } };
    const point = applyDesignSnap(local, toLocalVector(parent, grid), matches);
    const placement = place(toWorldVector(parent, point));
    return { placements: { [id]: placement }, guides: designSnapGuides(layerOutline(placement, orientation), matches, parent) };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active) {
      const hit = tool === 'select' && !space && interaction === 'edit' ? stage.current?.getIntersection(pointer(event)) : null;
      const index = designAnchors.findIndex((_, index) => hit?.hasName(`design-anchor-${index}`));
      const anchor = designAnchors[index];
      const pose = selectedIds.length === 1 ? scene[selectedIds[0]] : undefined;
      const handle = layoutAdjustmentId ? canvasLayoutHandle(hit) : undefined;
      const frame = handle && layoutAdjustmentId ? document.nodes[layoutAdjustmentId] : undefined;
      if (handle && pose && hasEditableLayout(frame)) {
        event.currentTarget.style.cursor = layoutCursor(frame.layout, handle, pose);
        return;
      }
      if (croppingId && hit?.hasName('design-image-pixels') && hit.findAncestor('.design-hit-layer', true)?.id() === croppingId) {
        event.currentTarget.style.cursor = 'grab';
      } else event.currentTarget.style.cursor = anchor ? resizeCursor(toWorldVector(pose, anchor)) : hit?.hasName('design-rotate') ? 'crosshair' : '';
      return;
    }
    if (active.kind === 'draw' || active.pointerId !== event.pointerId) return;
    if (!isCurrent(active)) { onPointerCancel(event); return; }
    const next = calculate(active, event);
    if (active.kind === 'move' && !active.fromHandle && (next?.placements || next?.layerDrop) && selectedIds !== active.selection) onSelect(active.selection);
    setPreview((current) => current?.revision === active.revision && next?.layout && current.layout?.value === next.layout.value
      ? current : next && { ...next, revision: active.revision });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.kind === 'draw' || active.pointerId !== event.pointerId) return;
    gesture.current = undefined;
    setPanning(false);
    if (!isCurrent(active)) {
      event.currentTarget.style.cursor = '';
      setPreview(undefined);
      return;
    }
    if (active.kind === 'crop') event.currentTarget.style.cursor = 'grab';
    if (active.kind === 'move' && active.fromHandle) event.currentTarget.style.cursor = '';
    const next = calculate(active, event);
    commit(finish(active, next, event), next, active.revision);
  }

  function commit(action: CanvasAction | undefined, next: Preview | undefined, base: string) {
    if (!action) { setPreview(undefined); return; }
    finishing.current = true;
    setPreview(action.kind === 'drop'
      ? { layerDrop: { phase: 'saving', id: action.id, edits: action.edits }, revision: base }
      : next && { ...next, revision: base });
    void onAction(action, base).finally(() => {
      finishing.current = false;
      setPreview(undefined);
    });
  }

  function finish(active: Gesture, next: Preview | undefined, event: PointerEvent<HTMLDivElement>): CanvasAction | undefined {
    const lastClick = lastTextClick.current;
    lastTextClick.current = undefined;
    if (active.kind === 'layout') return next?.layout ? { kind: 'layout', id: active.id, layout: next.layout.layout } : undefined;
    if (active.kind === 'crop') return next?.crop ? { kind: 'crop', id: active.id, crop: next.crop.value } : undefined;
    if (active.kind === 'marquee') {
      let matching = active.clickedId ? [active.clickedId] : [];
      if (next?.marquee) {
        const area = next.marquee;
        matching = selectedBranches(Object.keys(document.nodes).filter((id) => {
          const box = scene[id];
          return box.visible && !box.locked && box.visibleBounds && containsBounds(area, box.visibleBounds);
        }), scene);
        const selection = active.additive ? [...new Set([...selectedIds, ...matching])] : matching;
        onSelect(selection);
        active.pick?.(selection);
      } else if (active.additive && active.clickedId) {
        const selection = toggleSelection(selectedIds, active.clickedId);
        onSelect(selection);
        active.pick?.(selection);
      } else if (!active.additive) {
        onSelect(matching);
        if (matching.length || selectedIds.length) active.pick?.(matching);
      }
    }
    if (active.kind === 'move') {
      if (next?.layerDrop?.phase === 'hover') {
        const { id, edits } = next.layerDrop.drop;
        if (!active.fromHandle) onSelect(active.selection);
        return edits.length ? { kind: 'drop', id, edits } : undefined;
      }
      if (next?.placements) {
        if (!active.fromHandle) onSelect(active.selection);
        return { kind: 'move', placements: next.placements };
      }
      if (active.fromHandle) return;
      const selection = active.additive ? toggleSelection(selectedIds, active.id) : [active.id];
      onSelect(selection);
      const screen = pointer(event);
      if (Math.hypot(screen.x - active.screen.x, screen.y - active.screen.y) >= 4) return;
      active.pick?.(selection);
      const node = document.nodes[active.id];
      if (node.kind === 'text' && !active.additive) {
        const at = event.timeStamp;
        // Pointer capture routes release to the canvas surface, so detect the second click here.
        if (lastClick?.id === active.id && lastClick.revision === revision && at - lastClick.at < 460
          && Math.hypot(screen.x - lastClick.screen.x, screen.y - lastClick.screen.y) < 6) onEditText(active.id, node);
        else lastTextClick.current = { id: active.id, at, screen, revision };
      }
    }
    if (active.kind === 'resize' || active.kind === 'rotate') {
      const placement = next?.placements?.[active.id];
      if (placement) return { kind: 'transform', id: active.id, placement };
    }
  }

  function isCurrent(active: Gesture | DrawGesture) {
    if (interaction === 'disabled') return false;
    // Panning changes only the viewport and can continue across an AI commit.
    if (active.kind === 'pan') return true;
    if (active.revision !== revision || (interaction === 'navigate' && active.kind !== 'marquee')) return false;
    if (active.kind === 'draw') return active.tool === tool;
    if (active.kind !== 'layout' && active.kind !== 'crop') return true;
    return tool === 'select' && selectedIds.length === 1 && selectedIds[0] === active.id
      && active.id === (active.kind === 'crop' ? croppingId : layoutAdjustmentId);
  }

  function cancel() {
    const active = gesture.current;
    if (!active) return;
    if (active.kind === 'draw') active.events.abort();
    gesture.current = undefined;
    lastTextClick.current = undefined;
    setPanning(false);
    setPreview(undefined);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.kind === 'draw' || active.pointerId !== event.pointerId) return;
    event.currentTarget.style.cursor = '';
    cancel();
  }

  return { preview: preview?.revision === revision ? preview : undefined,
    space, setSpace, panning, cancel, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
    isAdjustingProperties: () => {
      const kind = gesture.current?.kind;
      return kind === 'layout' || kind === 'crop' || kind === 'move' || kind === 'resize' || kind === 'rotate';
    },
    isActive: () => Boolean(gesture.current) || finishing.current };
}

export function canvasLayoutHandle(hit: Pick<Konva.Node, 'hasName'> | null | undefined) {
  return hit ? layoutHandles.find((handle) => hit.hasName(layoutHandleName(handle))) : undefined;
}

function layoutCursor(layout: DesignLayout, handle: LayoutHandle, box: DesignLayerBox) {
  const direction = layoutHandleAxis(layout, handle) === 'x' ? { x: 1, y: 0 } : { x: 0, y: 1 };
  return resizeCursor(toWorldVector(box, direction));
}

function pointer(event: PointerEvent<HTMLDivElement>): Point {
  return toCanvasScreen(event.currentTarget, { x: event.clientX, y: event.clientY });
}

export function toCanvasScreen(surface: HTMLElement, point: Point): Point {
  const { left, top, width, height } = surface.getBoundingClientRect();
  return {
    x: (point.x - left) * (width ? surface.clientWidth / width : 1),
    y: (point.y - top) * (height ? surface.clientHeight / height : 1),
  };
}

export function toCanvasWorld(viewport: CanvasViewport, point: Point): Point {
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale };
}

export function snapDesignPoint({ x, y }: Point): Point {
  return { x: Math.round(x), y: Math.round(y) };
}

export function designCanvasSnapRange(surface: HTMLElement, viewport: CanvasViewport): Bounds {
  return { ...toCanvasWorld(viewport, { x: -24, y: -24 }),
    width: (surface.clientWidth + 48) / viewport.scale, height: (surface.clientHeight + 48) / viewport.scale };
}

function translateBounds(bounds: Bounds, point: Point): Bounds {
  return { ...bounds, x: bounds.x + point.x, y: bounds.y + point.y };
}

function snapMoveAxis(origin: number, delta: number, constrained: boolean): number {
  return constrained && !delta ? delta : Math.round(origin + delta) - origin;
}

function snapResizeDelta(box: DesignLayerBox, anchor: Anchor, delta: Point): Point {
  const edge = toWorld(box, { x: (anchor.x + 1) * box.width / 2, y: (anchor.y + 1) * box.height / 2 });
  const target = snapDesignPoint({ x: edge.x + delta.x, y: edge.y + delta.y });
  return { x: target.x - edge.x, y: target.y - edge.y };
}

export function toggleSelection(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function resizeWithAnchor(node: DesignNode, box: DesignLayerBox, parent: DesignLayerBox | undefined, anchor: Anchor, delta: Point, lockRatio: boolean): Bounds {
  const local = toLocalVector(box, delta);
  let width = anchor.x ? Math.max(1, roundDesignValue(box.width + local.x * anchor.x)) : box.width;
  let height = anchor.y ? Math.max(1, roundDesignValue(box.height + local.y * anchor.y)) : box.height;
  if (lockRatio && anchor.x && anchor.y && box.width > 0 && box.height > 0) {
    const scaleX = width / box.width;
    const scaleY = height / box.height;
    const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    width = constrainDesignWidth(node, Math.max(1, roundDesignValue(box.width * scale)));
    height = Math.max(1, roundDesignValue(box.height * width / box.width));
  } else if (anchor.x) width = constrainDesignWidth(node, width);
  const relativeCenter = {
    x: width / 2 + (anchor.x < 0 ? box.width - width : 0),
    y: height / 2 + (anchor.y < 0 ? box.height - height : 0),
  };
  const center = toLocal(parent, toWorld(box, relativeCenter));
  return { x: roundDesignValue(center.x - width / 2), y: roundDesignValue(center.y - height / 2), width, height };
}

function resizeCursor(direction: Point): string {
  const degrees = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
  const index = (Math.round(degrees / 45) % 4 + 4) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][index];
}
