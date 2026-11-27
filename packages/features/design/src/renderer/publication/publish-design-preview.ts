import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { Yoga } from 'yoga-layout/load';
import { isDesignPrototypeBoard, type DesignDocument } from '../../contracts/document.js';
import { maxDesignPreviewLayerNameLength } from '../../contracts/design-preview-layers.js';
import { designPreviewVariantCount, maxDesignPreviewFrames } from '../../contracts/design-preview-variables.js';
import type { DesignDocumentRef, DesignSnapshot } from '../../contracts/operations.js';
import { maxDesignPreviewBoardBytes, maxDesignPreviewBoards, maxDesignPreviewBytes, maxDesignPreviewEdge, maxDesignPreviewPixels,
  type DesignPreviewAccess, type DesignPreviewFrame, type DesignPublicationBridge } from '../../contracts/design-publication.js';
import { projectDesignScriptLayers } from '../canvas/design-script-layers.js';
import type { DesignClient } from '../client.js';
import { projectDesignSurface } from '../components/design-components.js';
import { buildDesignLibraryResources } from '../components/design-library-resources.js';
import { readDesignLibraryFiles, type DesignLibraryFiles } from '../components/read-design-library-files.js';
import { roundDesignValue } from '../design-geometry.js';
import { decodeDesignImage } from '../design-images.js';
import { resolveDesignScene, type DesignScene } from '../design-layout.js';
import { measureDesignText } from '../design-text.js';
import { designArtboardPaintLayerIds, designExportFontRequests, designExportImagePaths, designExportScriptIds, designExportShaderPaths,
  type DesignExportSelection } from '../export/design-export-scene.js';
import { designPrototypeBoards } from '../prototype/design-prototype.js';
import { createDesignPreviewFontLoader } from '../text/design-font-loader.js';
import { designPreviewLayerTree } from './design-preview-layer-tree.js';
import { createPreviewVariableCatalog, designPreviewBoardModes, designPreviewModeVariants } from './design-preview-variables.js';

const maxDecodedImagePixels = 64_000_000;
type PreviewClient = Pick<DesignClient, 'resolveResourceRoot' | 'read' | 'renderPreviewScript' | 'readShader' | 'assets' | 'fonts'>;
type PreviewBridge = Pick<DesignPublicationBridge, 'beginPreview' | 'appendPreviewBoard' | 'appendPreviewVariant' | 'publishPreview' | 'cancelPreview'>;
type ScriptCache = { rendered: Map<string, DesignDocument>; revisions: Map<string, string> };

