import { useRef, useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from 'react';
import type Konva from 'konva';
import type { DesignDocument, DesignEdit, DesignLayout, DesignPathAnchor, DesignText, DesignVector } from '../contracts/index.js';
import { defaultDesignCanvasSettings, type DesignCanvasSettings } from './context/design-canvas-settings.js';
import { canContainDesignLayers } from './context/design-layer-commands.js';
import { isFlowChild, movePositions, planDesignCanvasDrop, selectedBranches, snapDesignDelta,
  type DesignCanvasDropPreview, type DesignGuide, type LayerPlacement } from './design-canvas-edits.js';
import {
  boundsBetween, containsBounds, directionOfRotation, intersectBounds, roundDesignValue, toLocal, toLocalVector, toWorld, toWorldVector,
  unionBounds, type Bounds, type Point,
} from './design-geometry.js';
import {
  adjustFrameLayout, frameLayoutGap, hasEditableLayout, layoutHandleAxis, layoutHandleName, layoutHandles, layoutHandleValue, type LayoutHandle,
} from './design-layout-adjustment.js';
import { defaultImageCrop, designImageFit, moveImageCrop } from './design-image-fit.js';
import { findDesignFrameAtPoint } from './design-layer-drop.js';
import type { DesignLayerBox, DesignScene } from './design-layout.js';

export type CanvasViewport = Point & Readonly<{ scale: number }>;
export type DrawingTool = 'frame' | 'rectangle' | 'ellipse' | 'polygon' | 'text';
export type DesignTool = 'select' | 'hand' | 'pen' | DrawingTool;
export type LayerPlacements = Readonly<Record<string, LayerPlacement>>;

type Anchor = Readonly<{ x: number; y: number }>;
export const designAnchors: readonly Anchor[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

type Start = Readonly<{ pointerId: number; revision: string; screen: Point; world: Point; viewport: CanvasViewport }>;
type LayoutGesture = Start & Readonly<{ kind: 'layout'; id: string; handle: LayoutHandle; layout: DesignLayout; value: number; box: DesignLayerBox }>;
type Gesture = Start & (
  | { kind: 'pan' }
  | { kind: 'draw'; tool: DrawingTool; parentId: string | null }
  | { kind: 'marquee'; additive: boolean; clickedId: string | null }
  | { kind: 'move'; id: string; ids: readonly string[]; selection: readonly string[]; additive: boolean; snapBounds?: Bounds; neighbors: readonly Bounds[] }
  | { kind: 'resize'; id: string; anchor: Anchor }
  | { kind: 'rotate'; id: string }
  | { kind: 'crop'; id: string; crop: Point; overhang: Point; box: DesignLayerBox }
) | LayoutGesture;
export type CanvasAction =
  | Readonly<{ kind: 'draw'; tool: DrawingTool; parentId: string | null; bounds: Bounds; click: boolean }>
  | Readonly<{ kind: 'path'; parentId: string | null; anchors: readonly DesignPathAnchor[]; closed: boolean }>
  | Readonly<{ kind: 'edit-path'; id: string; node: DesignVector }>
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
  stage, document, scene, revision, tool, selectedIds, croppingId, layoutAdjustmentId, disabled, viewport, setViewport, onSelect, onEditText, onAction,
  settings = defaultDesignCanvasSettings,
}: Readonly<{
  stage: RefObject<Konva.Stage>;
  document: DesignDocument;
  scene: DesignScene;
  revision: string;
  tool: DesignTool;
  selectedIds: readonly string[];
  croppingId?: string;
  layoutAdjustmentId?: string;
  disabled: boolean;
  viewport: CanvasViewport;
  settings?: DesignCanvasSettings;
  setViewport: Dispatch<SetStateAction<CanvasViewport>>;
  onSelect(ids: readonly string[]): void;
  onEditText(id: string, node: DesignText): void;
  onAction(action: CanvasAction, revision: string): Promise<boolean>;
}>) {
  const gesture = useRef<Gesture>();
  const lastTextClick = useRef<{ id: string; at: number; screen: Point; revision: string }>();
  const finishing = useRef(false);
  const [preview, setPreview] = useState<Preview & { revision: string }>();
  const [panning, setPanning] = useState(false);
  const [space, setSpace] = useState(false);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || finishing.current || gesture.current || (event.button !== 0 && event.button !== 1)) return;
    const screen = pointer(event);
    const world = toCanvasWorld(viewport, screen);
    const start: Start = { pointerId: event.pointerId, revision, screen, world, viewport };
    const hit = stage.current?.getIntersection(screen);
    const hitId = hit?.findAncestor('.design-hit-layer', true)?.id();
    const layerId = hitId && Object.hasOwn(document.nodes, hitId) && scene[hitId]?.visible && !scene[hitId]?.locked ? hitId : null;
    const wantsPan = space || tool === 'hand' || event.button === 1;
    const selected = selectedBranches(selectedIds, scene);
    const primary = selected.length === 1 ? selected[0] : null;
    const isFrameInterior = hit?.hasName('design-frame-interior') && (layerId !== primary || event.shiftKey);
    const anchorIndex = designAnchors.findIndex((_, index) => hit?.hasName(`design-anchor-${index}`));
    const layoutGesture = layoutAdjustmentId && layoutAdjustmentId === primary && tool === 'select' && !wantsPan
      ? startLayoutGesture(layoutAdjustmentId, canvasLayoutHandle(hit), start) : undefined;

    if (wantsPan) {
      gesture.current = { ...start, kind: 'pan' };
      event.currentTarget.style.cursor = '';
      setPanning(true);
    } else if (tool === 'pen') {
      return;
    } else if (tool !== 'select') {
      let parentId = layerId;
      while (parentId && !canContainDesignLayers(document.nodes[parentId])) parentId = scene[parentId].parentId;
      gesture.current = { ...start, kind: 'draw', tool, parentId: parentId ?? findDesignFrameAtPoint(document, scene, world) };
    } else if (layoutGesture) {
      gesture.current = layoutGesture;
      event.currentTarget.style.cursor = layoutCursor(layoutGesture.layout, layoutGesture.handle, layoutGesture.box);
    } else if (primary && croppingId === primary && layerId === primary) {
      const node = document.nodes[primary];
      const box = scene[primary];
      const image: unknown = hit?.hasName('design-image-pixels') ? hit.getAttr('image') : undefined;
      if (node.kind !== 'image' || !(image instanceof HTMLImageElement) || !image.naturalWidth || !image.naturalHeight) return;
      const { overhang } = designImageFit(node, box.width, box.height, image.naturalWidth, image.naturalHeight);
      if (!overhang || Math.max(overhang.x, overhang.y) <= 0.01) return;
      gesture.current = { ...start, kind: 'crop', id: primary, box, overhang, crop: node.crop ?? defaultImageCrop };
      event.currentTarget.style.cursor = 'grabbing';
    } else if (primary && hit?.hasName('design-rotate')) {
      gesture.current = { ...start, kind: 'rotate', id: primary };
    } else if (primary && anchorIndex >= 0) {
      gesture.current = { ...start, kind: 'resize', id: primary, anchor: designAnchors[anchorIndex] };
    } else if (!layerId || isFrameInterior) {
      gesture.current = { ...start, kind: 'marquee', additive: event.shiftKey, clickedId: layerId };
    } else {
      const selection = selectedIds.includes(layerId) ? selectedIds : event.shiftKey ? [...selectedIds, layerId] : [layerId];
      const branches = selectedBranches(selection, scene);
      const ids = branches.filter((id) => !scene[id].locked);
      const hasFlow = ids.some((id) => isFlowChild(document, scene, id));
      const sharedParent = ids.every((id) => scene[id].parentId === scene[layerId].parentId);
      const range: Bounds = { ...toCanvasWorld(viewport, { x: -24, y: -24 }),
        width: (event.currentTarget.clientWidth + 48) / viewport.scale, height: (event.currentTarget.clientHeight + 48) / viewport.scale };
      const snapBounds = !hasFlow ? unionBounds(ids.map((id) => scene[id].paintBounds)) : undefined;
      const parentId = scene[layerId].parentId;
      const parent = parentId ? document.nodes[parentId] : undefined;
      const siblings = parent?.kind === 'frame' ? parent.childIds : document.rootIds;
      const neighbors = snapBounds && sharedParent && settings.snapToObjects ? siblings
        .filter((id) => !ids.includes(id) && scene[id].visible && intersectBounds(range, scene[id].paintBounds))
        .map((id) => scene[id].paintBounds) : [];
      gesture.current = { ...start, kind: 'move', id: layerId, ids: hasFlow && ids.length > 1 ? [] : ids,
        selection, additive: event.shiftKey, snapBounds, neighbors };
    }
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startLayoutGesture(id: string, handle: LayoutHandle | undefined, start: Start): LayoutGesture | undefined {
    const frame = document.nodes[id];
    const box = scene[id];
    if (!handle || !hasEditableLayout(frame) || !box.visible || box.locked) return;
    const { layout } = frame;
    const value = handle === 'gap' ? frameLayoutGap(document, scene, frame, layout)?.value : layoutHandleValue(layout, handle);
    if (value === undefined) return;
    return { ...start, kind: 'layout', id, handle, layout, value, box };
  }

  function calculate(active: Gesture, event: PointerEvent<HTMLDivElement>): Preview | undefined {
    const screen = pointer(event);
    const world = toCanvasWorld(active.viewport, screen);
    const delta = { x: world.x - active.world.x, y: world.y - active.world.y };
    if (active.kind === 'pan') {
      setViewport({ ...active.viewport, x: active.viewport.x + screen.x - active.screen.x, y: active.viewport.y + screen.y - active.screen.y });
      return;
    }
    const click = Math.hypot(screen.x - active.screen.x, screen.y - active.screen.y) < 4;
    if (active.kind === 'draw') {
      const parent = active.parentId === null ? undefined : scene[active.parentId];
      const snap = settings.snapToPixelGrid && !event.altKey;
      const start = toLocal(parent, snap ? snapDesignPoint(active.world) : active.world);
      const end = toLocal(parent, snap ? snapDesignPoint(world) : world);
      const length = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      const target = event.shiftKey && active.tool !== 'text'
        ? { x: start.x + (end.x < start.x ? -length : length), y: start.y + (end.y < start.y ? -length : length) } : end;
      return { drawing: { kind: 'draw', tool: active.tool, parentId: active.parentId, bounds: boundsBetween(start, target), click } };
    }
    if (click) return;
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
          const drop = planDesignCanvasDrop(document, scene, id, { x: center.x + restricted.x, y: center.y + restricted.y });
          if (drop.order || isFlowChild(document, scene, id)) return { layerDrop: { phase: 'hover', drop } };
        }
      }
      const snapBounds = event.altKey ? undefined : active.snapBounds;
      const snapped = snapBounds && settings.snapToObjects && !event.shiftKey
        ? snapDesignDelta(snapBounds, active.neighbors, restricted, 6 / viewport.scale) : { point: restricted, guides: [] };
      const point = snapBounds && settings.snapToPixelGrid ? {
        x: snapMoveAxis(snapBounds.x, snapped.point.x, snapped.guides.some((guide) => guide.axis === 'x'), event.shiftKey),
        y: snapMoveAxis(snapBounds.y, snapped.point.y, snapped.guides.some((guide) => guide.axis === 'y'), event.shiftKey),
      } : snapped.point;
      return { placements: movePositions(scene, active.ids, point), guides: snapped.guides };
    }

    const box = scene[active.id];
    const parent = box.parentId ? scene[box.parentId] : undefined;
    if (active.kind === 'rotate') {
      const center = toWorld(box, { x: box.width / 2, y: box.height / 2 });
      const dragAngle = Math.atan2(world.y - center.y, world.x - center.x) - Math.atan2(active.world.y - center.y, active.world.x - center.x);
      const degrees = (document.nodes[active.id].rotation ?? 0) + directionOfRotation(parent) * dragAngle * 180 / Math.PI;
      const snap = event.shiftKey ? Math.round(degrees / 15) * 15 : degrees;
      const rotation = roundDesignValue(((snap + 180) % 360 + 360) % 360 - 180);
      return { placements: { [active.id]: { x: box.x, y: box.y, rotation } } };
    }
    const resizeDelta = settings.snapToPixelGrid && !event.altKey && !event.shiftKey
      ? snapResizeDelta(box, active.anchor, delta) : delta;
    const placement = resizeWithAnchor(box, parent, active.anchor, resizeDelta, event.shiftKey);
    return { placements: { [active.id]: isFlowChild(document, scene, active.id) ? { ...placement, x: box.x, y: box.y } : placement } };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active) {
      const hit = tool === 'select' && !space && !disabled ? stage.current?.getIntersection(pointer(event)) : null;
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
    if (active.pointerId !== event.pointerId) return;
    if (!isCurrent(active)) { onPointerCancel(event); return; }
    const next = calculate(active, event);
    if (active.kind === 'move' && (next?.placements || next?.layerDrop) && selectedIds !== active.selection) onSelect(active.selection);
    setPreview((current) => current?.revision === active.revision && next?.layout && current.layout?.value === next.layout.value
      ? current : next && { ...next, revision: active.revision });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = undefined;
    setPanning(false);
    if (!isCurrent(active)) {
      event.currentTarget.style.cursor = '';
      setPreview(undefined);
      return;
    }
    if (active.kind === 'crop') event.currentTarget.style.cursor = 'grab';
    const next = calculate(active, event);
    const action = finish(active, next, event);
    if (!action) { setPreview(undefined); return; }
    finishing.current = true;
    setPreview(action.kind === 'drop'
      ? { layerDrop: { phase: 'saving', id: action.id, edits: action.edits }, revision: active.revision }
      : next && { ...next, revision: active.revision });
    void onAction(action, active.revision).finally(() => {
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
        onSelect(active.additive ? [...new Set([...selectedIds, ...matching])] : matching);
      } else if (active.additive && active.clickedId) {
        onSelect(toggleSelection(selectedIds, active.clickedId));
      } else if (!active.additive) onSelect(matching);
    }
    if (active.kind === 'move') {
      if (next?.layerDrop?.phase === 'hover') {
        const { id, edits } = next.layerDrop.drop;
        onSelect(active.selection);
        return edits.length ? { kind: 'drop', id, edits } : undefined;
      }
      if (next?.placements) {
        onSelect(active.selection);
        return { kind: 'move', placements: next.placements };
      }
      onSelect(active.additive ? toggleSelection(selectedIds, active.id) : [active.id]);
      const node = document.nodes[active.id];
      const screen = pointer(event);
      if (node.kind === 'text' && !active.additive && Math.hypot(screen.x - active.screen.x, screen.y - active.screen.y) < 4) {
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
    return next?.drawing;
  }

  function isCurrent(active: Gesture) {
    if (active.kind === 'pan') return true;
    if (active.revision !== revision) return false;
    if (active.kind !== 'layout' && active.kind !== 'crop') return true;
    return !disabled && tool === 'select' && selectedIds.length === 1 && selectedIds[0] === active.id
      && active.id === (active.kind === 'crop' ? croppingId : layoutAdjustmentId);
  }

  function cancel() {
    if (!gesture.current) return;
    gesture.current = undefined;
    lastTextClick.current = undefined;
    setPanning(false);
    setPreview(undefined);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
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

export function toCanvasScreen(surface: HTMLDivElement, point: Point): Point {
  const { left, top, width, height } = surface.getBoundingClientRect();
  return {
    x: (point.x - left) * (width ? surface.clientWidth / width : 1),
    y: (point.y - top) * (height ? surface.clientHeight / height : 1),
  };
}

export function toCanvasWorld(viewport: CanvasViewport, point: Point): Point {
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale };
}

function snapDesignPoint({ x, y }: Point): Point {
  return { x: Math.round(x), y: Math.round(y) };
}

function snapMoveAxis(origin: number, delta: number, guided: boolean, constrained: boolean): number {
  return guided || (constrained && !delta) ? delta : Math.round(origin + delta) - origin;
}

function snapResizeDelta(box: DesignLayerBox, anchor: Anchor, delta: Point): Point {
  const edge = toWorld(box, { x: (anchor.x + 1) * box.width / 2, y: (anchor.y + 1) * box.height / 2 });
  const target = snapDesignPoint({ x: edge.x + delta.x, y: edge.y + delta.y });
  return { x: target.x - edge.x, y: target.y - edge.y };
}

export function toggleSelection(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function resizeWithAnchor(box: DesignLayerBox, parent: DesignLayerBox | undefined, anchor: Anchor, delta: Point, lockRatio: boolean): LayerPlacement {
  const local = toLocalVector(box, delta);
  let width = anchor.x ? Math.max(1, roundDesignValue(box.width + local.x * anchor.x)) : box.width;
  let height = anchor.y ? Math.max(1, roundDesignValue(box.height + local.y * anchor.y)) : box.height;
  if (lockRatio && anchor.x && anchor.y && box.width > 0 && box.height > 0) {
    const scaleX = width / box.width;
    const scaleY = height / box.height;
    const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    width = roundDesignValue(box.width * scale);
    height = roundDesignValue(box.height * scale);
  }
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
