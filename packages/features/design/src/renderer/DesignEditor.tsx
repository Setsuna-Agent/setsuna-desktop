import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type SetStateAction, type SyntheticEvent } from 'react';
import type { Yoga } from 'yoga-layout/load';
import { useToast } from '@setsuna-desktop/renderer-ui';
import type { DesignContentOverride, DesignDocument, DesignEdit, DesignNode, DesignScript, DesignStyle } from '../contracts/index.js';
import { designDefaultColor } from '../contracts/design-color.js';
import { maxDesignScriptBytes } from '../contracts/design-content-source.js';
import { designStylesForModes } from '../contracts/design-styles.js';
import { bindDesignVariable, defaultDesignImageCrop } from '../contracts/design-variables.js';
import { isStraightDesignPath } from '../contracts/vector-geometry.js';
import { defaultDrawingWidths, drawingInkTool, drawingPathNode, isDrawingInkTool, isFreehandTool, type DrawingInk, type DrawingInkTool, type DrawingPreview } from './canvas/design-drawing.js';
import { drawnDesignLayer } from './canvas/design-shape-drawing.js';
import { convertDesignScript, projectDesignScriptOutput, withDesignScriptInput } from './canvas/design-script-layers.js';
import { readDesignScriptFile, type DesignScriptSource } from './canvas/design-script-source.js';
import { useDesignScriptParameters } from './canvas/use-design-script-parameters.js';
import { useDesignScriptResults, type DesignScriptParameterPreview } from './canvas/use-design-script-results.js';
import type { DesignWebLayerControls } from './canvas/DesignWebToolbar.js';
import { useDesignChatPicks } from './agent/use-design-chat-picks.js';
import { DesignChatBridge } from './agent/DesignChatBridge.js';
import { useDesignAgentActivity } from './agent/use-design-agent-activity.js';
import { useDesignMcpCanvas } from './mcp/use-design-mcp-canvas.js';
import { DesignInspectorPresence, DesignPanelLayout } from './canvas/DesignSidePanels.js';
import { useDesignToolbarSlide } from './canvas/use-design-toolbar-slide.js';
import { DesignCanvas, type CanvasViewport, type DesignCanvasHandle } from './DesignCanvas.js';
import type { DesignDocumentSurfaceProps } from './DesignDocumentSurface.js';
import { DesignImagePicker } from './DesignImagePicker.js';
import { DesignInspector, type DesignInspectorHandle } from './inspector/DesignInspector.js';
import { DesignContentSourceFields } from './inspector/DesignContentSourceFields.js';
import type { DesignScriptParameterEdits } from './inspector/DesignScriptParameterFields.js';
import { DesignLayers } from './DesignLayers.js';
import { DesignTextInput } from './DesignTextInput.js';
import type { DesignToolPanel } from './DesignTools.js';
import { DesignToolbarActions } from './canvas/DesignToolbarActions.js';
import { designInstanceContents, projectDesignComponents, projectDesignSurface, withDesignInstanceContent } from './components/design-components.js';
import { planDesignComponentInsertion } from './components/design-library.js';
import { planDesignLibraryUnlink } from './components/design-library-unlink.js';
import { designLibraryDarkModes, designLibraryVariableCollections, designStyleChoices, type DesignLibraryResources } from './components/design-library-resources.js';
import { useDesignLibraryResources } from './components/use-design-library-resources.js';
import { DesignLayerMenu } from './context/DesignLayerMenu.js';
import { useDesignCanvasSettings, useDesignShortcuts } from './context/design-canvas-settings.js';
import { canContainDesignLayers } from './context/design-layer-commands.js';
import { designClipboardShortcut } from './context/design-layer-shortcuts.js';
import { useDesignLayerActions, type DesignLayerMenuTarget } from './context/use-design-layer-actions.js';
import {
  alignDesignLayers, alignDesignLayerToFrame, changeDesignLayout, dropDesignLayer, duplicateDesignLayers, isFlowChild, moveDesignLayer,
  movePositions, orderDesignBranches, planDesignLayerUpdate, transformDesignLayer,
} from './design-canvas-edits.js';
import type { Point } from './design-geometry.js';
import { clipboardDesignImage, importLocalDesignImage, useDesignImageLoader, type LoadDesignImage } from './design-images.js';
import { centerDesignLayer, designDrawingPlacement, resolveDesignInsertion, type DesignInsertionTarget } from './design-insertion.js';
import type { DesignNodeEdit, InspectorCanvasPreview, InspectorFieldEdits } from './inspector/design-inspector-edit.js';
import type { DesignComponentDrag, DesignLayerDrag } from './design-layer-drop.js';
import { hasEditableLayout } from './design-layout-adjustment.js';
import { resolveDesignScene, type DesignScene } from './design-layout.js';
import { compositeDesignFill, defaultDesignStroke } from './design-paint.js';
import { designTextStyle, measureDesignText } from './design-text.js';
import { designExportScriptIds } from './export/design-export-scene.js';
import { useDesignExports, type DesignExportRequest } from './export/use-design-exports.js';
import type { CaptureDesignWebImages } from './canvas/use-design-web-previews.js';
import { DesignShaderAssetsContext, useDesignShaderAssets } from './shaders/use-design-shader-assets.js';
import { toggleSelection, type CanvasAction, type DesignTool } from './use-design-canvas-gestures.js';
import { useDesignDocument, type DesignEditorSnapshot } from './use-design-document.js';
import { DesignLibraryPanel } from './styles/DesignLibraryPanel.js';
import { DesignBoardModes } from './styles/DesignBoardModes.js';
import { DesignGradientSessionProvider } from './styles/DesignGradientSession.js';
import { DesignStyleContext } from './styles/DesignStyleSelect.js';
import { DesignVariableTable } from './styles/DesignVariableTable.js';
import { designPrototypeBoardFor, designPrototypeBoards, designPrototypeHotspots } from './prototype/design-prototype.js';
import { DesignPrototypePreview } from './prototype/DesignPrototypePreview.js';
import { useDesignPrototypeSession } from './prototype/use-design-prototype-session.js';
import { DesignFontsContext, useDesignFonts, useDesignScriptFonts } from './text/use-design-fonts.js';
import { DesignIconPicker } from './vectors/DesignIconPicker.js';
import { clipboardDesignSvg, type DesignSvgSource } from './vectors/design-svg-source.js';
import { fitDesignPath, isDesignPath } from './vectors/design-vector.js';
import './design.css';

type TextDraft = Readonly<{ documentId: string; nodeId: string; text: string; revision: string }>;
type AssetInsertTarget = DesignInsertionTarget & Readonly<{ revision: string }>;
type ImageTarget = Readonly<{ revision: string }> & (
  | (AssetInsertTarget & Readonly<{ kind: 'insert' }>)
  | Readonly<{ kind: 'replace'; id: string }>
  | Readonly<{ kind: 'override'; id: string; path: string }>
);
type OpenToolPanel = Readonly<
  { kind: 'library' | 'variables' | 'audit' } | { kind: 'image'; target: Extract<ImageTarget, { kind: 'insert' }> } | { kind: 'icon'; target: AssetInsertTarget }
>;

