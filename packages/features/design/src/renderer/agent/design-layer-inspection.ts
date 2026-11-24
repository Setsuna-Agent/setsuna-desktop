import { designResumeContext } from './design-resume.js';
import type { DesignCommandContext } from './design-command.js';

const maxPageLayerChars = 35_000;
const maxLayerChars = 32_000;

export function designLayerEntry(view: DesignCommandContext, id: string) {
  const { parentId, paintBounds } = view.scene[id];
  const { name, kind } = view.projected.nodes[id];
  return { id, parentId, name: name?.slice(0, 120), kind, bounds: paintBounds };
}

export async function inspectDesignLayers(view: DesignCommandContext & { resolvedProperties?: boolean }, ids: readonly string[], revision: string, args: Record<string, unknown>, documentScope: boolean, selection: readonly string[]) {
  const { mode, offset, name, maxDepth, limit } = args;
  if (args.scope !== undefined && args.scope !== 'selection' && args.scope !== 'document') throw new Error('Choose selection or document scope.');
  if (args.revision !== undefined && args.revision !== revision) throw new Error('Design revision changed. Restart inspection.');
  if (offset !== undefined && (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0)) throw new Error('Invalid layer offset.');
  const start = typeof offset === 'number' ? offset : 0;
  if (mode === 'layout' || mode === 'audit') {
    if (args.name !== undefined) throw new Error('Use layers or index mode to look up a layer by name.');
    if (mode === 'audit') {
      const { auditDesignBoard, designAuditPage } = await import('./design-board-audit.js');
      const report = auditDesignBoard(view, ids, revision, args.checks, args.includeExpectedOverlaps === true);
      return { inspection: designAuditPage(report, start), focusIds: ids };
    }
    const { designLayoutReport } = await import('./design-layout-report.js');
    return { inspection: designLayoutReport(view, ids, revision, start, args.includeExpectedOverlaps === true, args.checks), focusIds: ids };
  }
  if (mode !== undefined && mode !== 'layers' && mode !== 'index') throw new Error('Unknown inspection mode.');
  if (args.checks !== undefined || args.includeExpectedOverlaps !== undefined) throw new Error('Use layout mode to request layout checks.');
  if (name !== undefined && typeof name !== 'string') throw new Error('Expected a layer name.');
  if (maxDepth !== undefined && (typeof maxDepth !== 'number' || !Number.isSafeInteger(maxDepth) || maxDepth < 0)) throw new Error('Invalid layer depth.');
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1)) throw new Error('Invalid layer page limit.');
  const context = documentScope && start === 0 && !name ? designResumeContext(view.document, view.scene) : { scope: documentScope ? 'document' : 'selection' };
  const compact = mode === 'index';
  const maxLayers = compact ? 256 : 64;
  const pageSize = Math.min(limit ?? maxLayers, maxLayers);
  const roots = new Set(ids);
  const stack = [...roots].reverse().map((id) => ({ id, depth: 0 }));
  const visited = new Set<string>();
  const layers = [];
  let index = 0;
  let chars = 0;
  let hasMore = false;
  while (stack.length) {
    const { id, depth } = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = view.projected.nodes[id];
    if (node.kind === 'frame' && (maxDepth === undefined || depth < maxDepth)) {
      for (let i = node.childIds.length - 1; i >= 0; i--) {
        const child = node.childIds[i];
        // An explicitly requested descendant keeps its full depth allowance without appearing twice.
        stack.push({ id: child, depth: roots.has(child) ? 0 : depth + 1 });
      }
    }
    if (name !== undefined && node.name !== name) continue;
    if (index < start) { index += 1; continue; }
    if (layers.length === pageSize) { hasMore = true; break; }
    const properties = compact ? designLayerEntry(view, id) : designLayerProperties(view, id);
    const fullSize = JSON.stringify(properties).length;
    const entry = !compact && fullSize > maxLayerChars
      ? { ...properties, node: { kind: node.kind, name: node.name?.slice(0, 120), abbreviated: true } }
      : properties;
    const size = entry === properties ? fullSize : JSON.stringify(entry).length;
    if (layers.length && chars + 1 + size > maxPageLayerChars) { hasMore = true; break; }
    layers.push(entry);
    chars += size + (layers.length > 1 ? 1 : 0);
    index += 1;
  }
  const focusIds = name !== undefined || start > 0 ? layers.map(({ id }) => id) : ids;
  const inspection = { revision, ...context, selection: selection.slice(0, 64), selectionCount: selection.length, layers, ...(hasMore ? { nextOffset: index } : {}) };
  return { inspection, focusIds };
}

function designLayerProperties(view: DesignCommandContext & { resolvedProperties?: boolean }, id: string) {
  const { parentId, locked, visible, paintBounds, visibleBounds } = view.scene[id];
  const node = view.projected.nodes[id];
  const authored = view.document.nodes[id];
  return { id, parentId, locked, visible, bounds: paintBounds, visibleBounds, projected: !authored, node: view.resolvedProperties ? node : authored ?? node };
}
