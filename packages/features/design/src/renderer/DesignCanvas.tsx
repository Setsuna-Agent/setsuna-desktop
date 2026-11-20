import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type MutableRefObject, type PointerEvent, type ReactNode } from 'react';
import type Konva from 'konva';
import { Ellipse, Group, Layer, Line, Path, Rect, Shape, Stage } from 'react-konva';
import type { Yoga } from 'yoga-layout/load';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument, DesignEdit, DesignNode, DesignText } from '../contracts/index.js';
import { clearDesignChangedBindings } from '../contracts/design-variables.js';
import type { DesignCanvasSettings } from './context/design-canvas-settings.js';
import type { DesignLayerMenuTarget } from './context/use-design-layer-actions.js';
import { DesignCanvasLayoutHandles } from './DesignCanvasLayoutHandles.js';
import { DesignCanvasLayers } from './DesignCanvasLayers.js';
import { useDesignCanvasShaders } from './shaders/use-design-canvas-shaders.js';
import { DesignCanvasSelection, designSelectionColor, DimensionTag, drawingPreview } from './DesignCanvasSelection.js';
import { DesignTools, type DesignToolPanels } from './DesignTools.js';
import { DesignZoomControls } from './DesignZoomControls.js';
import { DesignDrawingControls } from './canvas/DesignDrawingControls.js';
import { DesignWebPreview, type DesignWebPreviewHandle } from './canvas/DesignWebPreview.js';
import { DesignWebToolbar, designWebToolbarGap, designWebToolbarHeight, type DesignWebLayerControls } from './canvas/DesignWebToolbar.js';
import { useDesignWebPreviews, type CaptureDesignWebImages, type DesignWebSession } from './canvas/use-design-web-previews.js';
import type { DesignWebPreviewHost } from './client.js';
import { projectDesignScriptLayers, type DesignScriptResults } from './canvas/design-script-layers.js';
import { drawingPathNode, isDrawingInkTool, isFreehandTool, sampleDesignInk, type DrawingInk, type DrawingPreview } from './canvas/design-drawing.js';
import { useDesignFreehand } from './canvas/use-design-freehand.js';
import { projectDesignComponents } from './components/design-components.js';
import type { DesignLibraryResources } from './components/design-library-resources.js';
import { dropDesignLayer, isFlowChild, planDesignLayerUpdate, previewDesignCanvasDrop, selectedBranches, transformDesignLayer, type LayerPlacement } from './design-canvas-edits.js';
import { intersectBounds, toWorld, toWorldVector, unionBounds, unreflect, type Bounds, type Point } from './design-geometry.js';
import type { LoadDesignImage } from './design-images.js';
import { designDrawingPlacement } from './design-insertion.js';
import type { DesignFieldUpdates, InspectorCanvasPreview } from './inspector/design-inspector-edit.js';
import type { DesignComponentDrag, DesignLayerDrag } from './design-layer-drop.js';
import { designLayoutPreviewScope, resolveDesignScene, type DesignLayerBox, type DesignScene } from './design-layout.js';
import { hasEditableLayout, withLayoutHandleValue } from './design-layout-adjustment.js';
import { colorWithOpacity, type DesignPaintPreview } from './design-paint.js';
import { measureDesignText } from './design-text.js';
import { DesignCanvasGradient } from './styles/DesignCanvasGradient.js';
import { useDesignCanvasGradient } from './styles/use-design-canvas-gradient.js';
import { canvasLayoutHandle, toCanvasScreen, toCanvasWorld, useDesignCanvasGestures, type CanvasAction, type CanvasViewport, type DesignTool } from './use-design-canvas-gestures.js';
import { useDesignCanvasLayerDrag } from './use-design-canvas-layer-drag.js';
import { DesignPathOverlay } from './vectors/DesignPathOverlay.js';
import { designVectorShape } from './vectors/design-vector.js';
import { useDesignPathEdit } from './vectors/use-design-path-edit.js';
import { useDesignPen } from './vectors/use-design-pen.js';

export type { CanvasViewport } from './use-design-canvas-gestures.js';