export async function publishDesignPreview(client: PreviewClient, bridge: PreviewBridge, documentRef: DesignDocumentRef,
  snapshot: DesignSnapshot, layout: Yoga, access: DesignPreviewAccess, signal: AbortSignal, t: RendererTranslate) {
  const { document: authored, revision } = snapshot;
  const ref = await client.resolveResourceRoot(documentRef, signal);
  const files = await readDesignLibraryFiles(client, ref, authored.documentId, Object.entries(authored.libraries ?? {}), signal);
  signal.throwIfAborted();
  const libraries = [...files.values()].map(({ snapshot }) => snapshot.document);
  for (const design of [authored, ...libraries]) assertLibraryLinks(design, authored.documentId, ref.path, files, t);
  const resources = buildDesignLibraryResources(authored.documentId, libraries);
  const projected = projectDesignSurface(authored, resources);
  const roots = projected.rootIds.filter((id) => isDesignPrototypeBoard(projected.nodes[id]) && !projected.nodes[id].hidden);
  if (!roots.length) throw new Error(t('feature.design.publication.noBoards'));
  if (roots.length > maxDesignPreviewBoards) throw new Error(t('feature.design.publication.previewTooLarge'));
  const fonts = createDesignPreviewFontLoader(client.fonts);
  const scriptCache: ScriptCache = { rendered: new Map(), revisions: new Map() };

  async function captureScene(document: DesignDocument, ids: readonly string[], scene: DesignScene) {
    const selection = { document, scene, ids };
    const scripts = await renderScripts(client, ref, { ...selection, paintedLayerIds: designArtboardPaintLayerIds(selection) }, scriptCache, signal, t);
    if (!scripts.size) return { document, scene };
    const captured = projectDesignScriptLayers(document, scripts);
    await fonts.load(designExportFontRequests({ document: captured, ids }), signal);
    return { document: captured, scene: resolveDesignScene(layout, captured, measureDesignText, { rootIds: ids }) };
  }

  let ticket: string | undefined;
  const cancel = () => ticket ? bridge.cancelPreview(ticket).catch(() => undefined) : Promise.resolve();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await fonts.load(designExportFontRequests({ document: projected, ids: roots }), signal);
    const scene = resolveDesignScene(layout, projected, measureDesignText, { rootIds: roots });
    const ids = designPrototypeBoards(projected, scene);
    const catalog = createPreviewVariableCatalog(authored, resources, files, t);
    const plans = ids.map((id) => catalog && designPreviewBoardModes(authored, resources, id, catalog));
    if (plans.reduce((total, plan) => total + designPreviewVariantCount(plan), 0) > maxDesignPreviewFrames) {
      throw new Error(t('feature.design.publication.previewTooLarge'));
    }
    const layerKeys = plans.map((plan) => plan?.axes.length ? new Map<string, number>() : undefined);
    const base = await captureScene(projected, ids, scene);
    const boards = ids.map((id, index) => {
      const name = projected.nodes[id].name?.trim().slice(0, maxDesignPreviewLayerNameLength) || t('feature.design.artboard');
      const frame = previewFrame(projected, base.scene, id, name, layerKeys[index]);
      if (frame.hidden) throw new Error(t('feature.design.publication.emptyBoard'));
      return { name, ...frame, modes: plans[index] };
    });
    const start = Math.max(0, ids.indexOf(authored.prototypeStartId ?? ''));
    const { renderDesignPreviewPng } = await import('../export/export-design-png.js');
    signal.throwIfAborted();
    const publication = await bridge.beginPreview({ ref: documentRef, documentId: authored.documentId, revision, access, boards, start,
      variables: catalog?.data });
    ticket = publication;
    const loadAssets = previewAssetLoader(client, ref, signal, t);
    let bytes = 0;
    async function renderFrame(capture: Awaited<ReturnType<typeof captureScene>>, id: string, frame: DesignPreviewFrame) {
      signal.throwIfAborted();
      const artboard = { ...capture, ids: [id] };
      const selection = { ...artboard, paintedLayerIds: designArtboardPaintLayerIds(artboard) };
      const { images, shaders } = frame.hidden ? { images: new Map(), shaders: new Map() } : await loadAssets(selection);
      signal.throwIfAborted();
      const image = await renderDesignPreviewPng(selection, id, frame, images, shaders);
      bytes += image.size;
      if (image.size > maxDesignPreviewBoardBytes || bytes > maxDesignPreviewBytes) {
        throw new Error(t('feature.design.publication.previewTooLarge'));
      }
      const png = await image.arrayBuffer();
      signal.throwIfAborted();
      return png;
    }
    for (const [index, id] of ids.entries()) await bridge.appendPreviewBoard(publication, index, await renderFrame(base, id, boards[index]));
    for (const [index, id] of ids.entries()) {
      const board = boards[index];
      const source = authored.nodes[id];
      if (!catalog || !board.modes || source.kind !== 'frame') continue;
      // Layout and capture run in the authoring process against the same frozen inputs as the original frame.
      for (const { index: variant, modes } of designPreviewModeVariants(source, board.modes, catalog)) {
        signal.throwIfAborted();
        const variantDocument = projectDesignSurface({ ...authored, rootIds: [id],
          nodes: { ...authored.nodes, [id]: { ...source, variableModeIds: modes } } }, resources);
        await fonts.load(designExportFontRequests({ document: variantDocument, ids: [id] }), signal);
        const variantScene = resolveDesignScene(layout, variantDocument, measureDesignText, { rootIds: [id] });
        const captured = await captureScene(variantDocument, [id], variantScene);
        const frame = previewFrame(variantDocument, captured.scene, id, board.name, layerKeys[index]);
        await bridge.appendPreviewVariant(publication, index, variant, frame, await renderFrame(captured, id, frame));
      }
    }
    const version = await client.read(ref, signal);
    if (version.document.documentId !== authored.documentId || version.revision !== revision) throw new Error(t('feature.design.publication.changed'));
    for (const { path, snapshot } of files.values()) {
      const current = await client.read({ ...ref, path }, signal);
      if (current.revision !== snapshot.revision || current.document.documentId !== snapshot.document.documentId) {
        throw new Error(t('feature.design.publication.changed'));
      }
    }
    signal.throwIfAborted();
    const published = await bridge.publishPreview(ticket);
    ticket = undefined;
    return published;
  } finally {
    signal.removeEventListener('abort', cancel);
    fonts.dispose();
    await cancel();
  }
}

