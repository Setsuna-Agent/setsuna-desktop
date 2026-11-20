import { type DesignDocument, type DesignEdit, type DesignNode, rebaseDesignTextRuns } from '../../contracts/index.js';
import type { Yoga } from 'yoga-layout/load';
import { planDesignLayerUpdates } from './design-layer-updates.js';
import { parseDesignEdit, parseDesignLayout } from '../../contracts/document.js';
import { designActions, designTaskRecord } from '../../contracts/design-task.js';
import { alignDesignLayers, alignDesignLayerToFrame, canGroupDesignLayers, changeDesignLayout, duplicateDesignLayers,
  groupDesignLayers, isFlowChild, orderDesignBranches, ungroupDesignLayer, type Alignment } from '../design-canvas-edits.js';
import { changeDesignVariant } from '../components/design-library.js';
import { designResourceNode, type DesignLibraryResources } from '../components/design-library-resources.js';
import { detachDesignInstance, withDesignInstanceContent } from '../components/design-components.js';
import { defaultDesignAutoLayout, restackDesignLayers } from '../context/design-layer-commands.js';
import type { DesignScene } from '../design-layout.js';
import { isClosedDesignShape } from '../vectors/design-shape-outline.js';

export type DesignCommandContext = { layoutEngine: Yoga; document: DesignDocument; projected: DesignDocument; scene: DesignScene; resources: DesignLibraryResources };
type CommandResult = { edits: DesignEdit[]; ids: readonly string[] };
const alignments: Alignment[] = ['left', 'centerX', 'right', 'top', 'centerY', 'bottom', 'distributeX', 'distributeY'];
const structure = new Set(['kind', 'childIds', 'instanceOf', 'contentOverrides', 'maskId', 'group', 'component', 'componentSet', 'componentSlot', 'layout']);

function unavailable(): never { throw new Error('Command unavailable for these layers. Inspect the selection and choose valid targets.'); }

function patchLayer(node: DesignNode, id: string, fields: Record<string, unknown>): DesignNode {
  const structural = Object.keys(fields).find((key) => structure.has(key));
  if (structural) throw new Error('Use the corresponding structural command to change ' + structural + '.');
  const next = { ...node, ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === null ? undefined : value])) };
  if (typeof fields.width === 'number' && !('widthMode' in fields)) next.widthMode = 'fixed';
  if (node.kind !== 'text' && typeof fields.height === 'number' && !('heightMode' in fields)) Object.assign(next, { heightMode: 'fixed' });
  if (node.kind === 'text' && typeof fields.text === 'string' && !('runs' in fields)) {
    Object.assign(next, { runs: rebaseDesignTextRuns(node.text, fields.text, node.runs) });
  }
  const edit = parseDesignEdit({ kind: 'update', nodeId: id, node: next });
  if (edit.kind !== 'update') return unavailable();
  const unknown = Object.keys(fields).filter((key) => !Object.hasOwn(edit.node, key));
  if (unknown.length) throw new Error('Unknown fields on ' + node.kind + ' ' + id + ': ' + unknown.join(', '));
  return edit.node;
}