type Size = Readonly<{ width: number; height: number }>;
const fitPadding = 32;
const minScale = 0.02;
const maxScale = 8;
const initialViewport: CanvasViewport = { x: 68, y: 68, scale: 1 };
const marqueeFill = colorWithOpacity(designSelectionColor, 0.13);

export type DesignCanvasHandle = Readonly<{
  focus(): void;
  insertionArea(): Bounds;
  captureWebImages: CaptureDesignWebImages;
  highlightLayer(id: string | undefined): void;
  previewPaint(revision: string, nodes: ReadonlyMap<string, DesignNode> | undefined): void;
  previewFields(owner: string, updates: DesignFieldUpdates | undefined): void;
}>;

type DesignCanvasProps = Readonly<{
  document: DesignDocument;
  projected: DesignDocument;
  resources?: DesignLibraryResources;
  scene: DesignScene;
  layoutEngine: Yoga;
  revision: string;
  layerDrag: MutableRefObject<DesignLayerDrag | undefined>;
  componentDrag: MutableRefObject<DesignComponentDrag | undefined>;
  onLayerDrop(id: string, edits: readonly DesignEdit[], revision: string): Promise<boolean>;
  onComponentDrop(id: string, point: Point, revision: string): Promise<void>;
  selectedIds: readonly string[];
  scriptResults: DesignScriptResults;
  webHost?: DesignWebPreviewHost;
  webSession?: DesignWebSession;
  webControlsFor(id: string): DesignWebLayerControls | undefined;
  croppingId?: string;
  layoutAdjustmentId?: string;
  pathEditingId?: string;
  straightPathId?: string;
  onExitAdjustment(): void;
  onInspectorPreview(preview: InspectorCanvasPreview | undefined): void;
  editingId: string | null;
  disabled: boolean;
  fitRequest: number;
  loadImage: LoadDesignImage;
  tool: DesignTool;
  drawing: Readonly<{
    enabled: boolean;
    ink?: DrawingInk;
    disabled: boolean;
    revision: string;
    onToggle(): void;
    onChangeInk(ink: DrawingInk): void;
    onCommit(stroke: DrawingPreview, revision: string): Promise<boolean>;
  }>;
  settings: DesignCanvasSettings;
  onContextMenu(target: DesignLayerMenuTarget): void;
  onToolChange(tool: DesignTool): void;
  toolPanels: DesignToolPanels;
  toolbarActions: ReactNode;
  onSelect(ids: readonly string[]): void;
  onEditText(nodeId: string, node: DesignText): void;
  onAction(action: CanvasAction, expectedRevision: string): Promise<boolean>;
  renderTextInput(viewport: CanvasViewport): ReactNode;
  translate: RendererTranslate;
}>;