function assertLibraryLinks(document: DesignDocument, owner: string, entry: string, files: DesignLibraryFiles, t: RendererTranslate) {
  for (const [id, path] of Object.entries(document.libraries ?? {})) {
    if ((id === owner ? entry : files.get(id)?.path) !== path) throw new Error(t('feature.design.publication.libraryUnavailable', { path }));
  }
}

async function renderScripts(client: Pick<PreviewClient, 'renderPreviewScript'>, ref: DesignDocumentRef, selection: DesignExportSelection,
  { rendered, revisions }: ScriptCache, signal: AbortSignal, t: RendererTranslate) {
  const results = new Map<string, DesignDocument>();
  for (const id of designExportScriptIds(selection)) {
    signal.throwIfAborted();
    const node = selection.document.nodes[id];
    if (node.kind !== 'script' || !node.scriptPath) continue;
    const box = selection.scene[id];
    const input = { scriptPath: node.scriptPath, inputs: node.scriptInputs,
      width: Math.max(0.01, roundDesignValue(box.width)), height: Math.max(0.01, roundDesignValue(box.height)) };
    const key = JSON.stringify(input);
    let output = rendered.get(key);
    if (!output) {
      const capture = await client.renderPreviewScript({ ...input, ref }, signal);
      const previous = revisions.get(node.scriptPath);
      if (previous !== undefined && previous !== capture.sourceRevision) throw new Error(t('feature.design.publication.changed'));
      revisions.set(node.scriptPath, capture.sourceRevision);
      output = capture.document;
      rendered.set(key, output);
    }
    results.set(id, output);
  }
  return results;
}

function previewFrame(document: DesignDocument, scene: DesignScene, id: string, name: string,
  keys?: Map<string, number>): DesignPreviewFrame {
  const box = scene[id];
  const hidden = !box.visible || box.width <= 0 || box.height <= 0;
  return { ...(hidden ? { width: 1, height: 1 } : previewSize(box)),
    flipX: box.scaleX < 0 ? true : undefined, flipY: box.scaleY < 0 ? true : undefined, hidden: hidden ? true : undefined,
    layers: designPreviewLayerTree(document, scene, id, name, keys) };
}

function previewSize(bounds: { width: number; height: number }) {
  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  const ratio = Math.min(1, maxDesignPreviewEdge / Math.max(width, height), Math.sqrt(maxDesignPreviewPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}

function previewAssetLoader(client: Pick<PreviewClient, 'assets' | 'readShader'>, ref: DesignDocumentRef, signal: AbortSignal, t: RendererTranslate) {
  // Freeze each asset once across the publication. Decoded images live only as long as their artboard render.
  const imageSources = new Map<string, string>();
  const shaderSources = new Map<string, string>();
  let sourceBytes = 0;
  return async (selection: DesignExportSelection) => {
    let pixels = 0;
    const images = new Map<string, HTMLImageElement>();
    for (const path of designExportImagePaths(selection)) {
      signal.throwIfAborted();
      let source = imageSources.get(path);
      if (!source) {
        const file = await client.assets.read(ref, path);
        if (!file) throw new Error(t('feature.design.publication.imageUnavailable', { path }));
        sourceBytes += Math.ceil(file.base64.length * 3 / 4);
        if (sourceBytes > maxDesignPreviewBytes) throw new Error(t('feature.design.publication.previewTooLarge'));
        source = `data:${file.mimeType};base64,${file.base64}`;
        imageSources.set(path, source);
      }
      signal.throwIfAborted();
      const image = await decodeDesignImage(source);
      pixels += image.naturalWidth * image.naturalHeight;
      if (pixels > maxDecodedImagePixels) throw new Error(t('feature.design.publication.previewTooLarge'));
      images.set(path, image);
    }
    const shaders = new Map<string, string>();
    for (const path of designExportShaderPaths(selection)) {
      signal.throwIfAborted();
      const source = shaderSources.get(path) ?? await client.readShader({ ...ref, shaderPath: path }, signal);
      shaderSources.set(path, source);
      shaders.set(path, source);
    }
    return { images, shaders };
  };
}
