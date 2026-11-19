import { Maximize, Minus, Plus, Scan } from 'lucide-react';
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type MutableRefObject, type PointerEvent, type ReactNode } from 'react';
import type Konva from 'konva';
import { Ellipse, Group, Layer, Line, Path, Rect, Shape, Stage } from 'react-konva';
import type { Yoga } from 'yoga-layout/load';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { Button, IconButton } from '@setsuna-desktop/renderer-ui';
import { defaultDesignPolygonSides, type DesignDocument, type DesignEdit, type DesignNode, type DesignText } from '../contracts/index.js';
import type { DesignCanvasSettings } from './context/design-canvas-settings.js';
import type { DesignLayerMenuTarget } from './context/use-design-layer-actions.js';
import { DesignCanvasLayoutHandles } from './DesignCanvasLayoutHandles.js';
import { DesignCanvasLayers } from './DesignCanvasLayers.js';
import { DesignCanvasSelection, designSelectionColor, DimensionTag, drawingPreview } from './DesignCanvasSelection.js';
import { DesignTools } from './DesignTools.js';
import { projectDesignComponents } from './components/design-components.js';
import type { DesignLibraryResources } from './components/design-library-resources.js';
import { dropDesignLayer, isFlowChild, planDesignLayerUpdate, previewDesignCanvasDrop, selectedBranches, transformDesignLayer } from './design-canvas-edits.js';
import { unionBounds, unreflect, type Bounds, type Point } from './design-geometry.js';
import type { LoadDesignImage } from './design-images.js';
import type { DesignNumberEdit, InspectorCanvasPreview } from './inspector/design-inspector-edit.js';
import type { DesignLayerDrag } from './design-layer-drop.js';
import { designLayoutPreviewScope, resolveDesignScene, type DesignScene } from './design-layout.js';
import type { DesignPaintPreview } from './design-paint.js';
import { measureDesignText } from './design-text.js';
import { canvasLayoutHandle, toCanvasScreen, toCanvasWorld, useDesignCanvasGestures, type CanvasAction, type CanvasViewport, type DesignTool } from './use-design-canvas-gestures.js';
import { useDesignCanvasLayerDrag } from './use-design-canvas-layer-drag.js';
import { DesignPathOverlay } from './vectors/DesignPathOverlay.js';
import { designPolygonPath } from './vectors/design-vector.js';
import { useDesignPathEdit } from './vectors/use-design-path-edit.js';
import { useDesignPen } from './vectors/use-design-pen.js';

export type { CanvasViewport } from './use-design-canvas-gestures.js';

type Size = Readonly<{ width: number; height: number }>;
const fitPadding = 32;
const minScale = 0.02;
const maxScale = 8;
const initialViewport: CanvasViewport = { x: 68, y: 68, scale: 1 };

export type DesignCanvasHandle = Readonly<{
  insertionArea(): Bounds;
  previewPaint(revision: string, nodes: ReadonlyMap<string, DesignNode> | undefined): void;
  previewNumber(nodeId: string, owner: string, edit: DesignNumberEdit | undefined): void;
}>;

type DesignCanvasProps = Readonly<{
  document: DesignDocument;
  projected: DesignDocument;
  resources?: DesignLibraryResources;
  scene: DesignScene;
  layoutEngine: Yoga;
  revision: string;
  layerDrag: MutableRefObject<DesignLayerDrag | undefined>;
  onLayerDrop(id: string, edits: readonly DesignEdit[], revision: string): Promise<boolean>;
  selectedIds: readonly string[];
  croppingId?: string;
  layoutAdjustmentId?: string;
  pathEditingId?: string;
  onExitAdjustment(): void;
  onInspectorPreview(preview: InspectorCanvasPreview | undefined): void;
  editingId: string | null;
  disabled: boolean;
  fitRequest: number;
  loadImage: LoadDesignImage;
  tool: DesignTool;
  settings: DesignCanvasSettings;
  onContextMenu(target: DesignLayerMenuTarget): void;
  onToolChange(tool: DesignTool): void;
  onImage(): void;
  onIcon(): void;
  onSelect(ids: readonly string[]): void;
  onEditText(nodeId: string, node: DesignText): void;
  onAction(action: CanvasAction, expectedRevision: string): Promise<boolean>;
  renderTextInput(viewport: CanvasViewport): ReactNode;
  translate: RendererTranslate;
}>;