export async function planDesignCommand(context: DesignCommandContext, ids: readonly string[], args: Record<string, unknown>): Promise<CommandResult> {
  const { document, projected, scene, resources } = context;
  const fields = args.fields === undefined ? {} : designTaskRecord(args.fields);
  const unlocking = args.action === 'update' && Object.keys(fields).length === 1 && fields.locked === false;
  const unlockIds = unlocking ? new Set(ids) : undefined;
  if (!ids.length || ids.some((id) => {
    if (!Object.hasOwn(document.nodes, id) || !scene[id]) return true;
    if (!scene[id].locked) return false;
    if (!unlockIds) return true;
    for (let current: string | null = id; current; current = scene[current].parentId) {
      if (document.nodes[current]?.locked && !unlockIds.has(current)) return true;
    }
    return false;
  })) return unavailable();
  const action = designActions.find((name) => name === args.action);
  const id = ids[0];
  const node = document.nodes[id];
  const frame = ids.length === 1 && node.kind === 'frame' && !node.instanceOf ? node : undefined;
  const wrap = (properties: Parameters<typeof groupDesignLayers>[4]) => {
    if (!canGroupDesignLayers(projected, scene, ids)) return unavailable();
    const plan = groupDesignLayers(document, scene, ids, typeof fields.name === 'string' ? fields.name : node.name ?? 'Frame', properties, projected);
    return { edits: plan.edits, ids: [plan.id] };
  };
  const update = (next: DesignNode): CommandResult => ({ edits: [{ kind: 'update', nodeId: id, node: next }], ids });
  switch (action) {
    case 'update': return planDesignLayerUpdates(context, ids, (layer, id) => patchLayer(layer, id, fields));
    case 'layout': {
      const layout = parseDesignLayout({ ...(frame?.layout ?? defaultDesignAutoLayout(scene, ids)), ...fields });
      return frame ? { edits: changeDesignLayout(document, scene, id, frame, layout), ids } : wrap({ layout });
    }
    case 'removeLayout': return frame?.layout ? { edits: changeDesignLayout(document, scene, id, frame, undefined), ids } : unavailable();
    case 'align': {
      const mode = alignments.find((value) => value === args.mode);
      if (!mode || ids.some((item) => scene[item].parentId !== scene[id].parentId || isFlowChild(projected, scene, item))
        || (ids.length === 1 && !scene[id].parentId) || (mode.startsWith('distribute') && ids.length < 3)) return unavailable();
      const edits = ids.length === 1 ? alignDesignLayerToFrame(document, scene, id, mode, projected) : alignDesignLayers(document, scene, ids, mode);
      return { edits, ids };
    }
    case 'group': return wrap({ group: true });
    case 'frame': return wrap({});
    case 'component': {
      if (ids.length === 1 && node.kind === 'frame' && (node.component || node.instanceOf)) return unavailable();
      return frame ? update({ ...frame, component: true, group: undefined }) : wrap({ component: true });
    }
    case 'ungroup': return frame && !frame.component && frame.childIds.length
      ? { edits: ungroupDesignLayer(document, scene, id, frame, projected), ids: frame.childIds } : unavailable();
    case 'duplicate': {
      const copy = duplicateDesignLayers(document, scene, ids);
      return { edits: copy.edits, ids: copy.copies };
    }
    case 'front':
    case 'back': return { edits: restackDesignLayers(document, scene, ids, action === 'front'), ids };
    case 'delete': return { edits: ids.map((nodeId) => ({ kind: 'remove', nodeId })), ids: [] };
    case 'mask': {
      const maskId = orderDesignBranches(document, ids).at(-1);
      return ids.length > 1 && maskId && scene[maskId].visible && isClosedDesignShape(document.nodes[maskId])
        ? wrap({ group: true, maskId }) : unavailable();
    }
    case 'removeMask': return frame?.maskId ? update({ ...frame, maskId: undefined }) : unavailable();
    case 'union':
    case 'subtract': {
      const { combineDesignPaths } = await import('../vectors/design-path-boolean.js');
      const result = await combineDesignPaths(document, scene, orderDesignBranches(document, ids), action, 'Path');
      return result.edits.length ? { edits: result.edits, ids: result.id ? [result.id] : [] } : unavailable();
    }
    case 'detach': return ids.length === 1 && node.kind === 'frame' && node.instanceOf && designResourceNode(document, node.instanceOf, resources)?.kind === 'frame'
      ? { edits: detachDesignInstance(projected, id), ids } : unavailable();
    case 'variant': {
      const next = ids.length === 1 && typeof args.mode === 'string' && changeDesignVariant(document, projected, id, args.mode, resources);
      return next ? update(next) : unavailable();
    }
    case 'override': {
      if (ids.length !== 1 || node.kind !== 'frame' || !node.instanceOf || typeof fields.path !== 'string') return unavailable();
      const child = projected.nodes[id + '/' + fields.path];
      if (child && fields.value === null) return update(withDesignInstanceContent(node, fields.path, undefined));
      if (child?.kind === 'text' && typeof fields.text === 'string') return update(withDesignInstanceContent(node, fields.path, { kind: 'text', text: fields.text }));
      if (child?.kind === 'image' && typeof fields.assetPath === 'string') return update(withDesignInstanceContent(node, fields.path, { kind: 'image', assetPath: fields.assetPath }));
      return unavailable();
    }
    default: return unavailable();
  }
}
