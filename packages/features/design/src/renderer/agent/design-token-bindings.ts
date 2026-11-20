import type { DesignNode, DesignStyle } from '../../contracts/document.js';
import { designTaskRecord, maxDesignTaskEdits } from '../../contracts/design-task.js';
import { designStylesForModes, designTypographyOf } from '../../contracts/design-styles.js';
import { bindDesignVariable, designLayerVariableFields, designLayoutVariableFields, designTypographyVariableFields,
  designVariableFieldValue, validDesignWidthLimits, type DesignVariableField, type DesignVariableTarget } from '../../contracts/design-variables.js';
import { rebaseDesignTextRuns } from '../../contracts/design-text-runs.js';
import { designStyleChoices } from '../components/design-library-resources.js';
import { designPadding } from '../design-layout.js';
import { designFills, hasDesignCorners } from '../design-paint.js';
import { designPrototypeBoardFor } from '../prototype/design-prototype.js';
import type { DesignCommandContext } from './design-command.js';
import { planDesignLayerUpdates } from './design-layer-updates.js';

type Binding = { field: string; tokenId: string };

function scalar<T extends DesignVariableTarget>(target: T, field: DesignVariableField, id: string, style: DesignStyle): T {
  if (target.variableIds?.[field] === id) return target;
  const value = designVariableFieldValue(field, style);
  if (value === undefined) throw new Error('Token is incompatible with ' + field);
  return bindDesignVariable(target, field, id, value);
}

function bindField(node: DesignNode, { field, tokenId }: Binding, style: DesignStyle): DesignNode {
  if (field === 'textStyleId' && node.kind === 'text' && style.kind === 'text') {
    if (node.textStyleId === tokenId) return node;
    const typography = designTypographyOf(style.typography);
    for (const key of designTypographyVariableFields) {
      if (node.variableIds?.[key]) Object.assign(typography, { [key]: node[key] });
    }
    return { ...node, ...typography, textStyleId: tokenId };
  }
  const layoutField = designLayoutVariableFields.find((key) => field === 'layout.' + key);
  if (layoutField && node.kind === 'frame' && node.layout) {
    const layout = layoutField.startsWith('paddingSides.') && !node.layout.paddingSides
      ? { ...node.layout, paddingSides: designPadding(node.layout) } : node.layout;
    const next = scalar(layout, layoutField, tokenId, style);
    return next === node.layout ? node : { ...node, layout: next };
  }
  const property = designLayerVariableFields(node.kind, node.kind === 'vector' ? node.geometry : undefined).find((key) => key === field);
  if (property) {
    if (node.variableIds?.[property] === tokenId) return node;
    if (property.startsWith('cornerRadii.') && hasDesignCorners(node) && !node.cornerRadii) {
      const radius = node.cornerRadius ?? 0;
      node = { ...node, cornerRadii: [radius, radius, radius, radius] };
    }
    // Resolve both limits before checking their relationship, since one batch may move both.
    if (property === 'minWidth' || property === 'maxWidth') {
      const value = designVariableFieldValue(property, style);
      if (typeof value !== 'number') throw new Error('Token is incompatible with ' + property);
      return { ...bindDesignVariable(node, property, tokenId), [property]: value };
    }
    let next = scalar(node, property, tokenId, style);
    if (property === 'width') next = { ...next, widthMode: 'fixed' };
    if (property === 'height' && next.kind !== 'text') next = { ...next, heightMode: 'fixed' };
    if (property === 'text' && node.kind === 'text' && next.kind === 'text') {
      return { ...next, runs: rebaseDesignTextRuns(node.text, next.text, node.runs) };
    }
    return next;
  }
  if (field === 'shadow.color' && node.shadow && style.kind === 'color') {
    if (node.shadow.styleId === tokenId) return node;
    return { ...node, shadow: { ...node.shadow, color: style.color, styleId: tokenId } };
  }
  const paint = /^(fills|strokes)\.(\d+)\.color$/u.exec(field);
  if (paint && style.kind === 'color') {
    const index = Number(paint[2]);
    const colors = { styleId: tokenId, color: style.color };
    if (paint[1] === 'fills' && node.kind !== 'image') {
      const fills = [...designFills(node)];
      if (!fills.length && index === 0) return { ...node, fills: [colors] };
      if (fills[index] && !fills[index].gradient && !fills[index].image && !fills[index].shader) {
        if (fills[index].styleId === tokenId) return node;
        fills[index] = { ...fills[index], ...colors };
        return { ...node, fills };
      }
    } else if (paint[1] === 'strokes' && node.strokes?.[index]) {
      const strokes = [...node.strokes];
      if (!strokes[index].gradient && !strokes[index].image && !strokes[index].shader) {
        if (strokes[index].styleId === tokenId) return node;
        strokes[index] = { ...strokes[index], ...colors };
        return { ...node, strokes };
      }
    }
  }
  throw new Error('Invalid token target ' + field + ' on ' + node.kind);
}

export function planDesignTokenBindings(view: DesignCommandContext, fields: Record<string, unknown>, defaults: readonly string[],
  permits: (id: string) => boolean) {
  if (!Array.isArray(fields.bindings) || !fields.bindings.length) throw new Error('Expected a non-empty bindings array.');
  const byLayer = new Map<string, Map<string, string>>();
  let count = 0;
  for (const item of fields.bindings) {
    const { ids = defaults, field, tokenId } = designTaskRecord(item);
    if (!Array.isArray(ids) || !ids.length || typeof field !== 'string' || typeof tokenId !== 'string') throw new Error('Expected ids, field and tokenId.');
    for (const id of ids) {
      if (++count > maxDesignTaskEdits) throw new Error('Too many token bindings.');
      if (typeof id !== 'string' || !permits(id) || !Object.hasOwn(view.document.nodes, id) || view.scene[id].locked) {
        throw new Error('Token target is locked, projected or outside the bound selection.');
      }
      const entries = byLayer.get(id) ?? new Map<string, string>();
      if (entries.has(field) && entries.get(field) !== tokenId) throw new Error('Conflicting token bindings for ' + id + '.' + field);
      entries.set(field, tokenId);
      byLayer.set(id, entries);
    }
  }
  const styles = designStyleChoices(view.document, view.resources);
  if (!styles) throw new Error('No styles available. Create or link the tokens first.');
  const boards = new Map<string, typeof styles>();
  return planDesignLayerUpdates(view, [...byLayer.keys()], (node, id) => {
    const boardId = designPrototypeBoardFor(id, view.scene)!;
    const board = view.document.nodes[boardId];
    const catalog = boards.get(boardId) ?? designStylesForModes(styles, view.document.documentId, board.kind === 'frame' ? board.variableModeIds : undefined)!;
    boards.set(boardId, catalog);
    for (const [field, tokenId] of byLayer.get(id)!) {
      if (!Object.hasOwn(catalog, tokenId)) throw new Error('Unknown design token: ' + tokenId);
      node = bindField(node, { field, tokenId }, catalog[tokenId]);
    }
    if (!validDesignWidthLimits(node)) throw new Error('The bound minimum width exceeds the maximum width.');
    return node;
  });
}
