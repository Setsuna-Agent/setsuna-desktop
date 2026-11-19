import { Copy, Group, LibraryBig, Play, Redo2, Trash2, Undo2, Ungroup } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { Yoga } from 'yoga-layout/load';
import { IconButton, useToast } from '@setsuna-desktop/renderer-ui';
import { defaultDesignPolygonSides, designTextFill, type DesignContentOverride, type DesignDocument, type DesignEdit, type DesignNode, type DesignSnapshot, type DesignStyle } from '../contracts/index.js';
import { DesignCanvas, type CanvasViewport, type DesignCanvasHandle } from './DesignCanvas.js';
import type { DesignDocumentSurfaceProps } from './DesignDocumentSurface.js';
import { DesignImagePicker } from './DesignImagePicker.js';
import { DesignInspector, type ArtboardPreset, type DesignInspectorHandle } from './inspector/DesignInspector.js';
import { DesignLayers } from './DesignLayers.js';
import { DesignTextInput } from './DesignTextInput.js';
import { designToolForKey } from './DesignTools.js';
import { designInstanceContents, projectDesignComponents, withDesignInstanceContent } from './components/design-components.js';
import { designStyleChoices, type DesignLibraryResources } from './components/design-library-resources.js';
import { useDesignLibraryResources } from './components/use-design-library-resources.js';
import { DesignCanvasSettingsDialog, DesignLayerMenu } from './context/DesignLayerMenu.js';
import { useDesignCanvasSettings } from './context/design-canvas-settings.js';
import { canContainDesignLayers } from './context/design-layer-commands.js';
import { designLayerShortcut } from './context/design-layer-shortcuts.js';
import { useDesignLayerActions, type DesignLayerMenuTarget } from './context/use-design-layer-actions.js';
import {
  alignDesignLayers, alignDesignLayerToFrame, changeDesignLayout, dropDesignLayer, duplicateDesignLayers, isFlowChild, moveDesignLayer,
  movePositions, orderDesignBranches, planDesignLayerUpdate, transformDesignLayer,
} from './design-canvas-edits.js';
import { roundDesignValue, type Point } from './design-geometry.js';
import { clipboardDesignImage, importLocalDesignImage, useDesignImageLoader, type LoadDesignImage } from './design-images.js';
import { centerDesignLayer, resolveDesignInsertion, type DesignInsertionTarget } from './design-insertion.js';
import type { InspectorCanvasPreview } from './inspector/design-inspector-edit.js';
import type { DesignLayerDrag } from './design-layer-drop.js';
import { hasEditableLayout } from './design-layout-adjustment.js';
import { resolveDesignScene, type DesignScene } from './design-layout.js';
import { compositeDesignFill } from './design-paint.js';
import { designTextStyle, measureDesignText } from './design-text.js';
import { useDesignExports, type DesignExportRequest } from './export/use-design-exports.js';
import { toggleSelection, type CanvasAction, type DesignTool } from './use-design-canvas-gestures.js';
import { useDesignDocument } from './use-design-document.js';
import { DesignLibraryDialog } from './styles/DesignLibraryDialog.js';
import { DesignStyleContext } from './styles/DesignStyleSelect.js';
import { designPrototypeBoardFor, designPrototypeBoards } from './prototype/design-prototype.js';
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

const directions: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};
const DesignPrototypePreview = lazy(() => import('./prototype/DesignPrototypePreview.js'));

