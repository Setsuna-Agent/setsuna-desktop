import { designResumeContext } from './design-resume.js';
import type { DesignCommandContext } from './design-command.js';

export function designLayerEntry(view: DesignCommandContext, id: string) {
  const { parentId, paintBounds } = view.scene[id];
  const { name, kind } = view.projected.nodes[id];
  return { id, parentId, name: name?.slice(0, 120), kind, bounds: paintBounds };
}

export async function inspectDesignLayers(view: DesignCommandContext, ids: readonly string[], revision: string, args: Record<string, unknown>, documentScope: boolean, selection: readonly string[]) {
  const { mode, offset } = args;
  if (args.scope !== undefined && args.scope !== 'selection' && args.scope !== 'document') throw new Error('Choose selection or document scope.');
  if (args.revision !== undefined && args.revision !== revision) throw new Error('Design revision changed. Restart inspection.');
  if (offset !== undefined && (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0)) throw new Error('Invalid layer offset.');
  const start = typeof offset === 'number' ? offset : 0;
  if (mode === 'layout' || mode === 'audit') {
    if (args.name !== undefined) throw new Error('Use layers or index mode to look up a layer by name.');
    if (mode === 'audit') {
      const { auditDesignBoard, designAuditPage } = await import('./design-board-audit.js');
      const report = auditDesignBoard(view, ids, revision, args.checks, args.includeExpectedOverlaps === true);
      return { content: JSON.stringify(designAuditPage(report, start)), focusIds: ids };
    }
    const { designLayoutReport } = await import('./design-layout-report.js');
    return { content: JSON.stringify(designLayoutReport(view, ids, revision, start, args.includeExpectedOverlaps === true, args.checks)), focusIds: ids };
  }
  if (mode !== undefined && mode !== 'layers' && mode !== 'index') throw new Error('Unknown inspection mode.');
  if (args.checks !== undefined || args.includeExpectedOverlaps !== undefined) throw new Error('Use layout mode to request layout checks.');
  if (args.name !== undefined && typeof args.name !== 'string') throw new Error('Expected a layer name.');
  const context = documentScope && start === 0 && !args.name ? designResumeContext(view.document, view.scene) : { scope: documentScope ? 'document' : 'selection' };
  const compact = mode === 'index';
  const stack = [...ids].reverse();
  const layers = [];
  let index = 0;
  let bytes = 0;
  while (stack.length && layers.length < (compact ? 256 : 64) && bytes < 35_000) {
    const id = stack.pop()!;
    const node = view.projected.nodes[id];
    if (node.kind === 'frame') for (let i = node.childIds.length - 1; i >= 0; i--) stack.push(node.childIds[i]);
    if (args.name !== undefined && node.name !== args.name) continue;
    if (index++ < start) continue;
    if (compact) {
      const entry = designLayerEntry(view, id);
      layers.push(entry);
      bytes += JSON.stringify(entry).length;
      continue;
    }
    const { parentId, locked, visible, paintBounds, visibleBounds } = view.scene[id];
    const authored = view.document.nodes[id];
    const entry = { id, parentId, locked, visible, bounds: paintBounds, visibleBounds, projected: !authored, node: authored ?? node };
    const size = JSON.stringify(entry).length;
    layers.push(size > 32_000 ? { ...entry, node: { kind: node.kind, name: node.name, abbreviated: true } } : entry);
    bytes += Math.min(size, 32_000);
  }
  const focusIds = args.name !== undefined || start > 0 ? layers.map(({ id }) => id) : ids;
  return { content: JSON.stringify({ revision, ...context, selection: selection.slice(0, 64), selectionCount: selection.length, layers, ...(stack.length ? { nextOffset: index } : {}) }), focusIds };
}
