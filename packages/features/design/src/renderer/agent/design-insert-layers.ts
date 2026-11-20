import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { maxDesignTreeDepth, parseDesignEdit, type DesignEdit } from '../../contracts/document.js';
import { designTaskRecord, maxDesignTaskEdits } from '../../contracts/design-task.js';
import { designDrawnVector, drawnDesignLayer, isSegmentDrawingTool } from '../canvas/design-shape-drawing.js';
import { diagnoseInsertFields, errorMessage, type LayerIssue } from './design-insert-validation.js';

const drawingTools = ['frame', 'rectangle', 'ellipse', 'text', 'web', 'script', 'line', 'arrow', 'polygon', 'star'] as const;

function insertLayer(fields: Record<string, unknown>, nodeId: string, parentId: string | null, translate: RendererTranslate) {
  const shape = drawingTools.find((tool) => tool === fields.kind);
  if (!shape && fields.kind !== 'image' && fields.kind !== 'vector') {
    throw new Error('Expected one of: ' + [...drawingTools, 'image', 'vector'].join(', ') + '.');
  }
  const bounds = { x: 0, y: 0, width: 128, height: 96 };
  const vector = shape && designDrawnVector(shape, { bounds, start: bounds, end: { x: bounds.width, y: bounds.height } }, true);
  const base = shape ? drawnDesignLayer(shape, vector?.bounds ?? bounds, parentId, true, vector?.geometry, translate, isSegmentDrawingTool(shape))
    : fields.kind === 'image' ? { ...bounds, fit: 'cover' } : bounds;
  const sizeMode = shape === 'text' && fields.width !== undefined ? { widthMode: 'fixed' } : undefined;
  const edit = parseDesignEdit({ kind: 'insert', nodeId, parentId, node: { ...base, ...sizeMode, ...fields, kind: vector ? 'vector' : fields.kind } });
  if (edit.kind !== 'insert') throw new Error('Expected a layer insertion.');
  for (const key of Object.keys(fields)) {
    if (shape === 'text' && ['height', 'heightMode', 'verticalAlign'].includes(key)) {
      throw new Error(key + ' is controlled by the text content. To center it vertically, place it inside a fixed-height frame with horizontal layout and align:"center".');
    }
    if (!Object.hasOwn(edit.node, key) && !['fill', 'fillOpacity', 'fillHidden', 'stroke'].includes(key)) {
      throw new Error('Unknown field "' + key + '" on ' + fields.kind + '.');
    }
  }
  if (edit.node.kind === 'frame' && edit.node.layout && fields.layout && typeof fields.layout === 'object') {
    const layout = edit.node.layout;
    const unknown = Object.keys(fields.layout).find((key) => !Object.hasOwn(layout, key));
    if (unknown) throw new Error('Unknown layout field "' + unknown + '".');
  }
  return edit;
}

export function planDesignLayerInsertion(fields: Record<string, unknown>, parentId: string | null, translate: RendererTranslate) {
  const edits: DesignEdit[] = [];
  const issues: LayerIssue[] = [];
  let omitted = 0;
  let length = 0;
  let visited = 0;
  function report(issue: LayerIssue) {
    length += JSON.stringify(issue).length + 1;
    if (length < 160_000) issues.push(issue);
    else omitted++;
  }
  function visit(input: unknown, parent: string | null, path: string, depth: number): string {
    if (++visited > maxDesignTaskEdits || depth > maxDesignTreeDepth) throw new Error(path + ': Layer tree exceeds the document limits.');
    const id = crypto.randomUUID();
    let record: Record<string, unknown>;
    try { record = designTaskRecord(input); }
    catch (error) { report({ path, message: errorMessage(error) }); return id; }
    const { children, ...layer } = record;
    const name = typeof layer.name === 'string' ? layer.name.slice(0, 120) : undefined;
    const fieldIssue = (key: string, message: string) => report({ path: path + '.' + key, layer: name, message });
    if (layer.layers !== undefined) {
      fieldIssue('layers', 'Use children for nested layers.');
      delete layer.layers;
    }
    if (layer.childIds !== undefined && !(Array.isArray(layer.childIds) && !layer.childIds.length)) {
      fieldIssue('childIds', 'Supply nested layers in children instead of childIds.');
      delete layer.childIds;
    }
    const validate = (candidate: Record<string, unknown>) => insertLayer(candidate, id, parent, translate);
    try { edits.push(validate(layer)); }
    catch (error) {
      const details = diagnoseInsertFields(layer, path, validate);
      for (const issue of details.length ? details : [{ path, message: errorMessage(error) }]) report({ ...issue, layer: name });
    }
    if (children !== undefined) {
      if (!Array.isArray(children) || layer.kind !== 'frame' || layer.instanceOf !== undefined) {
        fieldIssue('children', 'children must be an array on an editable frame.');
      }
      if (Array.isArray(children)) children.forEach((child, index) => visit(child, id, path + '.children[' + index + ']', depth + 1));
    }
    return id;
  }

  let ids: string[] = [];
  if (fields.layers === undefined) ids = [visit(fields, parentId, 'fields', 0)];
  else {
    for (const key of Object.keys(fields).filter((key) => key !== 'layers')) {
      report({ path: 'fields.' + key, message: 'Unexpected field alongside fields.layers. Put command options such as ids outside fields.' });
    }
    if (!Array.isArray(fields.layers) || !fields.layers.length) report({ path: 'fields.layers', message: 'Expected a non-empty array.' });
    else ids = fields.layers.map((layer, index) => visit(layer, parentId, 'fields.layers[' + index + ']', 0));
  }
  if (issues.length || omitted) throw new Error(JSON.stringify({ code: 'INVALID_LAYERS', applied: false, issues, ...(omitted ? { omitted } : {}) }));
  return { ids, edits };
}