function isTextEntry(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

export default function DesignEditor({ layoutEngine, ...props }: DesignDocumentSurfaceProps & { layoutEngine: Yoga }) {
  const { client, documentRef } = props;
  const session = useDesignDocument(props);
  const source = session.snapshot?.document;
  const resources = useDesignLibraryResources(client, documentRef, source, props.watchAssetDirectories);
  const projected = useMemo(() => source ? projectDesignComponents(source, resources) : null, [resources, source]);
  const scene = useMemo(() => projected ? resolveDesignScene(layoutEngine, projected, measureDesignText) : null, [layoutEngine, projected]);
  const loadImage = useDesignImageLoader(client.assets, documentRef, projected, props.watchAssetDirectories);
  if (!session.snapshot || !scene || !projected) return null;
  return <OpenDesignEditor {...props} {...session} key={source?.documentId} snapshot={session.snapshot}
    projected={projected} resources={resources} scene={scene} layoutEngine={layoutEngine} loadImage={loadImage} />;
}

function OpenDesignEditor({ client, documentRef, translate: t, snapshot, busy, numbersBusy, editNumber, commit, navigate, currentRevision, projected, resources, scene, layoutEngine, loadImage, onOpenLibrary }:
  DesignDocumentSurfaceProps & ReturnType<typeof useDesignDocument> & { snapshot: DesignSnapshot; projected: DesignDocument;
    resources: DesignLibraryResources; scene: DesignScene; layoutEngine: Yoga; loadImage: LoadDesignImage },
) {
  const canvas = useRef<DesignCanvasHandle>(null);
  const inspector = useRef<DesignInspectorHandle>(null);
  const layerDrag = useRef<DesignLayerDrag>();
  const assetImport = useRef<AbortController>();
  const toast = useToast();
  const publishInspectorPreview = useCallback((value: InspectorCanvasPreview | undefined) => inspector.current?.preview(value), []);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [tool, setTool] = useState<DesignTool>('select');
  const [draft, setDraft] = useState<TextDraft | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const [imageTarget, setImageTarget] = useState<ImageTarget | null>(null);
  const [iconTarget, setIconTarget] = useState<AssetInsertTarget | null>(null);
  const [importingAsset, setImportingAsset] = useState(false);
  const [canvasAdjustment, setCanvasAdjustment] = useState<Readonly<{ kind: 'crop' | 'layout' | 'path'; id: string }>>();
  const [showLayers, setShowLayers] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [layerMenu, setLayerMenu] = useState<(DesignLayerMenuTarget & { revision: string }) | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [stylePreview, setStylePreview] = useState<{ styleId: string; color: string; revision: string }>();
  const [prototypeStart, setPrototypeStart] = useState<string>();
  const { settings, toggleSetting } = useDesignCanvasSettings();
  const exportActions = useDesignExports(client.assets.output, loadImage, t);
  const { document, revision, canUndo, canRedo } = snapshot;
  const localStyles = useMemo(() => {
    const original = stylePreview && document.styles?.[stylePreview.styleId];
    return showLibrary && stylePreview?.revision === revision && original?.kind === 'color'
      ? { ...document.styles, [stylePreview.styleId]: { ...original, color: stylePreview.color } satisfies DesignStyle }
      : document.styles;
  }, [document.styles, revision, showLibrary, stylePreview]);
  const canvasDocument = useMemo(() => localStyles === document.styles ? projected : projectDesignComponents({ ...document, styles: localStyles }, resources),
    [document, localStyles, projected, resources]);
  const styles = useMemo(() => designStyleChoices({ ...document, styles: localStyles }, resources), [document, localStyles, resources]);
  const styleCatalog = useMemo(() => ({ styles, libraries: document.libraries }), [document.libraries, styles]);
  const boards = useMemo(() => designPrototypeBoards(document, scene), [document, scene]);
  const selectedIds = selection.filter((id) => Object.hasOwn(document.nodes, id));
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const node = selectedId ? document.nodes[selectedId] : undefined;
  const box = selectedId ? scene[selectedId] : undefined;
  const parent = box?.parentId ? document.nodes[box.parentId] : undefined;
  const adjustment = canvasAdjustment?.id === selectedId ? canvasAdjustment : undefined;
  const croppingId = adjustment?.kind === 'crop' && node?.kind === 'image' && node.fit !== 'contain' && !box?.locked ? adjustment.id : undefined;
  const canAdjustLayout = hasEditableLayout(node) && Boolean(box?.visible && box.visibleBounds && !box.locked);
  const layoutAdjustmentId = adjustment?.kind === 'layout' && canAdjustLayout && tool === 'select' ? adjustment.id : undefined;
  const pathEditingId = adjustment?.kind === 'path' && isDesignPath(node) && tool === 'select' && box?.visible && !box.locked ? adjustment.id : undefined;
  const instanceId = node?.kind === 'frame' && node.instanceOf ? selectedId : null;
  const instanceContents = useMemo(() => instanceId ? designInstanceContents(projected, instanceId) : [], [instanceId, projected]);
  const imageLayer = imageTarget?.kind === 'replace' ? document.nodes[imageTarget.id]
    : imageTarget?.kind === 'override' ? projected.nodes[`${imageTarget.id}/${imageTarget.path}`] : undefined;
  useEffect(() => {
    if (canvasAdjustment && !croppingId && !layoutAdjustmentId && !pathEditingId) setCanvasAdjustment(undefined);
  }, [canvasAdjustment, croppingId, layoutAdjustmentId, pathEditingId]);
  useEffect(() => { if (imageTarget && imageTarget.revision !== revision) setImageTarget(null); }, [imageTarget, revision]);
  useEffect(() => { if (iconTarget && iconTarget.revision !== revision) setIconTarget(null); }, [iconTarget, revision]);
  useEffect(() => () => assetImport.current?.abort(), []);
  const { commands, components, branches, editable, canWrap } = useDesignLayerActions({
    document, projected, resources, scene, selectedIds, documentRef, output: client.assets.output, onOpenLibrary,
    getInsertionArea: () => canvas.current?.insertionArea(),
    commit: commitEdits, onSelect: setSelection, onLocate: locateLayer, translate: t,
  });
  const actions = commands();
  const canAlign = editable.length > 1 && editable.length === branches.length
    && editable.every((id) => scene[id].parentId === scene[editable[0]].parentId && !isFlowChild(document, scene, id));
  const canAlignInFrame = Boolean(selectedId && box?.parentId && !box.locked && !isFlowChild(document, scene, selectedId));
  const isGroup = Boolean(actions.ungroup);
  const editing = draft?.documentId === document.documentId && document.nodes[draft.nodeId]?.kind === 'text' ? draft : null;
  const controlsDisabled = busy || importingAsset || Boolean(editing);
  const activeLayerMenu = layerMenu?.revision === revision && !controlsDisabled ? layerMenu : null;
  const inspectorSelection = selectedId && node && box ? { id: selectedId, node, projectedNode: projected.nodes[selectedId],
    box, parent: parent?.kind === 'frame' ? parent : undefined } : undefined;
  const exportDisabled = controlsDisabled || exportActions.busy || !branches.some((id) => scene[id].visible);

  function commitEdits(edits: readonly DesignEdit[], base = revision): Promise<boolean> {
    return edits.length ? commit(edits, base) : Promise.resolve(false);
  }

  async function finishLayerDrop(id: string, edits: readonly DesignEdit[], base: string) {
    if (controlsDisabled || currentRevision() !== base) return false;
    const saved = await commitEdits(edits, base);
    if (saved) setSelection([id]);
    return saved;
  }

  function locateLayer(id: string) {
    setSelection([id]);
    setTool('select');
    setFitRequest((current) => current + 1);
  }

  function toggleCanvasAdjustment(kind: 'crop' | 'layout' | 'path') {
    if (!selectedId) return;
    const active = kind === 'crop' ? croppingId : kind === 'layout' ? layoutAdjustmentId : pathEditingId;
    setCanvasAdjustment(active ? undefined : { kind, id: selectedId });
    if (!active) setTool('select');
  }

  function openLayerMenu(target: DesignLayerMenuTarget) {
    if (controlsDisabled) return;
    if (target.id === null) setSelection([]);
    else if (!selectedIds.includes(target.id)) setSelection([target.id]);
    setLayerMenu({ ...target, revision });
  }

  function exportSelection(request: DesignExportRequest) {
    const ids = orderDesignBranches(document, branches);
    const name = node?.name?.trim() || (node?.kind === 'text' ? node.text.trim().split('\n', 1)[0] : '')
      || documentRef.path.split('/').at(-1)?.replace(/\.design\.json$/iu, '') || t('feature.design.layers');
    void exportActions.run({ document: projected, scene, ids }, name, request);
  }

  async function commitInsertion(nodeId: string, edits: readonly DesignEdit[], base: string) {
    if (!await commitEdits(edits, base)) return false;
    setSelection([nodeId]);
    setTool('select');
    return true;
  }

  async function insert(next: DesignNode, parentId: string | null, base = revision, fit = false) {
    const nodeId = crypto.randomUUID();
    if (!await commitInsertion(nodeId, [{ kind: 'insert', nodeId, parentId, node: next }], base)) return false;
    if (fit) setFitRequest((current) => current + 1);
    if (next.kind === 'text') {
      const savedRevision = currentRevision();
      if (savedRevision) setDraft({ documentId: document.documentId, nodeId, text: next.text, revision: savedRevision });
    }
    return true;
  }

  function addPreset(preset: ArtboardPreset) {
    const x = document.rootIds.reduce((edge, id) => Math.max(edge, scene[id].paintBounds.x + scene[id].paintBounds.width + 72), 0);
    void insert({ kind: 'frame', name: t(`feature.design.preset.${preset.id}`), x, y: 0,
      width: preset.width, height: preset.height, childIds: [] }, null, revision, true);
  }

  function drawLayer(action: Extract<CanvasAction, { kind: 'draw' }>, base: string) {
    const { parentId, tool: drawingTool, bounds, click } = action;
    const size = { x: roundDesignValue(bounds.x), y: roundDesignValue(bounds.y),
      width: Math.max(1, roundDesignValue(bounds.width)), height: Math.max(1, roundDesignValue(bounds.height)) };
    if (drawingTool === 'frame') return insert({
      ...size, kind: 'frame', name: t(parentId === null ? 'feature.design.artboard' : 'feature.design.frame'),
      width: click ? (parentId === null ? 960 : 280) : size.width,
      height: click ? (parentId === null ? 600 : 160) : size.height, childIds: [],
    }, parentId, base);
    if (drawingTool === 'text') return insert({
      kind: 'text', x: size.x, y: size.y, width: click ? 216 : Math.max(24, size.width),
      widthMode: click ? 'hug' : 'fixed', fontSize: 24, text: t('feature.design.text'),
    }, parentId, base);
    const appearance = { ...(click ? { ...size, width: 128, height: 96 } : size), fills: [{ color: '#b3adf5' }] };
    if (drawingTool === 'polygon') return insert({ ...appearance, kind: 'vector', geometry: { kind: 'polygon', sides: defaultDesignPolygonSides } }, parentId, base);
    return insert(drawingTool === 'ellipse'
      ? { kind: 'ellipse', ...appearance }
      : { kind: 'rectangle', ...appearance, cornerRadius: 0 }, parentId, base);
  }

  function assetInsertTarget(): AssetInsertTarget | undefined {
    const area = canvas.current?.insertionArea();
    return area && { ...resolveDesignInsertion(document, scene, area, selectedId), revision };
  }

  async function chooseImage(path: string, target = imageTarget) {
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
      return current.assetPath === path || commitEdits([{ kind: 'update', nodeId: target.id,
        node: { ...current, assetPath: path, crop: undefined } }], target.revision);
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
    if (event.defaultPrevented || controlsDisabled || imageTarget || iconTarget || activeLayerMenu || showSettings
      || showLibrary || prototypeStart || isTextEntry(event.target)) return;
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

  function saveBatch(nodes: ReadonlyMap<string, DesignNode>) {
    if (currentRevision() !== revision || ![...nodes.keys()].every((id) => selectedIds.includes(id) && !scene[id]?.locked)) {
      return Promise.resolve(false);
    }
    return commitEdits([...nodes].map(([nodeId, node]) => ({ kind: 'update', nodeId, node })));
  }

  async function duplicate() {
    const { edits, copies } = duplicateDesignLayers(document, scene, editable);
    if (await commitEdits(edits)) setSelection(copies);
  }

  function history(direction: 'undo' | 'redo') {
    if (direction === 'undo' ? canUndo : canRedo) void navigate(direction, revision);
  }

  function applyMove(placements: Readonly<Record<string, Point>>, base = revision) {
    return commitEdits(Object.entries(placements).flatMap(([id, placement]) => {
      const edit = moveDesignLayer(document, scene, id, placement);
      return edit ? [edit] : [];
    }), base);
  }

  function finishGesture(action: CanvasAction, base: string) {
    if (action.kind === 'draw') return drawLayer(action, base);
    if (action.kind === 'path') {
      if (currentRevision() !== base || action.parentId && scene[action.parentId]?.locked) return Promise.resolve(false);
      const { bounds, geometry } = fitDesignPath(action.anchors, action.closed);
      return insert({ kind: 'vector', ...bounds, geometry, fills: action.closed ? [{ color: '#b3adf5' }] : [],
        strokes: [{ color: designTextFill, width: 2, join: 'round' }] }, action.parentId, base);
    }
    if (action.kind === 'edit-path') {
      if (currentRevision() !== base || pathEditingId !== action.id || scene[action.id]?.locked) return Promise.resolve(false);
      return commitEdits([{ kind: 'update', nodeId: action.id, node: action.node }], base);
    }
    if (action.kind === 'move') return applyMove(action.placements, base);
    if (action.kind === 'drop') return finishLayerDrop(action.id, action.edits, base);
    if (action.kind === 'crop') {
      const image = document.nodes[action.id];
      if (currentRevision() !== base || image?.kind !== 'image' || image.fit === 'contain' || scene[action.id]?.locked) return Promise.resolve(false);
      return commitEdits([{ kind: 'update', nodeId: action.id, node: { ...image, crop: action.crop } }], base);
    }
    if (action.kind === 'layout') {
      const frame = document.nodes[action.id];
      if (layoutAdjustmentId !== action.id || currentRevision() !== base || !hasEditableLayout(frame) || scene[action.id]?.locked) {
        return Promise.resolve(false);
      }
      return commitEdits(changeDesignLayout(document, scene, action.id, frame, action.layout), base);
    }
    const node = transformDesignLayer(document, scene, action.id, action.placement);
    return node ? commitEdits(planDesignLayerUpdate(document, action.id, node, scene[action.id], resources), base) : Promise.resolve(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (controlsDisabled || iconTarget || activeLayerMenu || showSettings || showLibrary || prototypeStart
      || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const textEntry = isTextEntry(event.target);
    const layerCommand = designLayerShortcut(event);
    if (layerCommand === 'paste' && (imageTarget || !textEntry)) {
      event.preventDefault();
      event.stopPropagation();
      const target = imageTarget ? undefined : assetInsertTarget();
      // Native SVG formats may be hidden from the renderer's paste event.
      if (!event.repeat) void client.assets.requestClipboardPaste(Boolean(target)).then((result) => {
        if (result.kind === 'svg' && target) void importSvg({ markup: result.markup }, target);
        else if (result.kind === 'unavailable' && !imageTarget) actions.paste?.();
      }).catch((error: unknown) => {
        toast.error(t('feature.design.clipboardFailed', { error: error instanceof Error ? error.message : String(error) }));
      });
      return;
    }
    if (imageTarget || textEntry) return;
    const shortcut = event.key.toLowerCase();
    if (layerCommand) {
      const action = actions[layerCommand];
      if (!action) return;
      if (!event.repeat) action();
    } else if (event.metaKey || event.ctrlKey) {
      if (shortcut === 'z' || shortcut === 'y') history(shortcut === 'y' || event.shiftKey ? 'redo' : 'undo');
      else if (shortcut === 'd') void duplicate();
      else if (shortcut === 'a') {
        const order = parent?.kind === 'frame' ? parent.childIds : document.rootIds;
        setSelection(order.filter((id) => scene[id].visible && !scene[id].locked));
      } else return;
    } else if (shortcut === 'escape') {
      if (layoutAdjustmentId || pathEditingId) setCanvasAdjustment(undefined);
      else {
        setSelection([]);
        setTool('select');
      }
    } else if (shortcut === 'enter' && selectedId && node?.kind === 'text' && !box?.locked && box?.visible
      && event.target instanceof Element && event.target.closest('.design-editor__stage')) {
      setDraft({ documentId: document.documentId, nodeId: selectedId, text: node.text, revision });
    } else if (directions[event.key] && editable.length && editable.every((id) => !isFlowChild(document, scene, id))) {
      const direction = directions[event.key];
      const step = event.shiftKey ? 10 : 1;
      void applyMove(movePositions(scene, editable, { x: direction.x * step, y: direction.y * step }));
    } else {
      const next = designToolForKey(shortcut);
      if (!next || event.altKey) return;
      setTool(next);
    }
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
        color: fill === 'transparent' ? designTextFill : fill,
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

  return <DesignStyleContext.Provider value={styleCatalog}><section className="design-editor" aria-label={t('feature.design.workspace')} aria-busy={busy || importingAsset}
    onKeyDown={handleKeyDown} onPaste={handlePaste}>
    <div className="design-editor__toolbar" role="group" aria-label={t('feature.design.tools')}>
      <IconButton label={t('feature.design.undo')} size="small" disabled={controlsDisabled || !canUndo} onClick={() => history('undo')}><Undo2 size={16} /></IconButton>
      <IconButton label={t('feature.design.redo')} size="small" disabled={controlsDisabled || !canRedo} onClick={() => history('redo')}><Redo2 size={16} /></IconButton>
      <IconButton label={t('feature.design.library')} size="small" disabled={controlsDisabled}
        onClick={() => setShowLibrary(true)}><LibraryBig size={16} /></IconButton>
      <IconButton label={t('feature.design.prototype.preview')} size="small" disabled={controlsDisabled || !boards.length}
        onClick={() => {
          const board = designPrototypeBoardFor(selectedId, scene);
          setPrototypeStart(board && boards.includes(board) ? board : boards[0]);
        }}><Play size={15} /></IconButton>
      {editable.length ? <>
        <span className="design-editor__toolbar-divider" aria-hidden="true" />
        {isGroup || (canWrap && editable.length > 1) ? <IconButton
          label={t(isGroup ? 'feature.design.ungroup' : 'feature.design.groupSelection')} size="small"
          disabled={controlsDisabled} onClick={isGroup ? actions.ungroup : actions.group}>
          {isGroup ? <Ungroup size={16} /> : <Group size={16} />}
        </IconButton> : null}
        <IconButton label={t('feature.design.duplicate')} size="small" disabled={controlsDisabled}
          onClick={() => { void duplicate(); }}><Copy size={15} /></IconButton>
        <IconButton label={t('feature.design.delete')} size="small" disabled={controlsDisabled}
          onClick={actions.delete}><Trash2 size={15} /></IconButton>
      </> : null}
    </div>
    <div className="design-editor__body" data-layers={showLayers} data-inspector={showInspector}>
      <DesignLayers document={document} scene={scene} revision={revision} drag={layerDrag}
        open={showLayers} onTogglePanel={() => setShowLayers((visible) => !visible)}
        onContextMenu={openLayerMenu}
        selectedIds={selectedIds} disabled={controlsDisabled} onSelect={(id, additive) => setSelection((ids) =>
          additive ? toggleSelection(ids.filter((item) => Object.hasOwn(document.nodes, item)), id) : [id])}
        onToggle={(nodeId, flag) => { void commitEdits([{ kind: 'update', nodeId, node: {
          ...document.nodes[nodeId], [flag]: !document.nodes[nodeId][flag],
        } }]); }}
        onDrop={(id, destination, base) => finishLayerDrop(id, dropDesignLayer(document, scene, id, destination), base)}
        translate={t} />
      <DesignCanvas ref={canvas} document={document} projected={canvasDocument} resources={resources} scene={scene} layoutEngine={layoutEngine}
        revision={revision} layerDrag={layerDrag} onLayerDrop={finishLayerDrop} selectedIds={selectedIds} editingId={editing?.nodeId ?? null}
        croppingId={croppingId} layoutAdjustmentId={layoutAdjustmentId} pathEditingId={pathEditingId} onExitAdjustment={() => setCanvasAdjustment(undefined)}
        onInspectorPreview={publishInspectorPreview}
        onContextMenu={openLayerMenu} settings={settings}
        disabled={busy || importingAsset} fitRequest={fitRequest} loadImage={loadImage} tool={tool} onToolChange={setTool}
        onImage={() => {
          const target = assetInsertTarget();
          if (target) setImageTarget({ ...target, kind: 'insert' });
        }}
        onIcon={() => setIconTarget(assetInsertTarget() ?? null)}
        onSelect={setSelection} translate={t} onEditText={(nodeId, text) => {
          if (!controlsDisabled) setDraft({ documentId: document.documentId, nodeId, text: text.text, revision });
        }}
        onAction={finishGesture} renderTextInput={renderTextInput} />
      <DesignInspector ref={inspector} selection={inspectorSelection} selectedCount={selectedIds.length} revision={revision} numbersBusy={numbersBusy}
        open={showInspector} onTogglePanel={() => setShowInspector((visible) => !visible)}
        components={components} exportDisabled={exportDisabled} onExport={exportSelection}
        fillAssets={{ documentRef, assets: client.assets, loadImage, onImport: client.importImage }}
        numberEdits={{
          onNumberSave: (apply) => selectedId && !box?.locked ? editNumber(selectedId, apply, revision, resources) : Promise.resolve(false),
          onNumberPreview: (owner, apply) => { if (selectedId) canvas.current?.previewNumber(selectedId, owner, apply); },
        }}
        imageActions={{
          cropping: Boolean(croppingId),
          onReplace: () => { if (selectedId) setImageTarget({ kind: 'replace', id: selectedId, revision }); },
          onToggleCrop: () => toggleCanvasAdjustment('crop'),
        }}
        layoutAdjustment={canAdjustLayout ? { active: Boolean(layoutAdjustmentId), toggle: () => toggleCanvasAdjustment('layout') } : undefined}
        pathActions={isDesignPath(node) ? { active: Boolean(pathEditingId), toggle: () => toggleCanvasAdjustment('path') } : undefined}
        prototype={selectedId && node && boards.length ? {
          interaction: node.interaction,
          targets: boards.filter((id) => id !== designPrototypeBoardFor(selectedId, scene))
            .map((id) => ({ id, name: document.nodes[id].name || t('feature.design.artboard') })),
          onChange: (interaction) => { void commitEdits([{ kind: 'update', nodeId: selectedId, node: { ...node, interaction } }]); },
        } : undefined}
        instanceActions={instanceId ? {
          entries: instanceContents,
          onContent: (path, value) => saveInstanceContent(instanceId, path, value),
          onReplaceImage: (path) => setImageTarget({ kind: 'override', id: instanceId, path, revision }),
        } : undefined}
        batch={{
          layers: selectedIds.length > 1 ? selectedIds.filter((id) => !scene[id].locked).map((id) =>
            ({ id, node: document.nodes[id], opacity: projected.nodes[id].opacity ?? 1 })) : [],
          onSave: saveBatch,
          onPreview: (nodes) => { if (!nodes || currentRevision() === revision) canvas.current?.previewPaint(revision, nodes); },
        }}
        canAlign={canAlign || canAlignInFrame} canDistribute={canAlign && editable.length >= 3}
        disabled={controlsDisabled} translate={t} onAddPreset={addPreset}
        onAlign={(mode) => {
          if (selectedId && canAlignInFrame) void commitEdits(alignDesignLayerToFrame(document, scene, selectedId, mode));
          else if (canAlign) void commitEdits(alignDesignLayers(scene, editable, mode));
        }}
        onPaintPreview={(next) => {
          if (selectedId && (!next || currentRevision() === revision)) canvas.current?.previewPaint(revision, next ? new Map([[selectedId, next]]) : undefined);
        }}
        onSave={(next) => selectedId && currentRevision() === revision
          ? commitEdits([{ kind: 'update', nodeId: selectedId, node: next }]) : Promise.resolve(false)}
        onLayoutChange={(layout) => selectedId && node?.kind === 'frame' && !node.instanceOf && currentRevision() === revision
          ? commitEdits(changeDesignLayout(document, scene, selectedId, node, layout)) : Promise.resolve(false)} />
    </div>
    {imageTarget ? <DesignImagePicker documentRef={documentRef} assets={client.assets} loadImage={loadImage} translate={t}
      currentPath={imageLayer?.kind === 'image' ? imageLayer.assetPath : undefined}
      replacing={imageTarget.kind !== 'insert'} onClose={() => setImageTarget(null)}
      onImport={client.importImage} onInsert={chooseImage} /> : null}
    {iconTarget ? <DesignIconPicker translate={t} onInsert={(source) => importSvg(source, iconTarget)} onClose={() => setIconTarget(null)} /> : null}
    {activeLayerMenu ? <DesignLayerMenu
      point={activeLayerMenu.point} hasSelection={selectedIds.length > 0} actions={commands(activeLayerMenu)}
      onCopyPng={exportDisabled ? undefined : () => exportSelection({ kind: 'image', action: 'copy', scale: 1 })}
      onCopyHtml={exportDisabled ? undefined : () => exportSelection({ kind: 'code', action: 'copy', format: 'html' })}
      settings={settings} onToggle={toggleSetting} translate={t}
      onOpenSettings={() => setShowSettings(true)} onClose={() => setLayerMenu(null)} /> : null}
    {showSettings ? <DesignCanvasSettingsDialog settings={settings} onToggle={toggleSetting} translate={t}
      onClose={() => setShowSettings(false)} /> : null}
    {showLibrary ? <DesignLibraryDialog document={document} documentRef={documentRef} client={client} disabled={busy}
      onSetStyle={(styleId, style) => commitEdits([{ kind: 'setStyle', styleId, style }])}
      onPreviewColor={(styleId, color) => setStylePreview(color === undefined ? undefined : { styleId, color, revision })}
      onLink={(documentId, path) => commitEdits([{ kind: 'linkLibrary', documentId, path }])} onOpenLibrary={onOpenLibrary}
      onClose={() => { setStylePreview(undefined); setShowLibrary(false); }} translate={t} /> : null}
    {prototypeStart ? <Suspense fallback={null}>
      <DesignPrototypePreview start={prototypeStart} boards={boards} document={projected} scene={scene} loadImage={loadImage}
        onClose={() => setPrototypeStart(undefined)} translate={t} />
    </Suspense> : null}
  </section></DesignStyleContext.Provider>;
}
