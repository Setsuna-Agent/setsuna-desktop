import type { DesignMcpRead, DesignMcpReadResult } from '../../contracts/design-mcp.js';
import { isDesignPrototypeBoard } from '../../contracts/document.js';
import type { DesignCommandContext } from '../agent/design-command.js';
import { inspectDesignLayers } from '../agent/design-layer-inspection.js';
import { designResumeContext } from '../agent/design-resume.js';
import type { Bounds } from '../design-geometry.js';

export type DesignMcpCanvasView = DesignCommandContext & Readonly<{
  name: string;
  revision: string;
  selection: readonly string[];
  preview(ids: readonly string[], signal: AbortSignal): Promise<{ image: string; bounds: Bounds }>;
}>;

export async function readDesignMcpCanvas(
  view: DesignMcpCanvasView, read: DesignMcpRead, focus: (ids: readonly string[]) => void, signal: AbortSignal,
): Promise<DesignMcpReadResult> {
  const { document, scene, revision, selection } = view;
  const { documentId } = document;
  const visible = (id: string) => scene[id]?.visible && scene[id].visibleBounds;
  function suggestedTargets() {
    const selected = selection.filter(visible);
    if (selected.length) return selected;
    const first = document.rootIds.find((id) => isDesignPrototypeBoard(document.nodes[id]) && visible(id)) ?? document.rootIds.find(visible);
    return first ? [first] : [];
  }
  signal.throwIfAborted();

  if (read.kind === 'active') {
    focus(suggestedTargets());
    return { content: JSON.stringify({ name: view.name, documentId, revision, ...designResumeContext(document, scene),
      selection: selection.slice(0, 64), selectionCount: selection.length }) };
  }
  if (read.documentId !== undefined && read.documentId !== documentId) throw new Error('The active design changed. Call get_active_design again.');
  if (read.revision !== undefined && read.revision !== revision) throw new Error('The design revision changed. Call get_active_design again.');
  const batch = read.kind === 'inspect' ? read.layerIds : undefined;
  if (read.layerId && batch) throw new Error('Choose layerId or layerIds.');
  const layerIds = batch ? [...new Set(batch)] : read.layerId ? [read.layerId] : undefined;
  if (layerIds?.some((id) => !Object.hasOwn(scene, id))) throw new Error('A requested layer is missing from the active design.');

  if (read.kind === 'preview') {
    const target = layerIds ?? suggestedTargets();
    if (!target.some(visible)) throw new Error('Choose a visible layer or artboard to preview.');
    focus(target);
    const { image, bounds } = await view.preview(target, signal);
    return { image, content: JSON.stringify({ documentId, revision, layerIds: target, bounds }) };
  }
  const { inspection, focusIds } = await inspectDesignLayers(
    { ...view, resolvedProperties: true }, layerIds ?? document.rootIds, revision, read, !layerIds, selection,
  );
  signal.throwIfAborted();
  focus(layerIds || read.name !== undefined ? focusIds : suggestedTargets());
  return { content: JSON.stringify({ documentId, ...inspection, ...(layerIds ? { scope: 'layers', layerIds } : {}) }) };
}