export const DesignCanvas = forwardRef<DesignCanvasHandle, DesignCanvasProps>(function DesignCanvas({
  document, projected, resources, scene, layoutEngine, revision, layerDrag, componentDrag, onLayerDrop, onComponentDrop,
  selectedIds, scriptResults, webHost, webSession, webControlsFor, croppingId, layoutAdjustmentId, pathEditingId, straightPathId, onExitAdjustment,
  onInspectorPreview, editingId, disabled, fitRequest, loadImage, tool, drawing: drawingMode, onToolChange, toolPanels, toolbarActions,
  settings, onContextMenu, onSelect, onEditText, onAction, renderTextInput, translate: t,
}, ref) {
  const surface = useRef<HTMLDivElement>(null);
  const workArea = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const webGuest = useRef<DesignWebPreviewHandle>(null);
  const size = useCanvasSize(surface);
  const expandedSize = useCanvasSize(workArea, webSession?.mode === 'expanded');
  const [webLocation, setWebLocation] = useState<Readonly<{ id: string; source: string; address: string }>>();
  const onWebNavigate = useCallback((id: string, source: string, address: string | undefined) => {
    setWebLocation((current) => address ? { id, source, address }
      : current?.id === id && current.source === source ? undefined : current);
  }, []);
  const [viewport, setViewport] = useState<CanvasViewport>(initialViewport);
  const [hoveredLayerId, setHoveredLayerId] = useState<string>();
  const [paintPreview, setPaintPreview] = useState<DesignPaintPreview>();
  const [fieldDrafts, setFieldDrafts] = useState<ReadonlyMap<string, DesignFieldUpdates>>(() => new Map());
  const lastFit = useRef<number>();
  const { scale } = viewport;
  const blocked = disabled || Boolean(editingId);
  const controls = useDesignCanvasGestures({ stage, document, projected, scene, revision, tool, selectedIds, croppingId, layoutAdjustmentId,
    disabled: blocked, viewport, setViewport, onSelect, onEditText, onAction, settings });
  const pen = useDesignPen({ enabled: tool === 'pen', disabled: blocked, document: projected, scene, revision, viewport,
    snapToPixelGrid: settings.snapToPixelGrid, onAction });
  const ink = drawingMode.ink;
  const drawingBlocked = drawingMode.disabled || Boolean(editingId);
  const freehand = useDesignFreehand({ tool: drawingMode.enabled && isFreehandTool(tool) ? tool : undefined,
    ink: ink?.preset ? { ...ink, preset: ink.preset } : undefined, disabled: drawingBlocked, document: projected, scene, viewport,
    revision: drawingMode.revision, onCommit: drawingMode.onCommit });
  const { anchors: penAnchors, parentId: penParentId, closed: penClosed } = pen.preview ?? {};
  const styledPen = useMemo(() => {
    if (!ink || tool !== 'pen' || !penAnchors || penAnchors.length < 2) return;
    const node = drawingPathNode(penAnchors, Boolean(penClosed), ink);
    const { parentId, placement } = designDrawingPlacement(projected, scene, penParentId ?? null, node);
    return { id: 'pen-preview', parentId, node: { ...node, ...placement } };
  }, [ink, penAnchors, penClosed, penParentId, projected, scene, tool]);
  const draftStroke = freehand.preview ?? styledPen;
  const drawingPreviews = draftStroke ? [draftStroke] : undefined;
  const layerDragEvents = useDesignCanvasLayerDrag({ surface, drag: layerDrag, componentDrag, document, projected, scene, revision, viewport,
    disabled: blocked, isGestureActive: (): boolean => controls.isActive() || Boolean(pen.preview) || pathEdit.isDragging() || freehand.isDrawing(),
    onDrop: onLayerDrop, onComponentDrop });
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
    if (layerDraft || (!resize && !fieldDrafts.size)) return;
    const updates = new Map<string, DesignNode>();
    if (resize && layoutId) {
      const node = transformDesignLayer(document, scene, layoutId, resize, projected);
      if (node) updates.set(layoutId, node);
    }
    for (const drafts of fieldDrafts.values()) {
      for (const [id, apply] of drafts) {
        if (selectedIds.includes(id) && scene[id] && !scene[id].locked && document.nodes[id]) {
          updates.set(id, apply(updates.get(id) ?? document.nodes[id]));
        }
      }
    }
    const edits = [...updates].flatMap(([id, node]) => node === document.nodes[id] ? []
      : planDesignLayerUpdate(document, id, node, { projected, scene }));
    if (!edits.length) return;
    const nodes = { ...document.nodes };
    for (const edit of edits) nodes[edit.nodeId] = clearDesignChangedBindings(document.nodes[edit.nodeId], edit.node);
    return { document: { ...document, nodes }, ids: edits.map((edit) => edit.nodeId) };
  }, [document, fieldDrafts, layerDraft, layoutId, projected, resize, scene, selectedIds]);
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
  const layoutFrame = liveLayout && displayedDocument.nodes[liveLayout.id];
  const shownLayout = useMemo(() => liveLayout && hasEditableLayout(layoutFrame)
    ? withLayoutHandleValue(layoutFrame.layout, liveLayout.handle, liveLayout.value) : undefined, [layoutFrame, liveLayout]);
  const pendingLayout = useMemo(() => liveLayout && layoutScope ? {
    layerIds: layoutScope.layerIds, apply: (layout: Parameters<typeof withLayoutHandleValue>[0]) => withLayoutHandleValue(layout, liveLayout.handle, liveLayout.value),
  } : undefined, [layoutScope, liveLayout]);
  const displayedScene = useMemo(() => {
    if (!layoutScope) return scene;
    const computed = resolveDesignScene(layoutEngine, displayedDocument, measureDesignText, {
      rootIds: layoutScope.rootIds,
      layout: pendingLayout,
    });
    return { ...scene, ...computed };
  }, [displayedDocument, layoutEngine, layoutScope, pendingLayout, scene]);
  const paintDocument = useMemo(() => projectDesignScriptLayers(displayedDocument, scriptResults), [displayedDocument, scriptResults]);
  const paintScene = useMemo(() => paintDocument === displayedDocument ? displayedScene
    : resolveDesignScene(layoutEngine, paintDocument, measureDesignText, { rootIds: paintDocument.rootIds, layout: pendingLayout }),
  [displayedDocument, displayedScene, layoutEngine, paintDocument, pendingLayout]);
  const pathEdit = useDesignPathEdit({ id: pathEditingId ?? straightPathId, direct: Boolean(straightPathId), disabled: blocked,
    document, projected: displayedDocument, scene: displayedScene, revision, viewport, settings, onAction });
  const drawing = preview?.drawing;
  const drawingParent = drawing?.parentId ? scene[drawing.parentId] : undefined;
  const drawingPath = drawing?.geometry ? designVectorShape({ geometry: drawing.geometry }, drawing.bounds.width, drawing.bounds.height).paths[0] : undefined;
  const activePaint = paintPreview?.revision === revision && [...paintPreview.nodes.keys()].every((id) => selectedIds.includes(id))
    ? paintPreview : undefined;
  const activeCrop = preview?.crop && preview.crop.id === croppingId ? preview.crop : undefined;
  const gradientEdit = useDesignCanvasGradient({ document, projected: displayedDocument, scene: displayedScene, revision,
    selectedId: layoutId, preview: activePaint,
    visible: tool === 'select' && !editingId && !croppingId && !layoutAdjustmentId && !pathEditingId
      && !controls.space && !controls.panning && !controls.isActive() && !pathEdit.isDragging() && !dropPreview,
    onSave: (id, node, base) => onAction({ kind: 'gradient', id, node }, base) });
  const showEndpoints = Boolean(straightPathId && !gradientEdit && !dropPreview && !controls.space && !controls.isActive());
  const outlinedPathId = pathEditingId ?? (showEndpoints ? straightPathId : undefined);
  const showSelection = !outlinedPathId && (tool === 'select' || tool === 'hand');
  const hoverOutlineId = hoveredLayerId && hoveredLayerId !== outlinedPathId && (!showSelection || !visibleIds.includes(hoveredLayerId))
    ? hoveredLayerId : undefined;
  const placements = resize ? undefined : preview?.placements;
  const movingSelection = Boolean(layoutId && preview?.layerDrop && dropId === layoutId);
  const freeDropPosition = movingSelection && hoverDrop && !isFlowChild(displayedDocument, displayedScene, hoverDrop.id)
    ? hoverDrop.edits.find((edit) => edit.kind === 'update')?.node : undefined;
  const segmentPreview = pathEdit.segment;
  const inspectorPreview = useMemo(() => {
    if (!layoutId || (!placement && !liveLayout && !activeCrop && !movingSelection && !segmentPreview)) return undefined;
    const box = displayedScene[layoutId];
    const point = freeDropPosition ?? placements?.[layoutId] ?? box;
    return { id: layoutId, revision, x: point.x, y: point.y, width: box.width, height: box.height,
      rotation: placement?.rotation ?? draftDocument.nodes[layoutId].rotation ?? 0, layout: shownLayout, crop: activeCrop?.value, segment: segmentPreview };
  }, [activeCrop, displayedScene, draftDocument, freeDropPosition, layoutId, liveLayout, movingSelection, placement, placements, revision, segmentPreview, shownLayout]);
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
  const screenRange = {
    ...toCanvasWorld(viewport, { x: 0, y: 0 }), width: size.width / scale, height: size.height / scale,
  };
  const shaders = useDesignCanvasShaders(stage, paintDocument, paintScene, screenRange, activePaint);
  const web = useDesignWebPreviews(webHost, projected, scene, screenRange, layoutId, webSession);
  const webLayer = web.live && displayedDocument.nodes[web.live.id];
  function browserBox(id: string) {
    return moveBrowserBox(displayedScene[id], displayedScene, placements?.[id], hoverDrop?.id === id ? hoverDrop.center : undefined);
  }
  const webRequest = web.request && web.live && webLayer?.kind === 'web' && webLayer.url
    ? { ...web.request, node: { ...webLayer, url: webLayer.url }, box: browserBox(web.live.id) } : web.request;
  const webLayerIds = useMemo(() => webHost ? Object.keys(document.nodes).filter((id) => document.nodes[id].kind === 'web') : [],
    [document.nodes, webHost]);
  const expandedWebId = web.live?.mode === 'expanded' ? web.live.id : undefined;
  const webToolbarIds = expandedWebId ? [expandedWebId] : webLayerIds;
  const canDragWeb = tool === 'select' && !controls.space && !controls.panning;
  const webToolbars = webToolbarIds.map((id) => {
    const node = document.nodes[id];
    if (node?.kind !== 'web' || !displayedScene[id]?.visible) return null;
    const box = browserBox(id);
    const bounds = box.visibleBounds;
    if (!bounds || (!expandedWebId && size.width && size.height && !intersectBounds(screenRange, bounds))) return null;
    const actions = webControlsFor(id);
    if (!actions) return null;
    const active = web.live?.id === id;
    const address = active && webLocation?.id === id && webLocation.source === node.url ? webLocation.address : node.url;
    return <DesignWebToolbar key={id} actions={actions} raised={active || layoutId === id} disabled={blocked || box.locked}
      deviceId={node.deviceId} address={address}
      anchor={{ x: viewport.x + bounds.x * scale, y: viewport.y + bounds.y * scale, width: bounds.width * scale }}
      onRefresh={() => { if (!active || !webGuest.current?.reload()) web.refresh(id); }}
      onMove={canDragWeb ? (event) => {
        if (surface.current) controls.onPointerDown(event, { id, surface: surface.current });
      } : undefined} translate={t} />;
  });
  const dotGap = Math.min(36, Math.max(18, 32 * scale));
  const insertionArea = useCallback(() => {
    const area = readWorkArea(workArea.current, size);
    return { ...toCanvasWorld(viewport, area), width: area.width / viewport.scale, height: area.height / viewport.scale };
  }, [size, viewport]);

  // Keep transient previews local to the canvas and the affected inspector fields.
  useImperativeHandle(ref, () => ({
    focus: () => surface.current?.focus({ preventScroll: true }),
    insertionArea,
    captureWebImages: web.captureExportImages,
    highlightLayer: setHoveredLayerId,
    previewPaint(base, nodes) {
      setPaintPreview((active) => nodes ? { revision: base, nodes } : active?.revision === base ? undefined : active);
    },
    previewFields(owner, updates) {
      setFieldDrafts((current) => {
        if (!updates && !current.has(owner)) return current;
        const next = new Map(current);
        if (updates) next.set(owner, updates);
        else next.delete(owner);
        return next;
      });
    },
  }), [insertionArea, web.captureExportImages]);

  useLayoutEffect(() => {
    if (!size.width || !size.height || lastFit.current === fitRequest || (!document.rootIds.length && !drawingMode.enabled)) return;
    lastFit.current = fitRequest;
    // Keep the first stroke on an empty canvas under the pointer.
    if (!document.rootIds.length) return;
    const ids = fitRequest === 0 ? document.rootIds : visibleIds;
    const area = readWorkArea(workArea.current, size);
    setViewport((current) => fittedViewport(sceneBounds(scene, ids), area, current));
  }, [document.rootIds, drawingMode.enabled, fitRequest, scene, size, visibleIds]);

  function fit(selection: boolean) {
    const area = readWorkArea(workArea.current, size);
    setViewport((current) => fittedViewport(sceneBounds(scene, selection ? visibleIds : document.rootIds), area, current));
  }

  function zoomAtCenter(target: (scale: number) => number) {
    const center = areaCenter(readWorkArea(workArea.current, size));
    setViewport((current) => zoomViewport(current, center, target(current.scale)));
  }

  function zoom(direction: 'in' | 'out') {
    zoomAtCenter((scale) => scale * (direction === 'in' ? 1.25 : 0.8));
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

  return <div className="design-editor__canvas" style={{
    '--design-web-toolbar-height': `${designWebToolbarHeight}px`,
    '--design-web-toolbar-gap': `${designWebToolbarGap}px`,
  } as CSSProperties}>
    <DesignTools tool={tool} disabled={blocked} onChange={changeTool} toolPanels={toolPanels} actions={toolbarActions}
      drawingMode={drawingMode.enabled} onToggleDrawing={() => {
        pen.cancel();
        freehand.cancel();
        drawingMode.onToggle();
        surface.current?.focus({ preventScroll: true });
      }} translate={t} />
    {ink && isDrawingInkTool(tool) ? <DesignDrawingControls tool={tool} ink={ink} disabled={drawingBlocked}
      onChange={drawingMode.onChangeInk} translate={t} /> : null}
    <div className="design-editor__stage" ref={surface} role="region" tabIndex={0} aria-label={t('feature.design.canvas')}
      data-tool={controls.space ? 'hand' : tool} data-panning={controls.panning} data-cropping={Boolean(croppingId)}
      style={{
        '--design-grid-step': `${dotGap}px`,
        '--design-grid-x': `${viewport.x % dotGap}px`,
        '--design-grid-y': `${viewport.y % dotGap}px`,
      } as CSSProperties}
      onContextMenu={(event) => {
        if ((ink && (event.metaKey || event.ctrlKey)) || freehand.isDrawing()) { event.preventDefault(); return; }
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
        if (pen.isPlacingAnchor() || pathEdit.isDragging() || freehand.isDrawing()) return;
        if (!controls.space && !controls.isActive()) {
          if (ink && !drawingBlocked && event.button === 0 && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            const point = toCanvasScreen(event.currentTarget, { x: event.clientX, y: event.clientY });
            const id = stage.current?.getIntersection(point)?.findAncestor('.design-hit-layer', true)?.id();
            const sample = id ? sampleDesignInk(displayedDocument.nodes[id]) : undefined;
            if (sample) drawingMode.onChangeInk(sample);
            return;
          }
          if (freehand.onPointerDown(event) || pen.onPointerDown(event)) return;
          if ((pathEditingId || showEndpoints) && pathEdit.onPointerDown(event)) return;
        }
        controls.onPointerDown(event);
      }}
      onPointerMove={(event) => {
        if (freehand.isDrawing()) return;
        if (!controls.space && !controls.isActive()) {
          pen.onPointerMove(event);
          if ((pathEditingId || showEndpoints) && pathEdit.onPointerMove(event)) return;
        }
        controls.onPointerMove(event);
      }}
      onPointerLeave={(event) => { pen.onPointerLeave(); event.currentTarget.style.cursor = ''; }}
      onPointerUp={(event) => {
        if (!pen.onPointerUp(event) && !pathEdit.onPointerUp(event)) controls.onPointerUp(event);
      }} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}
      onDragOver={layerDragEvents.onDragOver} onDragLeave={layerDragEvents.onDragLeave} onDrop={layerDragEvents.onDrop}
      onPaste={(event) => { if (controls.isActive() || pen.preview || pathEdit.isDragging() || freehand.isDrawing()) event.stopPropagation(); }}
      onBlur={(event) => {
        if (controls.isAdjustingProperties()) cancelGesture();
        if (pathEdit.isDragging()) {
          pathEdit.cancel();
          event.currentTarget.style.cursor = '';
        }
        controls.setSpace(false);
      }}
      onKeyUp={(event) => { if (event.code === 'Space') controls.setSpace(false); }}
      onKeyDown={(event) => {
        if (freehand.isDrawing()) {
          if (event.key === 'Escape') freehand.cancel();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (pen.onKeyDown(event)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (pen.isPlacingAnchor() || pathEdit.isDragging()) {
          if (event.key === 'Escape') {
            pathEdit.cancel();
            event.currentTarget.style.cursor = '';
          }
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
          zoom(event.key === '-' ? 'out' : 'in');
        } else if (event.shiftKey && (event.code === 'Digit1' || event.code === 'Digit2')) {
          event.preventDefault();
          fit(event.code === 'Digit2' && visibleIds.length > 0);
        }
      }}>
      <Stage ref={stage} width={size.width} height={size.height}
        onWheel={(event) => {
          event.evt.preventDefault();
          if (editingId || controls.isActive() || pen.isPlacingAnchor() || pathEdit.isDragging() || freehand.isDrawing()) return;
          const native = event.evt;
          const pointer = event.currentTarget.getStage()?.getPointerPosition();
          setViewport((current) => {
            if ((native.ctrlKey || native.metaKey) && pointer) return zoomViewport(current, pointer, current.scale * Math.exp(-native.deltaY * 0.006));
            if (native.shiftKey) return { ...current, x: current.x - (native.deltaX || native.deltaY) };
            return { ...current, x: current.x - native.deltaX, y: current.y - native.deltaY };
          });
        }}>
        <Layer>
          <Group x={viewport.x} y={viewport.y} scaleX={scale} scaleY={scale}>
            <DesignCanvasLayers document={paintDocument} scene={paintScene} placements={placements} shaders={shaders} webImages={web.images}
              canvas={{ range, scale, editingId, paintPreview: gradientEdit?.paintPreview ?? activePaint, cropPreview: activeCrop,
                floating: hoverDrop, pathPreview: pathEdit.preview, drawingPreviews,
                inlineWebId: web.live?.mode === 'inline' ? web.live.id : undefined, loadImage, translate: t }} />
            {settings.showPixelGrid && scale >= 4 ? <PixelGrid range={range} scale={scale} /> : null}
            {dropFrameId ? <DesignCanvasSelection document={draftDocument} scene={displayedScene}
              ids={[dropFrameId]} scale={scale} handles={false} /> : null}
            {!editingId && !dropPreview && !preview?.marquee ? <>
              {hoverOutlineId ? <DesignCanvasSelection document={draftDocument} scene={displayedScene}
                ids={[hoverOutlineId]} placements={placements} scale={scale} handles={false} outlineOpacity={0.55} /> : null}
              {showSelection ? <DesignCanvasSelection document={draftDocument} scene={displayedScene} ids={visibleIds}
                placements={placements} scale={scale} handles={tool === 'select' && !web.live && !controls.space && !controls.panning
                  && !straightPathId && !disabled && !croppingId && !layoutAdjustmentId && !gradientEdit} /> : null}
            </> : null}
            {layoutAdjustmentId && !dropPreview && !controls.space && !controls.panning && !preview?.marquee && !preview?.placements
              ? <DesignCanvasLayoutHandles id={layoutAdjustmentId} document={displayedDocument} scene={displayedScene} scale={scale}
                disabled={blocked} preview={liveLayout && shownLayout ? { ...liveLayout, layout: shownLayout } : undefined} /> : null}
            {preview?.marquee ? <Rect {...preview.marquee} listening={false} stroke={designSelectionColor} strokeWidth={1 / scale}
              fill={marqueeFill} /> : null}
            {drawing && !drawing.click ? <Group {...drawingPreview(drawing.bounds, drawingParent)} listening={false}>
              {drawingPath ? <Path data={drawingPath.data} lineCap={drawingPath.lineCap} lineJoin="round" stroke={designSelectionColor} strokeWidth={1 / scale} />
                : drawing.tool === 'ellipse' ? <Ellipse x={drawing.bounds.width / 2} y={drawing.bounds.height / 2}
                radiusX={drawing.bounds.width / 2} radiusY={drawing.bounds.height / 2} stroke={designSelectionColor}
                strokeWidth={1 / scale} /> : <Rect width={drawing.bounds.width}
                height={drawing.bounds.height} stroke={designSelectionColor} strokeWidth={1 / scale} />}
              <Group {...unreflect(drawing.bounds.width, drawing.bounds.height, {
                scaleX: drawingParent?.scaleX ?? 1, scaleY: drawingParent?.scaleY ?? 1,
              })}>
                <DimensionTag width={drawing.bounds.width} height={drawing.bounds.height} scale={scale} />
              </Group>
            </Group> : null}
            {pen.preview ? <DesignPathOverlay {...pen.preview} scale={scale} drawing
              showPath={!styledPen} pose={pen.preview.parentId === null ? undefined : scene[pen.preview.parentId]} /> : null}
            {pathEdit.overlay && !controls.panning && (pathEditingId || showEndpoints)
              ? <DesignPathOverlay {...pathEdit.overlay} endpoints={showEndpoints} scale={scale} /> : null}
            {(preview?.guides ?? pathEdit.guides)?.map((guide, index) => <Line key={`${guide.axis}:${index}`} listening={false}
              points={guide.points} stroke="#e05a9d" strokeWidth={1 / scale} dash={[4 / scale, 3 / scale]} />)}
          </Group>
        </Layer>
      </Stage>
      {gradientEdit ? <DesignCanvasGradient key={gradientEdit.key} {...gradientEdit.guides}
        viewport={viewport} surface={surface} disabled={blocked} translate={t} /> : null}
    </div>
    {webHost && webRequest ?
      <DesignWebPreview ref={webGuest} key={web.live ? `live:${webRequest.id}:${webRequest.node.url}` : `snapshot:${webRequest.id}:${webRequest.key}`}
        request={webRequest} session={web.live}
        viewport={viewport} size={size}
        expandedSize={{ width: expandedSize.width, height: Math.max(0, expandedSize.height - designWebToolbarHeight - designWebToolbarGap) }}
        host={webHost} reportFailure={web.reportFailure} onSnapshot={web.record} onNavigate={onWebNavigate} translate={t} /> : null}
    {webHost && web.exportCapture ? <DesignWebPreview key={`export:${web.exportCapture.request.id}:${web.exportCapture.request.key}`}
      request={web.exportCapture.request} viewport={viewport} size={size} expandedSize={expandedSize} host={webHost}
      reportFailure={false} onSnapshot={web.exportCapture.onSnapshot} onNavigate={onWebNavigate} translate={t} /> : null}
    {webToolbars}
    <div className="design-canvas__work-area" ref={workArea} aria-hidden="true" />
    {editingId ? renderTextInput(viewport) : null}
    <DesignZoomControls scale={scale} disabled={blocked} canZoomIn={scale < maxScale} canZoomOut={scale > minScale}
      canFit={document.rootIds.length > 0} canFitSelection={visibleIds.length > 0} onZoom={zoom} onFit={fit}
      onZoomTo={(level) => zoomAtCenter(() => level)} translate={t} />
  </div>;
});

function moveBrowserBox(box: DesignLayerBox, scene: DesignScene, placement: LayerPlacement | undefined, floating: Point | undefined) {
  if (!placement && !floating) return box;
  const parent = box.parentId ? scene[box.parentId] : undefined;
  const center = toWorld(box, { x: box.width / 2, y: box.height / 2 });
  const delta = floating ? { x: floating.x - center.x, y: floating.y - center.y }
    : toWorldVector(parent, { x: (placement?.x ?? box.x) - box.x, y: (placement?.y ?? box.y) - box.y });
  const shift = (bounds: Bounds) => ({ ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y });
  return { ...box, absoluteX: box.absoluteX + delta.x, absoluteY: box.absoluteY + delta.y,
    paintBounds: shift(box.paintBounds), visibleBounds: floating ? shift(box.paintBounds) : box.visibleBounds && shift(box.visibleBounds) };
}

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

function useCanvasSize(surface: React.RefObject<HTMLDivElement>, enabled = true): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = surface.current;
    if (!enabled || !element) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, surface]);
  return size;
}

function zoomViewport(current: CanvasViewport, anchor: Point, targetScale: number): CanvasViewport {
  const scale = Math.min(maxScale, Math.max(minScale, targetScale));
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
