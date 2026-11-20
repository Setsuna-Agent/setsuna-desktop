import { createElement } from 'react';
import { designBrushPresets, designPencilPresets, type DesignEdit } from '../../contracts/index.js';
import { designTaskRecord, requestedDesignRootEdit } from '../../contracts/design-task.js';
import { parseDesignEdit, parseDesignStrokeStack } from '../../contracts/document.js';
import { parseDesignLibraryPath } from '../../contracts/design-resource-id.js';
import { defaultVariableCollectionId, designVariableCollections, planDesignVariableMove } from '../../contracts/design-variable-collections.js';
import { freehandDesignNode, clampDrawingWidth, type DrawingSample } from '../canvas/design-drawing.js';
import { convertDesignScript } from '../canvas/design-script-layers.js';
import { createDesignVariant, planDesignComponentInsertion } from '../components/design-library.js';
import { planDesignLibraryUnlink } from '../components/design-library-unlink.js';
import { dropDesignLayer } from '../design-canvas-edits.js';
import { planDesignTokenBindings } from './design-token-bindings.js';
import { planDesignLayerInsertion } from './design-insert-layers.js';
import { parseDesignClipboard, planClipboardPaste } from '../context/design-layer-clipboard.js';
import { toWorld } from '../design-geometry.js';
import { canDropDesignLayer, designLayerOrder } from '../design-layer-drop.js';
import { designDefaultColor } from '../../contracts/design-color.js';
import { readDesignSvg, insertDesignSvg } from '../vectors/design-svg-import.js';
import type { DesignSvgSource } from '../vectors/design-svg-source.js';
import { planDesignCommand, type DesignCommandContext } from './design-command.js';
import { lucideCatalog, textArg, type DesignEditorTools } from './design-editor-tools.js';

type Args = Record<string, unknown>;
function finite(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected a finite coordinate.');
  return value;
}
function drawing(fields: Args) {
  if (!Array.isArray(fields.points) || !fields.points.length || fields.points.length > 8192) throw new Error('Expected 1 to 8192 drawing samples.');
  const samples: DrawingSample[] = fields.points.map((item) => {
    const point = designTaskRecord(item);
    return { x: finite(point.x), y: finite(point.y), pressure: point.pressure === undefined ? undefined : finite(point.pressure) };
  });
  const ink = designTaskRecord(fields.ink);
  const preset = [...designBrushPresets, ...designPencilPresets].find((value) => value === ink.preset);
  if (!preset) throw new Error('Unknown drawing preset.');
  const color = textArg(ink.color, 'ink color');
  return freehandDesignNode([samples[0], ...samples.slice(1)], { preset, paint: { color }, width: clampDrawingWidth(finite(ink.width)) });
}

async function svgSource(fields: Args): Promise<DesignSvgSource> {
  if (fields.icon === undefined) return { markup: textArg(fields.markup, 'SVG markup') };
  const name = textArg(fields.icon, 'icon');
  const catalog = await lucideCatalog();
  if (!Object.hasOwn(catalog, name)) throw new Error('Unknown Lucide icon.');
  const [{ default: Icon }, { renderToStaticMarkup }] = await Promise.all([catalog[name](), import('react-dom/server')]);
  return { name, icon: name, color: designDefaultColor, markup: renderToStaticMarkup(createElement(Icon)) };
}

async function planSvg(fields: Args, parent: string | null, center: { x: number; y: number }, box: DesignCommandContext['scene'][string] | undefined, inLayout: boolean) {
  if (Object.keys(fields).some((key) => !['icon', 'markup', 'name', 'x', 'y', 'width', 'height', 'strokes'].includes(key))
    || (fields.icon !== undefined && fields.markup !== undefined)) throw new Error('Supply markup or icon and optional SVG placement fields.');
  const asset = await readDesignSvg(await svgSource(fields));
  return insertDesignSvg(asset, parent, center, box, 'SVG', {
    name: fields.name === undefined ? undefined : textArg(fields.name, 'SVG name'),
    x: fields.x === undefined ? undefined : finite(fields.x), y: fields.y === undefined ? undefined : finite(fields.y),
    width: fields.width === undefined ? undefined : finite(fields.width), height: fields.height === undefined ? undefined : finite(fields.height),
    strokes: fields.strokes === undefined ? undefined : parseDesignStrokeStack(fields.strokes),
    absolute: inLayout && (fields.x !== undefined || fields.y !== undefined) ? true : undefined,
  });
}