const directions: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};
const DesignBoardAudit = lazy(() => import('./agent/DesignBoardAudit.js'));
const drawingPaint = { color: designDefaultColor };
const initialDrawingInks: Readonly<Record<DrawingInkTool, DrawingInk>> = {
  pen: { paint: drawingPaint, width: defaultDrawingWidths.pen },
  pencil: { paint: drawingPaint, width: defaultDrawingWidths.pencil, preset: 'smooth' },
  brush: { paint: drawingPaint, width: defaultDrawingWidths.brush, preset: 'tapered' },
};

function isTextEntry(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

function isEditorEvent({ target, currentTarget }: SyntheticEvent<HTMLElement>) {
  // Keep keyboard and clipboard commands in the active panel, including fullscreen chat controls.
  return target instanceof Element && currentTarget.contains(target)
    && !target.closest('.design-layers-chat, .design-panel-navigation, .design-editor__layers[data-fullscreen]');
}

export default function DesignEditor({ layoutEngine, ...props }: DesignDocumentSurfaceProps & { layoutEngine: Yoga }) {
  const { client, documentRef, libraryPreview } = props;
  const session = useDesignDocument(props);
  const source = session.snapshot?.document;
  const resources = useDesignLibraryResources(client, documentRef, source, session.watchAssetDirectories);
  const projected = useMemo(() => source ? projectDesignSurface(source, resources, libraryPreview) : null,
    [libraryPreview, resources, source]);
  const fonts = useDesignFonts(client.fonts, projected, props.translate);
  // Reflow auto-sized text once its actual faces are available to the canvas.
  const scene = useMemo(() => projected ? resolveDesignScene(layoutEngine, projected, measureDesignText) : null,
    [layoutEngine, projected, fonts.revision]);
  const loadImage = useDesignImageLoader(client.assets, documentRef, projected, session.watchAssetDirectories);
  const shaders = useDesignShaderAssets(client, documentRef, projected, session.watchAssetDirectories);
  if (!session.snapshot || !scene || !projected) return null;
  return <DesignFontsContext.Provider value={fonts}>
    <DesignShaderAssetsContext.Provider value={shaders}>
      <OpenDesignEditor {...props} {...session} key={session.snapshot.document.documentId} snapshot={session.snapshot}
        projected={projected} resources={resources} scene={scene} layoutEngine={layoutEngine} loadImage={loadImage} />
    </DesignShaderAssetsContext.Provider>
  </DesignFontsContext.Provider>;
}

function OpenDesignEditor({ client, documentRef, translate: t, snapshot, busy: documentBusy, synchronize, editFields, appendStroke, commit, navigate,
  currentRevision, projected, resources, scene, layoutEngine, loadImage, projects, linkedProjectId, chatActivity, renderChat, onFileAction, onOpenLibrary, onOpenPresetLibrary, watchAssetDirectories, libraryPreview, colorScheme, visible = true }:
  DesignDocumentSurfaceProps & ReturnType<typeof useDesignDocument> & { snapshot: DesignEditorSnapshot; projected: DesignDocument;
    resources: DesignLibraryResources; scene: DesignScene; layoutEngine: Yoga; loadImage: LoadDesignImage },
) {
  const fontCatalog = useContext(DesignFontsContext);
  const [fitRequest, setFitRequest] = useState<readonly string[] | null>(() => libraryPreview ? snapshot.document.rootIds : null);
  const { running: agentRunning, focus: agentFocus, setRunning: setAgentRunning, showFocus } = useDesignAgentActivity(chatActivity ? setFitRequest : undefined);
  const [agentNetworkAccess, setAgentNetworkAccess] = useState(false);
  const busy = documentBusy || agentRunning;
  const canvas = useRef<DesignCanvasHandle>(null);
  const inspector = useRef<DesignInspectorHandle>(null);
  const layerDrag = useRef<DesignLayerDrag>();
  const componentDrag = useRef<DesignComponentDrag>();
  const assetImport = useRef<AbortController>();
  const toast = useToast();
  const publishInspectorPreview = useCallback((value: InspectorCanvasPreview | undefined) => inspector.current?.preview(value), []);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [webMode, setWebMode] = useState<'inline' | 'expanded'>();
  const closeWeb = useCallback(() => {
    setWebMode(undefined);
    canvas.current?.focus();
  }, []);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const selectLayers = useCallback((next: SetStateAction<readonly string[]>) => {
    setSelection(next);
    setWebMode(undefined);
    setInspectorCollapsed(false);
  }, []);
  const [tool, setTool] = useState<DesignTool>('select');
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingInks, setDrawingInks] = useState(initialDrawingInks);
  const lastDrawingTool = useRef<DrawingInkTool>('pencil');
  const [draft, setDraft] = useState<TextDraft | null>(null);
  const [toolPanel, setToolPanel] = useState<OpenToolPanel>();
  const [importingAsset, setImportingAsset] = useState(false);
  const [canvasAdjustment, setCanvasAdjustment] = useState<Readonly<{ kind: 'crop' | 'layout' | 'path'; id: string }>>();
  const [showLayers, setShowLayers] = useState(!chatActivity);
  const [layerMenu, setLayerMenu] = useState<(DesignLayerMenuTarget & { revision: string }) | null>(null);
  const [variableCollectionKey, setVariableCollectionKey] = useState<string>();
  const [stylePreview, setStylePreview] = useState<{ styleId: string; style: DesignStyle; revision: string }>();
  const [scriptPreview, setScriptPreview] = useState<DesignScriptParameterPreview>();
  const { start: prototypeStart, play, close: closePrototype } = useDesignPrototypeSession(visible);
  const { settings, toggleSetting } = useDesignCanvasSettings();
  const { toolbarRef, captureToolbarPosition } = useDesignToolbarSlide(showLayers, visible && settings.toolbarPosition === 'top');
  const shortcuts = useDesignShortcuts(settings.shortcuts);
  const captureWebImages = useCallback<CaptureDesignWebImages>((layers, signal, networkAccess) =>
    canvas.current?.captureWebImages(layers, signal, networkAccess) ?? Promise.resolve(undefined), []);
  const exportActions = useDesignExports(client.assets.output, loadImage, t, captureWebImages);
  const { document, revision, canUndo, canRedo } = snapshot;
  const chatPicks = useDesignChatPicks(document, scene, {
    ref: documentRef,
    connect: chatActivity?.connectSelection,
    unavailable: () => toast.error(t('feature.design.selectionUnavailable')),
    show(ids) {
      selectLayers(ids);
      setTool('select');
      setFitRequest([...ids]);
      canvas.current?.focus();
    },
  });
  const showVariables = toolPanel?.kind === 'variables';
  const imageTarget = toolPanel?.kind === 'image' ? toolPanel.target : undefined;
  const activeStyle = (showVariables || toolPanel?.kind === 'library') && stylePreview?.revision === revision ? stylePreview : undefined;
  const canvasSource = useMemo(() => activeStyle
    ? { ...document, styles: { ...document.styles, [activeStyle.styleId]: activeStyle.style } } : document, [activeStyle, document]);
  const canvasDocument = useMemo(() => canvasSource === document ? projected : projectDesignComponents(canvasSource, resources),
    [canvasSource, document, projected, resources]);
  const canvasScene = useMemo(() => activeStyle && activeStyle.style.kind !== 'color'
    ? resolveDesignScene(layoutEngine, canvasDocument, measureDesignText) : scene, [activeStyle, canvasDocument, layoutEngine, scene]);
  const styles = useMemo(() => designStyleChoices(document, resources), [document, resources]);
  const openVariables = useCallback(() => {
    setStylePreview(undefined);
    setToolPanel({ kind: 'variables' });
  }, []);
  const styleCatalog = useMemo(() => ({
    styles, libraries: document.libraries, documentId: document.documentId,
    openVariables: () => { setVariableCollectionKey(document.documentId); openVariables(); },
    collectionNames: Object.fromEntries(designLibraryVariableCollections(document, resources).flatMap(({ key, collection }) =>
      collection.name ? [[key, collection.name]] : [])),
  }), [document, openVariables, resources, styles]);
  const boards = useMemo(() => designPrototypeBoards(document, scene), [document, scene]);
  const selectedIds = useMemo(() => {
    const existing = selection.filter((id) => Object.hasOwn(document.nodes, id));
    return existing.length === selection.length ? selection : existing;
  }, [document.nodes, selection]);
  const drawingInk = drawingMode && isDrawingInkTool(tool) ? drawingInks[tool] : undefined;
  const showInspector = selectedIds.length > 0 && !inspectorCollapsed && !drawingInk;
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const node = selectedId ? document.nodes[selectedId] : undefined;
  const box = selectedId ? scene[selectedId] : undefined;
  const scriptPath = showInspector && node?.kind === 'script' ? node.scriptPath : undefined;
  const activeScriptPreview = scriptPreview?.id === selectedId && scriptPreview.scriptPath === scriptPath && !box?.locked ? scriptPreview : undefined;
  const { current: currentScripts, pending: pendingScripts, rendered: renderedScripts } = useDesignScriptResults(
    client, documentRef, { document: projected, scene }, watchAssetDirectories, t,
    { document: canvasDocument, scene: canvasScene, preview: activeScriptPreview },
  );
  useDesignScriptFonts(renderedScripts);
  const projectOutput = useCallback(() => projectDesignScriptOutput(projected, scene, currentScripts, layoutEngine),
    [currentScripts, layoutEngine, projected, scene]);
  const prototypeOutput = useMemo(() => prototypeStart ? projectOutput() : undefined, [projectOutput, prototypeStart]);
  const scriptParameters = useDesignScriptParameters(client, documentRef, scriptPath, watchAssetDirectories);
  const webHost = client.assets.webPreview;
  const webSession = visible && !prototypeStart && selectedId && node?.kind === 'web' && node.url && box?.visible && !box.locked && webHost
    && webMode && tool === 'select' ? { id: selectedId, mode: webMode, close: closeWeb } : undefined;
  const boardId = designPrototypeBoardFor(selectedId, scene);
  const selectedBoard = boardId && boards.includes(boardId) ? boardId : undefined;
  const startBoard = document.prototypeStartId && boards.includes(document.prototypeStartId) ? document.prototypeStartId : selectedBoard ?? boards[0];
  const prototypeInteractive = useMemo(() => Boolean(startBoard && designPrototypeHotspots(projected, scene, startBoard).some(({ interaction }) =>
    'targetId' in interaction && interaction.targetId !== startBoard && boards.includes(interaction.targetId))), [boards, projected, scene, startBoard]);
  const board = boardId ? document.nodes[boardId] : undefined;
  const modes = board?.kind === 'frame' ? board.variableModeIds : undefined;
  const inspectorCatalog = useMemo(() => {
    if (!showInspector) return { ...styleCatalog, modeIds: undefined };
    const scopedModes = libraryPreview === 'dark' ? { ...designLibraryDarkModes(document), ...modes } : modes;
    const resolved = designStylesForModes(canvasDocument.styles, document.documentId, scopedModes);
    return { ...styleCatalog, modeIds: scopedModes, styles: styles && Object.fromEntries(Object.keys(styles).map((id) => [id, resolved?.[id] ?? styles[id]])) };
  }, [canvasDocument.styles, document, libraryPreview, modes, showInspector, styleCatalog, styles]);
  const parent = box?.parentId ? document.nodes[box.parentId] : undefined;
  const adjustment = canvasAdjustment?.id === selectedId ? canvasAdjustment : undefined;
  const croppingId = adjustment?.kind === 'crop' && node?.kind === 'image' && node.fit !== 'contain' && !box?.locked ? adjustment.id : undefined;
  const canAdjustLayout = hasEditableLayout(node) && Boolean(box?.visible && box.visibleBounds && !box.locked);
  const layoutAdjustmentId = adjustment?.kind === 'layout' && canAdjustLayout && tool === 'select' ? adjustment.id : undefined;
  const straightPath = isDesignPath(node) && isStraightDesignPath(node.geometry);
  const straightPathId = straightPath && tool === 'select' && box?.visible && box.visibleBounds && !box.locked ? selectedId ?? undefined : undefined;
  const pathEditingId = adjustment?.kind === 'path' && isDesignPath(node) && !straightPath && tool === 'select' && box?.visible && !box.locked
    ? adjustment.id : undefined;
  const instanceId = node?.kind === 'frame' && node.instanceOf ? selectedId : null;
  const instanceContents = useMemo(() => instanceId ? designInstanceContents(projected, instanceId) : [], [instanceId, projected]);
  useEffect(() => {
    if (canvasAdjustment && !croppingId && !layoutAdjustmentId && !pathEditingId) setCanvasAdjustment(undefined);
  }, [canvasAdjustment, croppingId, layoutAdjustmentId, pathEditingId]);
  useEffect(() => {
    if (toolPanel && 'target' in toolPanel && toolPanel.target.revision !== revision) {
      setToolPanel((current) => current === toolPanel ? undefined : current);
    }
  }, [toolPanel, revision]);
  useEffect(() => () => assetImport.current?.abort(), []);
  const inspectorLayerIds = libraryPreview ? selectedIds : selectedIds.filter((id) => !scene[id].locked);
  const fieldEdits = inspectorEdits();
  const { commands, components, branches, editable, canWrap } = useDesignLayerActions({
    document, projected, resources, scene, layoutEngine, selectedIds, documentRef, output: client.assets.output, onOpenLibrary,
    getInsertionArea: () => canvas.current?.insertionArea(),
    commit: commitEdits, fieldEdits, onSelect: selectLayers, onLocate: locateLayer, translate: t,
  });
  const actions = commands();
  const canAlign = editable.length > 1 && editable.length === branches.length
    && editable.every((id) => scene[id].parentId === scene[editable[0]].parentId && !isFlowChild(projected, scene, id));
  const canAlignInFrame = Boolean(selectedId && box?.parentId && !box.locked && !isFlowChild(projected, scene, selectedId));
  const editing = draft?.documentId === document.documentId && document.nodes[draft.nodeId]?.kind === 'text' ? draft : null;
  const canvasInteraction = documentBusy || importingAsset || editing || prototypeStart ? 'disabled' : libraryPreview ? 'inspect' : agentRunning ? 'navigate' : 'edit';
  const controlsDisabled = canvasInteraction !== 'edit';
  const activeLayerMenu = layerMenu?.revision === revision && !controlsDisabled ? layerMenu : null;
  const inspectorSelection = selectedId && node && box ? { id: selectedId, node, projectedNode: canvasDocument.nodes[selectedId],
    box, parent: parent?.kind === 'frame' ? parent : undefined, parentBox: box.parentId ? scene[box.parentId] : undefined } : undefined;
  const exportScripts = designExportScriptIds({ document: projected, scene, ids: branches });
  const exportDisabled = controlsDisabled || exportActions.busy || Boolean(activeScriptPreview)
    || exportScripts.some((id) => pendingScripts.has(id)) || !branches.some((id) => scene[id].visible);
  const documentExportIds = useMemo(() => projected.rootIds.filter((id) => scene[id]?.visible), [projected.rootIds, scene]);
  function changeTool(next: DesignTool) {
    if (next !== 'select') setWebMode(undefined);
    if (drawingMode && isDrawingInkTool(next)) lastDrawingTool.current = next;
    setTool(next);
  }

  function toggleDrawingMode() {
    setWebMode(undefined);
    setDrawingMode(!drawingMode);
    setTool(drawingMode ? 'select' : lastDrawingTool.current);
    setToolPanel(undefined);
  }

  function changeDrawingInk(next: DrawingInk) {
    if (!drawingMode || !isDrawingInkTool(tool)) return;
    setDrawingInks((inks) => ({ ...inks, [tool]: { ...next, preset: next.preset && drawingInkTool(next.preset) === tool
      ? next.preset : inks[tool].preset } }));
  }

  function commitEdits(edits: readonly DesignEdit[], base = revision): Promise<boolean> {
    return edits.length ? commit(edits, base) : Promise.resolve(false);
  }

  async function finishLayerDrop(id: string, edits: readonly DesignEdit[], base: string) {
    if (controlsDisabled || currentRevision() !== base) return false;
    const saved = await commitEdits(edits, base);
    if (saved) selectLayers([id]);
    return saved;
  }

  function locateLayer(id: string) {
    // A projected child has canvas bounds, but only its authored owner is selectable.
    let owner: string | null = id;
    while (owner && !Object.hasOwn(document.nodes, owner)) owner = scene[owner]?.parentId ?? null;
    if (!owner) return;
    selectLayers([owner]);
    setTool('select');
    setFitRequest([id]);
  }

  function toggleCanvasAdjustment(kind: 'crop' | 'layout' | 'path') {
    if (!selectedId) return;
    const active = kind === 'crop' ? croppingId : kind === 'layout' ? layoutAdjustmentId : pathEditingId;
    setCanvasAdjustment(active ? undefined : { kind, id: selectedId });
    if (!active) setTool('select');
  }

  function openLayerMenu(target: DesignLayerMenuTarget) {
    if (controlsDisabled) return;
    if (target.id === null) selectLayers([]);
    else if (!selectedIds.includes(target.id)) selectLayers([target.id]);
    setLayerMenu({ ...target, revision });
  }

  function exportSelection(request: DesignExportRequest, scope: 'selection' | 'document' = 'selection') {
    if (scope === 'selection' ? exportDisabled : controlsDisabled || exportActions.busy || !documentExportIds.length) return;
    const layerName = scope === 'selection' ? node?.name?.trim() || (node?.kind === 'text' ? node.text.trim().split('\n', 1)[0] : '') : undefined;
    const name = layerName || documentRef.path.split('/').at(-1)?.replace(/\.design\.json$/iu, '') || t('feature.design.layers');
    try {
      const selection = projectExport(scope === 'document' ? documentExportIds : branches);
      void exportActions.run(selection, name, request);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function commitInsertion(nodeId: string, edits: readonly DesignEdit[], base: string, keepTool = false) {
    if (!await commitEdits(edits, base)) return false;
    selectLayers([nodeId]);
    if (!keepTool) setTool('select');
    return true;
  }

  async function finishComponentDrop(sourceId: string, point: Point, base: string) {
    if (controlsDisabled || currentRevision() !== base || toolPanel?.kind !== 'library') return;
    const placement = planDesignComponentInsertion({ document, projected, resources, scene, layoutEngine, sourceId, target: { point } });
    if (placement && await commitInsertion(placement.id, placement.edits, base)) {
      setToolPanel((current) => current === toolPanel ? undefined : current);
    }
  }

  async function insert(next: DesignNode, parentId: string | null, base = revision, keepTool = false) {
    const nodeId = crypto.randomUUID();
    if (!await commitInsertion(nodeId, [{ kind: 'insert', nodeId, parentId, node: next }], base, keepTool)) return false;
    if (next.kind === 'text') {
      const savedRevision = currentRevision();
      if (savedRevision) setDraft({ documentId: document.documentId, nodeId, text: next.text, revision: savedRevision });
    }
    return true;
  }

  function drawLayer(action: Extract<CanvasAction, { kind: 'draw' }>, base: string) {
    const { tool: drawingTool, bounds, click, geometry } = action;
    const { parentId, placement: size } = designDrawingPlacement(projected, scene, action.parentId, bounds, click);
    return insert(drawnDesignLayer(drawingTool, size, parentId, click, geometry, t), parentId, base);
  }

  function assetInsertTarget(): AssetInsertTarget | undefined {
    const area = canvas.current?.insertionArea();
    return area && { ...resolveDesignInsertion(document, scene, area, selectedId), revision };
  }

  function changeToolPanel(kind: DesignToolPanel, open: boolean) {
    if (kind === 'variables' && open) { openVariables(); return; }
    if (open || toolPanel?.kind === kind) setStylePreview(undefined);
    if (!open) {
      setToolPanel((current) => current?.kind === kind ? undefined : current);
    } else if (kind === 'library' || kind === 'audit') {
      setToolPanel({ kind });
    } else {
      const target = assetInsertTarget();
      if (target) setToolPanel(kind === 'image' ? { kind, target: { ...target, kind: 'insert' } } : { kind, target });
    }
  }

  async function chooseImage(path: string, target: ImageTarget | undefined = imageTarget) {
    if (!target || currentRevision() !== target.revision) return false;
    const image = await loadImage(path);
    if (currentRevision() !== target.revision) return false;
    if (target.kind === 'override') {
      const imageLayer = projected.nodes[`${target.id}/${target.path}`];
      return (imageLayer?.kind === 'image' && imageLayer.assetPath === path)
        || saveInstanceContent(target.id, target.path, { kind: 'image', assetPath: path }, target.revision);
    }
    if (target.kind === 'replace') {
      const current = document.nodes[target.id];
      if (current?.kind !== 'image' || scene[target.id]?.locked) return false;
      const reset = bindDesignVariable(bindDesignVariable(current, 'crop.x', undefined), 'crop.y', undefined);
      return current.assetPath === path || commitEdits([{ kind: 'update', nodeId: target.id,
        node: { ...reset, assetPath: path, crop: undefined } }], target.revision);
    }
    const { parentId, center } = target;
    const frame = parentId ? scene[parentId] : undefined;
    if (parentId && (!frame || frame.locked || !canContainDesignLayers(document.nodes[parentId]))) return false;
    const scale = Math.min(1, 320 / image.naturalWidth, 240 / image.naturalHeight,
      frame ? frame.width / image.naturalWidth : Infinity, frame ? frame.height / image.naturalHeight : Infinity);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    return insert({
      kind: 'image', name: path.split('/').at(-1), assetPath: path, width, height,
      ...centerDesignLayer(center, { width, height }, frame),
    }, parentId, target.revision);
  }

  async function importAsset(task: (signal: AbortSignal) => Promise<boolean>) {
    if (assetImport.current) return false;
    const controller = new AbortController();
    const { signal } = controller;
    assetImport.current = controller;
    setImportingAsset(true);
    try {
      return await task(signal);
    } finally {
      assetImport.current = undefined;
      if (!signal.aborted) setImportingAsset(false);
    }
  }

  function assetTargetIsCurrent(target: { revision: string }) {
    if (currentRevision() === target.revision) return true;
    toast.error(t('feature.design.conflict'));
    return false;
  }

  function pasteImage(file: File, target: ImageTarget) {
    return importAsset(async (signal) => {
      let path: string | undefined;
      try {
        path = await importLocalDesignImage(file, { ref: documentRef, store: client.importImage, signal, translate: t });
        return !signal.aborted && assetTargetIsCurrent(target) && await chooseImage(path, target);
      } catch (error) {
        if (!signal.aborted) toast.error(path ? t('feature.design.loadImageFailed', { path })
          : error instanceof Error ? error.message : t('feature.design.importImageFailed', { path: file.name }));
        return false;
      }
    });
  }

  function importScript(input: File | DesignScriptSource, id: string, layer: DesignScript) {
    return importAsset(async (signal) => {
      let script: DesignScriptSource;
      try {
        script = 'source' in input ? input : await readDesignScriptFile(input);
      } catch {
        if (!signal.aborted) toast.error(t('feature.design.importScriptInvalid', { size: maxDesignScriptBytes / 1024 }));
        return false;
      }
      if (signal.aborted || !assetTargetIsCurrent({ revision })) return false;
      try {
        const scriptPath = await client.importScript({ ref: documentRef, ...script }, signal);
        return !signal.aborted && assetTargetIsCurrent({ revision })
          && await commitEdits([{ kind: 'update', nodeId: id, node: { ...layer, scriptPath, scriptInputs: undefined } }], revision);
      } catch {
        if (!signal.aborted) toast.error(t('feature.design.importScriptFailed', { name: script.name }));
        return false;
      }
    });
  }

  function importSvg(input: DesignSvgSource, target: AssetInsertTarget) {
    return importAsset(async (signal) => {
      try {
        const { readDesignSvg, insertDesignSvg } = await import('./vectors/design-svg-import.js');
        const svg = await readDesignSvg(input);
        if (signal.aborted || !assetTargetIsCurrent(target)) return false;
        const frame = target.parentId ? scene[target.parentId] : undefined;
        const { id, edits } = insertDesignSvg(svg, target.parentId, target.center, frame, t('feature.design.svg'));
        return await commitInsertion(id, edits, target.revision);
      } catch {
        if (!signal.aborted) toast.error(t('feature.design.importSvgFailed'));
        return false;
      }
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    if (event.defaultPrevented || controlsDisabled || activeLayerMenu || !isEditorEvent(event) || isTextEntry(event.target)) return;
    const svg = clipboardDesignSvg(event.clipboardData);
    const image = svg ? undefined : clipboardDesignImage(event.clipboardData);
    if (!svg && !image) {
      if (actions.paste) { event.preventDefault(); actions.paste(); }
      return;
    }
    const target = assetInsertTarget();
    if (!target) return;
    event.preventDefault();
    if (svg) void importSvg(svg, target);
    else if (image) void pasteImage(image, { ...target, kind: 'insert' });
  }

  function saveInstanceContent(id: string, path: string, value: DesignContentOverride | undefined, base = revision) {
    const instance = document.nodes[id];
    const child = projected.nodes[`${id}/${path}`];
    if (currentRevision() !== base || instance?.kind !== 'frame' || !instance.instanceOf || scene[id]?.locked
      || (child?.kind !== 'text' && child?.kind !== 'image') || (value && child.kind !== value.kind)) return Promise.resolve(false);
    if (!value && !Object.hasOwn(instance.contentOverrides ?? {}, path)) return Promise.resolve(true);
    return commitEdits([{ kind: 'update', nodeId: id, node: withDesignInstanceContent(instance, path, value) }], base);
  }

  function inspectorEdits(): InspectorFieldEdits {
    const updates = (apply: DesignNodeEdit) => new Map(inspectorLayerIds.map((id) => [id, apply]));
    return {
      onFieldSave: (apply) => inspectorLayerIds.length ? editFields(updates(apply), revision, { projected, scene }) : Promise.resolve(false),
      onFieldPreview: (owner, apply) => canvas.current?.previewFields(owner, apply && updates(apply)),
    };
  }

  async function duplicate() {
    const { edits, copies } = duplicateDesignLayers(document, scene, editable);
    if (await commitEdits(edits)) selectLayers(copies);
  }

  function history(direction: 'undo' | 'redo') {
    if (direction === 'undo' ? canUndo : canRedo) void navigate(direction, revision);
  }

  function applyMove(placements: Readonly<Record<string, Point>>, base = revision) {
    return commitEdits(Object.entries(placements).flatMap(([id, placement]) => {
      const edit = moveDesignLayer(document, scene, id, placement, projected);
      return edit ? [edit] : [];
    }), base);
  }

  async function saveFreehandStroke({ id, parentId, node }: DrawingPreview, base: string) {
    if (parentId && scene[parentId]?.locked) return false;
    const preset = node.geometry.freehand?.preset;
    const name = t(`feature.design.tool.${preset ? drawingInkTool(preset) : 'pencil'}`);
    const before = currentRevision();
    const saved = appendStroke({ kind: 'insert', nodeId: id, parentId, node: { ...node, name } }, base);
    if (currentRevision() !== before) selectLayers([id]);
    return saved;
  }

  function finishGesture(action: CanvasAction, base: string) {
    if (controlsDisabled) return Promise.resolve(false);
    if (action.kind === 'gradient') {
      return selectedId === action.id && !scene[action.id]?.locked && currentRevision() === base
        ? commitEdits([{ kind: 'update', nodeId: action.id, node: action.node }], base) : Promise.resolve(false);
    }
    if (action.kind === 'draw') return drawLayer(action, base);
    if (action.kind === 'path') {
      if (currentRevision() !== base || action.parentId && scene[action.parentId]?.locked) return Promise.resolve(false);
      if (drawingInk && tool === 'pen') {
        const path = drawingPathNode(action.anchors, action.closed, drawingInks.pen);
        const { parentId, placement } = designDrawingPlacement(projected, scene, action.parentId, path);
        return insert({ ...path, ...placement, name: t('feature.design.tool.pen') }, parentId, base, true);
      }
      const { bounds, geometry } = fitDesignPath(action.anchors, action.closed);
      const { parentId, placement } = designDrawingPlacement(projected, scene, action.parentId, bounds);
      return insert({ kind: 'vector', ...placement, geometry, strokes: [defaultDesignStroke] }, parentId, base);
    }
    if (action.kind === 'edit-path') {
      if (currentRevision() !== base || (pathEditingId ?? straightPathId) !== action.id || scene[action.id]?.locked) return Promise.resolve(false);
      return commitEdits([{ kind: 'update', nodeId: action.id, node: action.node }], base);
    }
    if (action.kind === 'move') return applyMove(action.placements, base);
    if (action.kind === 'drop') return finishLayerDrop(action.id, action.edits, base);
    if (action.kind === 'crop') {
      const image = document.nodes[action.id];
      const drawn = projected.nodes[action.id];
      if (currentRevision() !== base || image?.kind !== 'image' || image.fit === 'contain' || scene[action.id]?.locked) return Promise.resolve(false);
      const previous = drawn.kind === 'image' ? drawn.crop ?? defaultDesignImageCrop : defaultDesignImageCrop;
      const node = (['x', 'y'] as const).reduce((current, axis) => action.crop[axis] === previous[axis] ? current
        : bindDesignVariable(current, `crop.${axis}`, undefined, action.crop[axis]), image);
      return commitEdits([{ kind: 'update', nodeId: action.id, node }], base);
    }
    if (action.kind === 'layout') {
      const frame = document.nodes[action.id];
      if (layoutAdjustmentId !== action.id || currentRevision() !== base || !hasEditableLayout(frame) || scene[action.id]?.locked) {
        return Promise.resolve(false);
      }
      return commitEdits(changeDesignLayout(document, scene, action.id, frame, action.layout), base);
    }
    const node = transformDesignLayer(document, scene, action.id, action.placement, projected);
    return node ? commitEdits(planDesignLayerUpdate(document, action.id, node, { projected, scene }), base) : Promise.resolve(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!visible || canvasInteraction === 'disabled' || activeLayerMenu
      || event.defaultPrevented || event.nativeEvent.isComposing || !isEditorEvent(event)) return;
    if (isTextEntry(event.target)) return;
    const command = shortcuts.match(event.nativeEvent);
    const toolShortcut = command?.kind === 'tool' && (drawingMode || !isFreehandTool(command.tool)) ? command.tool : undefined;
    const layerCommand = designClipboardShortcut(event.nativeEvent) ?? (command?.kind === 'layer' ? command.layer : undefined);
    const navigationShortcut = !layerCommand && (toolShortcut === 'hand' || toolShortcut === 'select');
    if (controlsDisabled && !navigationShortcut && !(canvasInteraction === 'inspect' && event.key === 'Escape')) return;
    if (layerCommand === 'paste') {
      event.preventDefault();
      event.stopPropagation();
      const target = assetInsertTarget();
      // Native SVG formats may be hidden from the renderer's paste event.
      if (!event.repeat) void client.assets.requestClipboardPaste(Boolean(target)).then((result) => {
        if (result.kind === 'svg' && target) void importSvg({ markup: result.markup }, target);
        else if (result.kind === 'unavailable') actions.paste?.();
      }).catch((error: unknown) => {
        toast.error(t('feature.design.clipboardFailed', { error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }
    if (layerCommand) {
      const action = actions[layerCommand];
      if (!action) return;
      if (!event.repeat) action();
    } else if (command?.kind === 'editor') {
      if (command.id === 'image' && !drawingMode) {
        if (!event.repeat && toolPanel?.kind !== 'image') changeToolPanel('image', true);
      } else if (command.id === 'undo' || command.id === 'redo') history(command.id);
      else if (command.id === 'duplicate') void duplicate();
      else if (command.id === 'selectAll') {
        const order = parent?.kind === 'frame' ? parent.childIds : document.rootIds;
        selectLayers(order.filter((id) => scene[id].visible && !scene[id].locked));
      } else return;
    } else if (toolShortcut) {
      changeTool(toolShortcut);
    } else if (event.metaKey || event.ctrlKey) return;
    else if (event.key === 'Escape') {
      if (webSession) closeWeb();
      else if (layoutAdjustmentId || pathEditingId) setCanvasAdjustment(undefined);
      else if (drawingMode) toggleDrawingMode();
      else {
        selectLayers([]);
        setTool('select');
      }
    } else if (event.key === 'Enter' && selectedId && node?.kind === 'text' && !node.variableIds?.text && !box?.locked && box?.visible
      && event.target instanceof Element && event.target.closest('.design-editor__stage')) {
      setDraft({ documentId: document.documentId, nodeId: selectedId, text: node.text, revision });
    } else if (directions[event.key] && editable.length && editable.every((id) => !isFlowChild(projected, scene, id))) {
      const direction = directions[event.key];
      const step = event.shiftKey ? 10 : 1;
      void applyMove(movePositions(scene, editable, { x: direction.x * step, y: direction.y * step }));
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function renderTextInput(viewport: CanvasViewport) {
    if (!editing) return null;
    const textLayer = projected.nodes[editing.nodeId];
    const location = scene[editing.nodeId];
    if (textLayer.kind !== 'text') return null;
    const { scale } = viewport;
    const fill = compositeDesignFill(textLayer);
    const typography = designTextStyle(textLayer);
    return <DesignTextInput key={editing.nodeId} initialText={editing.text} label={t('feature.design.text')}
      autoWidth={textLayer.widthMode === 'hug'}
      style={{
        left: viewport.x + location.absoluteX * scale, top: viewport.y + location.absoluteY * scale,
        ...typography, width: Math.max(1, location.width * scale), fontSize: typography.fontSize * scale,
        letterSpacing: typography.letterSpacing * scale,
        transformOrigin: '0 0', transform: `rotate(${location.angle}deg) scale(${location.scaleX}, ${location.scaleY})`,
        color: fill === 'transparent' ? designDefaultColor : fill,
      }}
      onCancel={() => setDraft(null)}
      onCommit={async (text) => {
        if (text === editing.text || await commitEdits([{ kind: 'updateText', nodeId: editing.nodeId, text }], editing.revision)) {
          setDraft(null);
          return true;
        }
        const latest = currentRevision();
        if (latest && latest !== editing.revision) setDraft({ ...editing, revision: latest });
        return false;
      }}
    />;
  }

  const imagePicker = imageTarget ? <DesignImagePicker documentRef={documentRef} assets={client.assets} loadImage={loadImage} translate={t}
    onClose={() => changeToolPanel('image', false)} onImport={client.importImage} onInsert={chooseImage} /> : null;
  const scriptResult = selectedId && node?.kind === 'script' && !activeScriptPreview ? currentScripts.get(selectedId) : undefined;
  const scriptParameterEdits: DesignScriptParameterEdits | undefined = selectedId && scriptPath ? {
    parameters: scriptParameters,
    onPreview: (parameter, value, owner) => setScriptPreview((current) => value !== undefined
      ? { id: selectedId, scriptPath, parameter, value, owner } : current?.owner === owner ? undefined : current),
    onSave: (parameter, value) => editFields(new Map([[selectedId, (current) => {
      if (current.kind !== 'script' || current.scriptPath !== scriptPath) return current;
      const scriptInputs = withDesignScriptInput(current.scriptInputs, parameter, value);
      return scriptInputs === current.scriptInputs ? current : { ...current, scriptInputs };
    }]]), revision),
  } : undefined;
  const webDevices = webHost ? [
    { id: '', label: t('feature.design.webResponsive') },
    ...webHost.devices.map(({ id, label }) => ({ id, label: id === 'laptop' ? t('feature.design.webLaptop') : label })),
  ] : [];
  function webControlsFor(id: string): DesignWebLayerControls | undefined {
    const layer = document.nodes[id];
    if (!webHost || layer?.kind !== 'web' || !scene[id]?.visible) return;
    const mode = webSession?.id === id ? webSession.mode : undefined;
    return {
      mode, canBrowse: Boolean(layer.url), devices: webDevices,
      browse: () => {
        if (mode) { closeWeb(); return; }
        if (selectedId !== id) selectLayers([id]);
        setTool('select');
        setWebMode('inline');
      },
      expand: () => {
        setTool('select');
        setWebMode(mode === 'expanded' ? 'inline' : 'expanded');
      },
      save: (patch) => {
        if (mode && 'url' in patch && !patch.url) setWebMode(undefined);
        return editFields(new Map([[id, (current) => {
          if (current.kind !== 'web') return current;
          const next = { ...current, ...patch };
          return next.url === current.url && next.deviceId === current.deviceId ? current : next;
        }]]), revision);
      },
    };
  }
  const contentSource = selectedId && box && (node?.kind === 'web' || node?.kind === 'script') ? <DesignContentSourceFields
    key={selectedId} node={node} disabled={controlsDisabled || box.locked} translate={t}
    onSave={(next) => commitEdits([{ kind: 'update', nodeId: selectedId, node: next }])}
    web={webControlsFor(selectedId)}
    scriptParameters={scriptParameterEdits}
    onImport={node.kind === 'script' ? (script) => { void importScript(script, selectedId, node); } : undefined}
    onConvert={node.kind === 'script' && scriptResult ? () => {
      const { frameId, edits } = convertDesignScript(selectedId, node, box.parentId, scriptResult);
      void commitInsertion(frameId, edits, revision);
    } : undefined} /> : undefined;
  const previewStyle = (styleId: string, style: DesignStyle | undefined) => setStylePreview((current) => style ? { styleId, style, revision }
    : current?.styleId === styleId && current.revision === revision ? undefined : current);
  const toolPanelContent = showVariables ? <DesignVariableTable document={document} resources={resources} disabled={controlsDisabled}
    previewStyles={activeStyle ? canvasDocument.styles : undefined}
    selectedCollection={variableCollectionKey ?? document.documentId} onSelectCollection={setVariableCollectionKey} onCommit={commitEdits}
    onPreviewStyle={previewStyle}
    onOpenLibrary={onOpenLibrary} translate={t} />
    : toolPanel?.kind === 'audit' ? <Suspense fallback={null}>
      <DesignBoardAudit projected={projected} scene={scene} revision={revision} start={board?.kind === 'frame' ? boardId : undefined} translate={t}
        onLocate={locateLayer} />
    </Suspense>
    : toolPanel?.kind === 'library' ? <DesignLibraryPanel document={document} documentRef={documentRef} client={client} sources={canvasDocument.styles}
      componentPreviews={{ projected, resources, layoutEngine, loadImage }}
      components={components.library} componentDrag={componentDrag} revision={revision} colorScheme={colorScheme} watchDirectories={watchAssetDirectories}
      disabled={controlsDisabled} onSetStyle={(styleId, style) => commitEdits([{ kind: 'setStyle', styleId, style }])}
      onPreviewStyle={previewStyle}
      onOpenLibrary={onOpenLibrary} translate={t}
      onOpenPresetLibrary={onOpenPresetLibrary && ((source) => { setToolPanel(undefined); onOpenPresetLibrary(source); })}
      onLink={(documentId, path) => commitEdits([{ kind: 'linkLibrary', documentId, path }], currentRevision() ?? revision)}
      onUnlink={(path) => {
        const edits = planDesignLibraryUnlink(document, projected, resources, path);
        if (edits) return commitEdits(edits);
        toast.error(t('feature.design.unlinkLibraryUnavailable'));
        return Promise.resolve(false);
      }} />
      : toolPanel?.kind === 'icon' ? <DesignIconPicker translate={t} onInsert={(source) => importSvg(source, toolPanel.target)}
        onClose={() => changeToolPanel('icon', false)} /> : imagePicker;

  function projectExport(ids: readonly string[], networkAccess?: boolean) {
    if (designExportScriptIds({ document: projected, scene, ids }).some((id) => !currentScripts.has(id))) throw new Error(t('feature.design.scriptFailed'));
    return { ...projectOutput(), networkAccess, ids: orderDesignBranches(projected, ids) };
  }
  const designView = { document, projected, resources, scene, layoutEngine,
    preview: (ids: readonly string[], signal: AbortSignal, network = false) => exportActions.preview(projectExport(ids, network), signal) };
  const mcp = useDesignMcpCanvas(visible, { ...designView, name: documentRef.path.split('/').at(-1)!, selection: selectedIds });
  const bridge = !libraryPreview && (renderChat || chatActivity) && client.tasks ? <DesignChatBridge client={client.tasks}
    canvasRequest={chatActivity?.request} renderChat={renderChat && ((binding) => renderChat(binding, linkedProjectId))}
    subscribePicks={chatPicks.subscribePicks} reveal={chatPicks.reveal}
    owner={{ ref: documentRef, documentId: document.documentId }} selection={selectedIds} synchronize={synchronize}
    disabled={documentBusy || importingAsset || Boolean(editing)} onRunning={(running) => { setAgentNetworkAccess(false); setAgentRunning(running); }}
    view={{ ...designView, showFocus, setNetworkAccess: setAgentNetworkAccess,
      editor: { client, ref: documentRef, projects, settings, toggleSetting, completeFileAction: onFileAction, scripts: currentScripts,
        translate: t, canvas: () => canvas.current, select: selectLayers, refreshFonts: () => fontCatalog?.updateCatalog() ?? Promise.resolve(),
        deliver: (ids, request, signal, network) => exportActions.deliver(projectExport(ids, network), document.nodes[ids[0]]?.name ?? documentRef.path.split('/').at(-1)!, request, signal) },
    }} /> : undefined;

  function playPrototype(board: string) {
    setToolPanel(undefined);
    setLayerMenu(null);
    play(board);
  }

  const selectionActions = editable.length ? { group: canWrap && editable.length > 1 ? actions.group : undefined,
    ungroup: actions.ungroup, duplicate: () => { void duplicate(); }, delete: actions.delete } : undefined;
  const toolbarActions = <DesignToolbarActions visible={visible} shortcuts={shortcuts} disabled={controlsDisabled}
    history={{ undo: canUndo, redo: canRedo }} onHistory={history} translate={t}
    publication={libraryPreview ? undefined : { client, documentRef, documentId: document.documentId, layout: layoutEngine, synchronize,
      exportDocument: !exportActions.busy && documentExportIds.length ? (request) => exportSelection(request, 'document') : undefined }}
    prototype={{ interactive: prototypeInteractive, play: startBoard ? () => playPrototype(startBoard) : undefined }} />;
  return <DesignStyleContext.Provider value={styleCatalog}><DesignGradientSessionProvider>
    <section className="design-editor" aria-label={t('feature.design.workspace')} aria-busy={busy || importingAsset}
    onKeyDown={handleKeyDown} onPaste={handlePaste} onPointerDownCapture={mcp.activate} onFocusCapture={mcp.activate}>
    {chatActivity && bridge}
    <DesignPanelLayout layersOpen={showLayers} inspectorOpen={showInspector} hasChat={Boolean(renderChat && bridge)} toolbarPosition={settings.toolbarPosition}>
      <DesignLayers document={document} projected={projected} scene={scene} loadImage={loadImage} revision={revision} drag={layerDrag}
        chat={renderChat && bridge} open={showLayers} onTogglePanel={() => { captureToolbarPosition(); setShowLayers((open) => !open); }}
        showThumbnails={settings.showLayerThumbnails} onContextMenu={openLayerMenu} onHoverLayer={(id) => canvas.current?.highlightLayer(id)}
        selectedIds={selectedIds} disabled={controlsDisabled} onSelect={(id, additive) => selectLayers((ids) =>
          additive ? toggleSelection(ids.filter((item) => Object.hasOwn(document.nodes, item)), id) : [id])}
        onToggle={(nodeId, flag) => {
          const source = document.nodes[nodeId];
          const next = flag === 'hidden' ? bindDesignVariable(source, 'hidden', undefined, !projected.nodes[nodeId].hidden)
            : { ...source, locked: !source.locked };
          void commitEdits([{ kind: 'update', nodeId, node: next }]);
        }}
        onDrop={(id, destination, base) => finishLayerDrop(id, dropDesignLayer(document, scene, id, destination, projected), base)}
        translate={t} />
      <DesignCanvas ref={canvas} toolbarRef={toolbarRef} document={canvasSource} projected={canvasDocument} resources={resources} scene={canvasScene} layoutEngine={layoutEngine}
        revision={revision} layerDrag={layerDrag} onLayerDrop={finishLayerDrop} componentDrag={componentDrag} onComponentDrop={finishComponentDrop}
        selectedIds={selectedIds} agentFocus={agentFocus} externalFocus={mcp.focus} scriptResults={renderedScripts} webHost={webHost} webSession={webSession}
        automaticWebAccess={!libraryPreview && visible && (agentRunning ? agentNetworkAccess : chatActivity?.networkAccess ?? true)}
        webControlsFor={webControlsFor} editingId={editing?.nodeId ?? null}
        croppingId={croppingId} layoutAdjustmentId={layoutAdjustmentId} pathEditingId={pathEditingId} straightPathId={straightPathId}
        onExitAdjustment={() => setCanvasAdjustment(undefined)} onInspectorPreview={publishInspectorPreview}
        onContextMenu={openLayerMenu} settings={settings} shortcuts={shortcuts}
        interaction={canvasInteraction} fitRequest={fitRequest} loadImage={loadImage} tool={tool} onToolChange={changeTool}
        drawing={{ enabled: drawingMode, ink: drawingInk, disabled: importingAsset || busy,
          revision: snapshot.drawingRevision, onToggle: toggleDrawingMode, onChangeInk: changeDrawingInk, onCommit: saveFreehandStroke }}
        libraryPreview={Boolean(libraryPreview)} toolbarActions={toolbarActions} selectionActions={selectionActions}
        toolPanels={{ active: visible ? toolPanel?.kind : undefined, content: toolPanelContent, onOpenChange: changeToolPanel }}
        onSelect={selectLayers} beginPick={chatPicks.beginPick} translate={t} onEditText={(nodeId, text) => {
          if (!controlsDisabled && !text.variableIds?.text) setDraft({ documentId: document.documentId, nodeId, text: text.text, revision });
        }}
        onAction={finishGesture} renderTextInput={renderTextInput} />
      <DesignInspectorPresence>{showInspector ? <DesignStyleContext.Provider value={inspectorCatalog}><DesignInspector ref={inspector} selection={inspectorSelection} selectedCount={selectedIds.length} revision={revision}
        onClose={() => {
          setInspectorCollapsed(true);
          canvas.current?.focus();
        }}
        components={components} contentSource={contentSource} onAddLayout={actions.addLayout} exportDisabled={exportDisabled} onExport={exportSelection}
        boardModes={selectedId && boardId === selectedId && node?.kind === 'frame' && !node.group
          ? <DesignBoardModes modeIds={inspectorCatalog.modeIds} document={document} resources={resources} disabled={controlsDisabled || Boolean(box?.locked)}
            fieldEdits={fieldEdits} translate={t} /> : null}
        paintAssets={{ documentRef, assets: client.assets, loadImage, onImport: client.importImage }}
        fieldEdits={fieldEdits}
        imageActions={{
          cropping: Boolean(croppingId),
          onReplace: (path) => selectedId ? chooseImage(path, { kind: 'replace', id: selectedId, revision }) : Promise.resolve(false),
          onToggleCrop: () => toggleCanvasAdjustment('crop'),
        }}
        layoutAdjustment={canAdjustLayout ? { active: Boolean(layoutAdjustmentId), toggle: () => toggleCanvasAdjustment('layout') } : undefined}
        pathActions={isDesignPath(node) && !straightPath ? { active: Boolean(pathEditingId), toggle: () => toggleCanvasAdjustment('path') } : undefined}
        prototype={selectedId && node && boards.length ? {
          interaction: node.interaction,
          targets: boards.filter((id) => id !== boardId)
            .map((id) => ({ id, name: document.nodes[id].name || t('feature.design.artboard') })),
          onPlayBoard: selectedBoard ? () => playPrototype(selectedBoard) : undefined,
          start: selectedId === selectedBoard ? { selected: document.prototypeStartId === selectedId,
            toggle: () => { void commitEdits([{ kind: 'setPrototypeStart', boardId: document.prototypeStartId === selectedId ? null : selectedId }]); } } : undefined,
          onChange: (interaction) => { void commitEdits([{ kind: 'update', nodeId: selectedId, node: { ...node, interaction } }]); },
        } : undefined}
        instanceActions={instanceId ? {
          entries: instanceContents,
          onContent: (path, value) => saveInstanceContent(instanceId, path, value),
          onReplaceImage: (path, assetPath) => chooseImage(assetPath, { kind: 'override', id: instanceId, path, revision }),
        } : undefined}
        batch={selectedIds.length > 1 ? inspectorLayerIds.map((id) =>
          ({ id, node: document.nodes[id], opacity: projected.nodes[id].opacity ?? 1 })) : []}
        canAlign={canAlign || canAlignInFrame} canDistribute={canAlign && editable.length >= 3}
        disabled={controlsDisabled} translate={t}
        onAlign={(mode) => {
          if (selectedId && canAlignInFrame) void commitEdits(alignDesignLayerToFrame(document, scene, selectedId, mode, projected));
          else if (canAlign) void commitEdits(alignDesignLayers(document, scene, editable, mode));
        }}
        onPaintPreview={(next) => {
          if (selectedId && (!next || currentRevision() === revision)) canvas.current?.previewPaint(revision, next ? new Map([[selectedId, next]]) : undefined);
        }}
        onSave={(next) => selectedId && currentRevision() === revision
          ? commitEdits([{ kind: 'update', nodeId: selectedId, node: next }]) : Promise.resolve(false)}
        onLayoutChange={(layout) => selectedId && node?.kind === 'frame' && !node.instanceOf && currentRevision() === revision
          ? commitEdits(changeDesignLayout(document, scene, selectedId, node, layout)) : Promise.resolve(false)} /></DesignStyleContext.Provider> : null}</DesignInspectorPresence>
    </DesignPanelLayout>
    {activeLayerMenu ? <DesignLayerMenu
      point={activeLayerMenu.point} hasSelection={selectedIds.length > 0} actions={commands(activeLayerMenu)} components={components}
      onCopyPng={exportDisabled ? undefined : () => exportSelection({ kind: 'image', action: 'copy', scale: 1 })}
      onCopyHtml={exportDisabled ? undefined : () => exportSelection({ kind: 'code', action: 'copy', format: 'html' })}
      settings={settings} shortcuts={shortcuts} onToggle={toggleSetting} translate={t}
      onClose={() => setLayerMenu(null)} /> : null}
  </section>
  {prototypeStart && prototypeOutput ? <DesignPrototypePreview start={prototypeStart} boards={boards} {...prototypeOutput}
    loadImage={loadImage} captureWebImages={captureWebImages} onClose={closePrototype} translate={t} /> : null}
  </DesignGradientSessionProvider></DesignStyleContext.Provider>;
}