export const DesignCanvas = forwardRef<DesignCanvasHandle, DesignCanvasProps>(function DesignCanvas({
  document, projected, resources, scene, layoutEngine, revision, layerDrag, onLayerDrop, selectedIds, croppingId, layoutAdjustmentId, pathEditingId, onExitAdjustment,
  onInspectorPreview, editingId, disabled, fitRequest, loadImage, tool, onToolChange, onImage, onIcon,
  settings, onContextMenu, onSelect, onEditText, onAction, renderTextInput, translate: t,
}, ref) {
  const surface = useRef<HTMLDivElement>(null);
  const workArea = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const size = useCanvasSize(surface);
  const [viewport, setViewport] = useState<CanvasViewport>(initialViewport);
  const [paintPreview, setPaintPreview] = useState<DesignPaintPreview>();
  const [numberDrafts, setNumberDrafts] = useState<ReadonlyMap<string, { nodeId: string; edit: DesignNumberEdit }>>(() => new Map());
  const lastFit = useRef<number>();
  const { scale } = viewport;
  const blocked = disabled || Boolean(editingId);
  const controls = useDesignCanvasGestures({ stage, document, scene, revision, tool, selectedIds, croppingId, layoutAdjustmentId,
    disabled: blocked, viewport, setViewport, onSelect, onEditText, onAction, settings });
  const pen = useDesignPen({ enabled: tool === 'pen', disabled: blocked, document, scene, revision, viewport,
    snapToPixelGrid: settings.snapToPixelGrid, onAction });
  const pathEdit = useDesignPathEdit({ id: pathEditingId, disabled: blocked, document, scene, revision, viewport, onAction });
  const layerDragEvents = useDesignCanvasLayerDrag({ surface, drag: layerDrag, document, scene, revision, viewport,
    disabled: blocked, isGestureActive: () => controls.isActive() || Boolean(pen.preview) || pathEdit.isDragging(), onDrop: onLayerDrop });
  const visibleIds = selectedBranches(selectedIds, scene).filter((id) => scene[id].visible && scene[id].visibleBounds);
  const preview = controls.preview;
  const dropPreview = preview?.layerDrop ?? layerDragEvents.preview;
  const hoverDrop = dropPreview?.phase === 'hover' ? dropPreview.drop : undefined;
  const dropId = dropPreview?.phase === 'saving' ? dropPreview.id : hoverDrop?.id;
  const dropEdits = dropPreview?.phase === 'saving' ? dropPreview.edits : undefined;
  const dropParentId = hoverDrop?.order?.parentId;
  const dropBeforeId = hoverDrop?.order?.beforeId;
  const layerDraft = useMemo(() => {
    if (!dropId) return;
    // Moving the pointer within one drop slot only moves the floating layer.
    const edits = dropParentId === undefined ? dropEdits
      : dropDesignLayer(document, scene, dropId, { parentId: dropParentId, beforeId: dropBeforeId ?? null });
    return edits && previewDesignCanvasDrop(document, scene, dropId, edits);
  }, [document, dropBeforeId, dropEdits, dropId, dropParentId, scene]);
  const dropFrameId = layerDraft && hoverDrop && dropParentId !== scene[hoverDrop.id].parentId ? dropParentId : undefined;
  const layoutId = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const placement = layoutId ? preview?.placements?.[layoutId] : undefined;
  const resize = placement?.width !== undefined ? placement : undefined;
  const transformDraft = useMemo(() => {
    if (layerDraft || !layoutId || (!resize && !numberDrafts.size)) return;
    const source = document.nodes[layoutId];
    let node = (resize && transformDesignLayer(document, scene, layoutId, resize)) || source;
    for (const draft of numberDrafts.values()) if (draft.nodeId === layoutId) node = draft.edit(node);
    if (node === source) return;
    const edits = planDesignLayerUpdate(document, layoutId, node, scene[layoutId], resources);
    const nodes = { ...document.nodes };
    for (const edit of edits) nodes[edit.nodeId] = edit.node;
    return { document: { ...document, nodes }, ids: edits.map((edit) => edit.nodeId) };
  }, [document, layerDraft, layoutId, numberDrafts, resize, resources, scene]);
  const draftDocument = layerDraft?.document ?? transformDraft?.document ?? document;
  const displayedDocument = useMemo(() => draftDocument === document ? projected : projectDesignComponents(draftDocument, resources),
    [document, draftDocument, projected, resources]);
  const liveLayout = preview?.layout && preview.layout.id === layoutAdjustmentId
    ? preview.layout : undefined;
  const previewSources = transformDraft?.ids ?? liveLayout?.id;
  const layoutScope = useMemo(() => {
    if (!layerDraft) return previewSources ? designLayoutPreviewScope(projected, scene, previewSources) : undefined;
    const scope = designLayoutPreviewScope(projected, scene, layerDraft.affectedIds);
    // The dragged branch can become a root itself or leave the root list during the preview.
    const roots = new Set([...scope.rootIds, layerDraft.sourceId]);
    return { ...scope, rootIds: layerDraft.document.rootIds.filter((id) => roots.has(id)) };
  }, [layerDraft, previewSources, projected, scene]);
  const previewLayout = liveLayout?.layout;
  const displayedScene = useMemo(() => {
    if (!layoutScope) return scene;
    const computed = resolveDesignScene(layoutEngine, displayedDocument, measureDesignText, {
      rootIds: layoutScope.rootIds,
      layout: previewLayout ? { layerIds: layoutScope.layerIds, value: previewLayout } : undefined,
    });
    return { ...scene, ...computed };
  }, [displayedDocument, layoutEngine, layoutScope, previewLayout, scene]);
  const drawing = preview?.drawing;
  const drawingParent = drawing?.parentId ? scene[drawing.parentId] : undefined;
  const activePaint = paintPreview?.revision === revision && [...paintPreview.nodes.keys()].every((id) => selectedIds.includes(id))
    ? paintPreview : undefined;
  const activeCrop = preview?.crop && preview.crop.id === croppingId ? preview.crop : undefined;
  const placements = resize ? undefined : preview?.placements;
  const movingSelection = Boolean(layoutId && preview?.layerDrop && dropId === layoutId);
  const freeDropPosition = movingSelection && hoverDrop && !isFlowChild(draftDocument, displayedScene, hoverDrop.id)
    ? hoverDrop.edits.find((edit) => edit.kind === 'update')?.node : undefined;
  const inspectorPreview = useMemo(() => {
    if (!layoutId || (!placement && !liveLayout && !activeCrop && !movingSelection)) return undefined;
    const box = displayedScene[layoutId];
    const point = freeDropPosition ?? placements?.[layoutId] ?? box;
    return { id: layoutId, revision, x: point.x, y: point.y, width: box.width, height: box.height,
      rotation: placement?.rotation ?? draftDocument.nodes[layoutId].rotation ?? 0, layout: liveLayout?.layout, crop: activeCrop?.value };
  }, [activeCrop, displayedScene, draftDocument, freeDropPosition, layoutId, liveLayout, movingSelection, placement, placements, revision]);
  useLayoutEffect(() => { onInspectorPreview(inspectorPreview); }, [inspectorPreview, onInspectorPreview]);
  useLayoutEffect(() => {
    const element = surface.current;
    if (element && element.ownerDocument.activeElement === element.ownerDocument.body) element.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    if (!surface.current) return;
    surface.current.style.cursor = '';
    if (croppingId || layoutAdjustmentId || pathEditingId) surface.current.focus({ preventScroll: true });
  }, [croppingId, layoutAdjustmentId, pathEditingId]);
  const range: Bounds = { ...toCanvasWorld(viewport, { x: -96, y: -96 }),
    width: (size.width + 192) / scale, height: (size.height + 192) / scale };
  const dotGap = Math.min(36, Math.max(18, 32 * scale));
  const insertionArea = useCallback(() => {
    const area = readWorkArea(workArea.current, size);
    return { ...toCanvasWorld(viewport, area), width: area.width / viewport.scale, height: area.height / viewport.scale };
  }, [size, viewport]);

  // Preview updates stay in the canvas and the affected inspector fields.
  useImperativeHandle(ref, () => ({
    insertionArea,
    previewPaint(base, nodes) {
      setPaintPreview((active) => nodes ? { revision: base, nodes } : active?.revision === base ? undefined : active);
    },
    previewNumber(nodeId, owner, edit) {
      setNumberDrafts((current) => {
        if (!edit && !current.has(owner)) return current;
        const next = new Map(current);
        if (edit) next.set(owner, { nodeId, edit });
        else next.delete(owner);
        return next;
      });
    },
  }), [insertionArea]);

  useLayoutEffect(() => {
    if (!size.width || !size.height || !document.rootIds.length || lastFit.current === fitRequest) return;
    lastFit.current = fitRequest;
    const ids = fitRequest === 0 ? document.rootIds : visibleIds;
    const area = readWorkArea(workArea.current, size);
    setViewport((current) => fittedViewport(sceneBounds(scene, ids), area, current));
  }, [document.rootIds, fitRequest, scene, size, visibleIds]);

  function fit(selection: boolean) {
    const area = readWorkArea(workArea.current, size);
    setViewport((current) => fittedViewport(sceneBounds(scene, selection ? visibleIds : document.rootIds), area, current));
  }

  function zoom(multiplier: number) {
    const center = areaCenter(readWorkArea(workArea.current, size));
    setViewport((current) => zoomViewport(current, center, multiplier));
  }

  function changeTool(next: DesignTool) {
    onToolChange(next);
    surface.current?.focus({ preventScroll: true });
  }

  function cancelGesture() {
    if (surface.current) surface.current.style.cursor = '';
    controls.cancel();
  }

  function cancelPointer(event: PointerEvent<HTMLDivElement>) {
    pen.onPointerCancel(event);
    pathEdit.onPointerCancel(event);
    controls.onPointerCancel(event);
  }

  return <div className="design-editor__canvas">
    <div className="design-editor__stage" ref={surface} role="region" tabIndex={0} aria-label={t('feature.design.canvas')}
      data-tool={controls.space ? 'hand' : tool} data-panning={controls.panning} data-cropping={Boolean(croppingId)}
      style={{
        '--design-grid-step': `${dotGap}px`,
        '--design-grid-x': `${viewport.x % dotGap}px`,
        '--design-grid-y': `${viewport.y % dotGap}px`,
      } as CSSProperties}
      onContextMenu={(event) => {
        if (blocked || controls.isActive()) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        const point = { x: event.clientX, y: event.clientY };
        const screen = toCanvasScreen(event.currentTarget, point);
        const hit = stage.current?.getIntersection(screen);
        const id = hit?.findAncestor('.design-hit-layer', true)?.id()
          ?? (canvasLayoutHandle(hit) || hit?.hasName('design-rotate') || hit?.name().startsWith('design-anchor-') ? visibleIds[0] : undefined);
        onContextMenu({ point, world: toCanvasWorld(viewport, screen), id: id && Object.hasOwn(document.nodes, id) ? id : null });
      }}
      onPointerDown={(event) => {
        if (pen.isPlacingAnchor() || pathEdit.isDragging()) return;
        if (!controls.space && !controls.isActive() && (pen.onPointerDown(event) || pathEdit.onPointerDown(event))) return;
        controls.onPointerDown(event);
      }}
      onPointerMove={(event) => {
        if (!controls.space && !controls.isActive()) {
          pen.onPointerMove(event);
          if (pathEdit.onPointerMove(event)) return;
        }
        controls.onPointerMove(event);
      }}
      onPointerLeave={(event) => { pen.onPointerLeave(); event.currentTarget.style.cursor = ''; }}
      onPointerUp={(event) => {
        if (!pen.onPointerUp(event) && !pathEdit.onPointerUp(event)) controls.onPointerUp(event);
      }} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}
      onDragOver={layerDragEvents.onDragOver} onDragLeave={layerDragEvents.onDragLeave} onDrop={layerDragEvents.onDrop}
      onPaste={(event) => { if (controls.isActive() || pen.preview || pathEdit.isDragging()) event.stopPropagation(); }}
      onBlur={() => {
        if (controls.isAdjustingProperties()) cancelGesture();
        if (pathEdit.isDragging()) pathEdit.cancel();
        controls.setSpace(false);
      }}
      onKeyUp={(event) => { if (event.code === 'Space') controls.setSpace(false); }}
      onKeyDown={(event) => {
        if (pen.onKeyDown(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (pen.isPlacingAnchor() || pathEdit.isDragging()) {
          if (event.key === 'Escape') pathEdit.cancel();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (controls.isAdjustingProperties()) {
          if (event.key === 'Escape') {
            cancelGesture();
            event.preventDefault();
          }
          event.stopPropagation();
          return;
        }
        if (blocked) return;
        if ((croppingId || layoutAdjustmentId || pathEditingId) && event.key === 'Escape') {
          onExitAdjustment();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const area = readWorkArea(workArea.current, size);
          const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
          const id = visibleIds[0] ?? null;
          const anchor = id ? scene[id].paintBounds : undefined;
          const position = anchor ? {
            x: Math.max(area.x, Math.min(area.x + area.width, viewport.x + anchor.x * scale)),
            y: Math.max(area.y, Math.min(area.y + area.height, viewport.y + anchor.y * scale)),
          } : areaCenter(area);
          onContextMenu({ id, point: { x: left + position.x * width / (size.width || 1), y: top + position.y * height / (size.height || 1) } });
        } else if (event.code === 'Space' && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          controls.setSpace(true);
        } else if (event.key === 'Escape') {
          cancelGesture();
        } else if ((event.key === '+' || event.key === '=' || event.key === '-') && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          zoom(event.key === '-' ? 0.8 : 1.25);
        } else if (event.shiftKey && (event.code === 'Digit1' || event.code === 'Digit2')) {
          event.preventDefault();
          fit(event.code === 'Digit2' && visibleIds.length > 0);
        }
      }}>
      <Stage ref={stage} width={size.width} height={size.height}
        onWheel={(event) => {
          event.evt.preventDefault();
          if (editingId || controls.isActive() || pen.isPlacingAnchor() || pathEdit.isDragging()) return;
          const native = event.evt;
          const pointer = event.currentTarget.getStage()?.getPointerPosition();
          setViewport((current) => {
            if ((native.ctrlKey || native.metaKey) && pointer) return zoomViewport(current, pointer, Math.exp(-native.deltaY * 0.006));
            if (native.shiftKey) return { ...current, x: current.x - (native.deltaX || native.deltaY) };
            return { ...current, x: current.x - native.deltaX, y: current.y - native.deltaY };
          });
        }}>
        <Layer>
          <Group x={viewport.x} y={viewport.y} scaleX={scale} scaleY={scale}>
            <DesignCanvasLayers document={displayedDocument} scene={displayedScene} placements={placements}
              canvas={{ range, scale, editingId, paintPreview: activePaint, cropPreview: activeCrop,
                floating: hoverDrop, pathPreview: pathEdit.preview, loadImage, translate: t }} />
            {settings.showPixelGrid && scale >= 4 ? <PixelGrid range={range} scale={scale} /> : null}
            {dropFrameId ? <DesignCanvasSelection document={draftDocument} scene={displayedScene}
              ids={[dropFrameId]} scale={scale} handles={false} /> : null}
            {!editingId && !dropPreview && !pathEditingId && tool === 'select' && !controls.panning && !preview?.marquee ? <DesignCanvasSelection
              document={draftDocument} scene={displayedScene} ids={visibleIds} placements={placements} scale={scale}
              handles={!disabled && !croppingId && !layoutAdjustmentId} /> : null}
            {layoutAdjustmentId && !dropPreview && !controls.space && !controls.panning && !preview?.marquee && !preview?.placements
              ? <DesignCanvasLayoutHandles id={layoutAdjustmentId} document={document} scene={displayedScene} scale={scale}
                disabled={blocked} preview={liveLayout} /> : null}
            {preview?.marquee ? <Rect {...preview.marquee} listening={false} stroke={designSelectionColor} strokeWidth={1 / scale}
              fill="rgba(103,101,240,0.13)" /> : null}
            {drawing && !drawing.click ? <Group {...drawingPreview(drawing.bounds, drawingParent)} listening={false}>
              {drawing.tool === 'ellipse' ? <Ellipse x={drawing.bounds.width / 2} y={drawing.bounds.height / 2}
                radiusX={drawing.bounds.width / 2} radiusY={drawing.bounds.height / 2} stroke={designSelectionColor}
                strokeWidth={1 / scale} fill="rgba(103,101,240,0.13)" /> : drawing.tool === 'polygon'
                ? <Path data={designPolygonPath(drawing.bounds.width, drawing.bounds.height, defaultDesignPolygonSides)}
                  stroke={designSelectionColor} strokeWidth={1 / scale} fill="rgba(103,101,240,0.13)" /> : <Rect width={drawing.bounds.width}
                height={drawing.bounds.height} stroke={designSelectionColor} strokeWidth={1 / scale} fill="rgba(103,101,240,0.13)" />}
              <Group {...unreflect(drawing.bounds.width, drawing.bounds.height, {
                scaleX: drawingParent?.scaleX ?? 1, scaleY: drawingParent?.scaleY ?? 1,
              })}>
                <DimensionTag width={drawing.bounds.width} height={drawing.bounds.height} scale={scale} />
              </Group>
            </Group> : null}
            {pen.preview ? <DesignPathOverlay {...pen.preview} scale={scale} drawing
              pose={pen.preview.parentId === null ? undefined : scene[pen.preview.parentId]} /> : null}
            {pathEdit.overlay && !controls.panning ? <DesignPathOverlay {...pathEdit.overlay} scale={scale} /> : null}
            {preview?.guides?.map((guide) => <Line key={guide.axis} listening={false}
              points={guide.axis === 'x' ? [guide.at, guide.start, guide.at, guide.end] : [guide.start, guide.at, guide.end, guide.at]}
              stroke="#e05a9d" strokeWidth={1 / scale} dash={[4 / scale, 3 / scale]} />)}
          </Group>
        </Layer>
      </Stage>
    </div>
    <div className="design-canvas__work-area" ref={workArea} aria-hidden="true" />
    {editingId ? renderTextInput(viewport) : null}
    <div className="design-canvas__controls">
      <DesignTools tool={tool} disabled={blocked} onChange={changeTool}
        onImage={onImage} onIcon={onIcon} translate={t} />
      <div className="design-canvas__zoom" role="group" aria-label={t('feature.design.zoom')}>
        <IconButton size="small" label={t('feature.design.fit')} disabled={blocked || !document.rootIds.length}
          onClick={() => fit(false)}><Maximize size={14} /></IconButton>
        <IconButton size="small" label={t('feature.design.fitSelection')} disabled={blocked || !visibleIds.length}
          onClick={() => fit(true)}><Scan size={14} /></IconButton>
        <span className="design-tools__divider" aria-hidden="true" />
        <IconButton size="small" label={t('feature.design.zoomOut')} disabled={blocked || scale <= minScale}
          onClick={() => zoom(0.8)}><Minus size={14} /></IconButton>
        <Button size="small" variant="ghost" className="design-canvas__level" disabled={blocked}
          title={t('feature.design.resetZoom')} aria-label={t('feature.design.resetZoom')} onClick={() => zoom(1 / scale)}>
          {Math.round(scale * 100)}%
        </Button>
        <IconButton size="small" label={t('feature.design.zoomIn')} disabled={blocked || scale >= maxScale}
          onClick={() => zoom(1.25)}><Plus size={14} /></IconButton>
      </div>
    </div>
  </div>;
});

function PixelGrid({ range, scale }: Readonly<{ range: Bounds; scale: number }>) {
  const x0 = Math.floor(range.x);
  const y0 = Math.floor(range.y);
  const x1 = Math.ceil(range.x + range.width);
  const y1 = Math.ceil(range.y + range.height);
  const columns = Math.ceil(range.width) + 1;
  const rows = Math.ceil(range.height) + 1;
  return <Shape listening={false} sceneFunc={(context) => {
    context.beginPath();
    for (let index = 0; index <= columns; index += 1) {
      const x = x0 + index;
      context.moveTo(x, y0);
      context.lineTo(x, y1);
    }
    for (let index = 0; index <= rows; index += 1) {
      const y = y0 + index;
      context.moveTo(x0, y);
      context.lineTo(x1, y);
    }
    context.setAttr('strokeStyle', 'rgba(117, 123, 154, 0.22)');
    context.setAttr('lineWidth', 1 / scale);
    context.stroke();
  }} />;
}

function useCanvasSize(surface: React.RefObject<HTMLDivElement>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [surface]);
  return size;
}

function zoomViewport(current: CanvasViewport, anchor: Point, multiplier: number): CanvasViewport {
  const scale = Math.min(maxScale, Math.max(minScale, current.scale * multiplier));
  const ratio = scale / current.scale;
  return { scale, x: anchor.x - (anchor.x - current.x) * ratio, y: anchor.y - (anchor.y - current.y) * ratio };
}

function sceneBounds(scene: DesignScene, ids: readonly string[]): Bounds | undefined {
  return unionBounds(ids.filter((id) => scene[id].visible).map((id) => scene[id].paintBounds));
}

function readWorkArea(element: HTMLDivElement | null, size: Size): Bounds {
  if (!element || element.clientWidth < 48 || element.clientHeight < 48) return { x: 0, y: 0, ...size };
  // Use the same palette insets as CSS, in the local pixels Konva uses.
  return { x: element.offsetLeft, y: element.offsetTop, width: element.clientWidth, height: element.clientHeight };
}

function areaCenter(area: Bounds): Point {
  return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
}

function fittedViewport(bounds: Bounds | undefined, area: Bounds, fallback: CanvasViewport): CanvasViewport {
  if (!bounds || !area.width || !area.height) return fallback;
  const width = Math.max(bounds.width, 1);
  const height = Math.max(bounds.height, 1);
  const padding = Math.min(fitPadding, area.width / 8, area.height / 8);
  const scale = Math.max(minScale, Math.min(1.5, (area.width - 2 * padding) / width, (area.height - 2 * padding) / height));
  return { x: area.x + (area.width - width * scale) / 2 - bounds.x * scale,
    y: area.y + (area.height - height * scale) / 2 - bounds.y * scale, scale };
}