export async function planEditorCommand(view: DesignCommandContext, editor: DesignEditorTools | undefined, ids: readonly string[], args: Args,
  wholeDocument: boolean, permits: (id: string) => boolean, signal: AbortSignal): Promise<{ ids: readonly string[]; edits: readonly DesignEdit[] }> {
  const { document, projected, resources, scene } = view;
  const fields = args.fields === undefined ? {} : designTaskRecord(args.fields);
  const id = ids[0];
  const node = document.nodes[id];
  const parent = ids.length === 1 && node?.kind === 'frame' && !node.instanceOf && !scene[id]?.locked ? id : null;
  const rootEdit = requestedDesignRootEdit(args);
  const root = !ids.length && (wholeDocument || rootEdit === 'insert');
  const requireContainer = () => { if (!root && !parent) throw new Error('Choose one editable parent frame.'); };
  const requireLayer = () => { if (ids.length !== 1 || !node || scene[id]?.locked) throw new Error('Choose one editable layer.'); };
  const requireDocument = () => { if (!wholeDocument) throw new Error('Start a whole-document task to edit shared resources.'); };
  switch (args.action) {
    case 'bindTokens': {
      const explicit = args.ids === undefined ? undefined : new Set(ids);
      return planDesignTokenBindings(view, fields, ids, (target) => permits(target) && (!explicit || explicit.has(target)));
    }
    case 'paste':
    case 'replace': {
      if (args.action === 'replace') requireLayer(); else requireContainer();
      if (!editor) throw new Error('Clipboard unavailable.');
      const content = await editor.client.assets.output.readDesignLayers();
      signal.throwIfAborted();
      if (!content) throw new Error(editor.translate('feature.design.emptyClipboard'));
      const plan = planClipboardPaste({ copied: parseDesignClipboard(content), ...view, documentRef: editor.ref, selectedId: id ?? null,
        target: { id: id ?? null }, replace: args.action === 'replace', translate: editor.translate });
      if (!plan) throw new Error('Cannot paste into a locked frame.');
      return plan;
    }
    case 'insert': {
      requireContainer();
      if (!editor) throw new Error('Editor unavailable.');
      return planDesignLayerInsertion(fields, parent, editor.translate);
    }
    case 'createVariant': {
      requireLayer();
      const box = scene[id].paintBounds;
      const plan = createDesignVariant(document, id, textArg(fields.name, 'variant name'), { x: box.x + box.width + 24, y: box.y });
      if (!plan) throw new Error('Choose a component definition.');
      return { ids: [plan.id], edits: plan.edits };
    }
    case 'insertInstance': {
      requireContainer();
      const plan = editor && planDesignComponentInsertion({ ...view,
        sourceId: textArg(args.mode, 'source component'), target: root ? { root: true } : { selectedId: parent } });
      if (!plan || !plan.edits.some((edit) => edit.kind === 'insert' && edit.nodeId === plan.id && edit.parentId === parent)) {
        throw new Error('Component does not fit in the target.');
      }
      return { ids: [plan.id], edits: plan.edits };
    }
    case 'insertSvg': {
      requireContainer();
      const box = parent ? scene[parent] : undefined;
      const center = box ? toWorld(box, { x: box.width / 2, y: box.height / 2 }) : { x: 0, y: 0 };
      const inLayout = node?.kind === 'frame' && Boolean(node.layout);
      if (fields.icons === undefined) {
        const plan = await planSvg(fields, parent, center, box, inLayout);
        return { ids: [plan.id], edits: plan.edits };
      }
      if (Object.keys(fields).length !== 1 || !Array.isArray(fields.icons) || !fields.icons.length || fields.icons.length > 64) {
        throw new Error('Supply {icons:[{icon,x,y,...}, ...]} with 1 to 64 icons.');
      }
      const edits: DesignEdit[] = [];
      const ids: string[] = [];
      for (const [index, item] of fields.icons.entries()) {
        signal.throwIfAborted();
        try {
          const options = designTaskRecord(item);
          textArg(options.icon, 'icon name');
          const plan = await planSvg(options, parent, center, box, inLayout);
          ids.push(plan.id);
          edits.push(...plan.edits);
        } catch (error) {
          throw new Error('fields.icons[' + index + ']: ' + (error instanceof Error ? error.message : String(error)));
        }
      }
      return { ids, edits };
    }
    case 'freehand': {
      requireContainer();
      const nodeId = crypto.randomUUID();
      return { ids: [nodeId], edits: [parseDesignEdit({ kind: 'insert', nodeId, parentId: parent, node: drawing(fields) })] };
    }
    case 'convertScript': {
      requireLayer();
      const result = editor?.scripts.get(id);
      if (node.kind !== 'script' || !result) throw new Error('Script output is unavailable.');
      const plan = convertDesignScript(id, node, scene[id].parentId, result);
      return { ids: [plan.frameId], edits: plan.edits };
    }
    case 'reorder':
    case 'reparent': {
      requireLayer();
      const current = scene[id].parentId;
      const parentId = args.action === 'reorder' ? current : rootEdit === 'reparent' ? null : textArg(fields.parentId, 'destination parent');
      if ((parentId !== null && parentId !== current && !permits(parentId)) || !canDropDesignLayer(document, scene, id, parentId)) throw new Error('Invalid layer destination.');
      const beforeId = fields.beforeId == null ? null : textArg(fields.beforeId, 'sibling');
      if (beforeId && !designLayerOrder(document, parentId).ids.includes(beforeId)) throw new Error('Invalid sibling.');
      return { ids, edits: dropDesignLayer(document, scene, id, { parentId, beforeId }, projected) };
    }
    case 'setStyle': {
      requireDocument();
      if (fields.styles === undefined) return { ids: [], edits: [parseDesignEdit({ ...fields, kind: 'setStyle' })] };
      const entries = Object.entries(designTaskRecord(fields.styles));
      if (Object.keys(fields).length !== 1 || !entries.length || entries.length > 256) throw new Error('Supply fields.styles as a map of 1 to 256 style IDs to definitions.');
      const edits = entries.map(([styleId, style]) => {
        try { return parseDesignEdit({ kind: 'setStyle', styleId, style }); }
        catch (error) { throw new Error('fields.styles.' + styleId + ': ' + (error instanceof Error ? error.message : String(error))); }
      });
      return { ids: [], edits };
    }
    case 'setVariableCollection':
      requireDocument();
      return { ids: [], edits: [parseDesignEdit({ ...fields, kind: args.action })] };
    case 'moveVariable': {
      requireDocument();
      const styleId = textArg(fields.styleId, 'variable id');
      const collectionId = textArg(fields.collectionId, 'collection id');
      const style = document.styles?.[styleId];
      const collections = designVariableCollections(document.variableCollections);
      if (!style || style.kind === 'text' || !Object.hasOwn(collections, collectionId)) throw new Error('Invalid local variable or collection.');
      const source = collections[style.collectionId ?? defaultVariableCollectionId];
      return { ids: [], edits: planDesignVariableMove(styleId, style, source, { id: collectionId, collection: collections[collectionId] }) };
    }
    case 'linkLibrary':
    case 'unlinkLibrary': {
      requireDocument();
      const path = parseDesignLibraryPath(fields.path);
      if (args.action === 'unlinkLibrary') {
        const edits = planDesignLibraryUnlink(document, projected, resources, path);
        if (!edits) throw new Error('Library source unavailable.');
        return { ids: [], edits };
      }
      if (!editor) throw new Error('Library source unavailable.');
      const library = await editor.client.read({ ...editor.ref, path }, signal);
      return { ids: [], edits: [{ kind: 'linkLibrary', documentId: library.document.documentId, path }] };
    }
    default: return planDesignCommand(view, ids, args);
  }
}
