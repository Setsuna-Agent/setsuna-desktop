import { splitDesignColor } from '../../../contracts/design-color.js';
import type { DesignDocument, DesignFrame, DesignNode, DesignRectangle } from '../../../contracts/document.js';
import { loadDesignLayoutEngine } from '../../canvas/design-layout-engine.js';
import type { DesignFontClient } from '../../client.js';
import { participatesInDesignFlow, resolveDesignScene, type DesignScene } from '../../design-layout.js';
import { measureDesignText } from '../../design-text.js';
import { designExportFontRequests } from '../../export/design-export-scene.js';
import { createDesignPreviewFontLoader } from '../../text/design-font-loader.js';

type PenOverlay = Readonly<{ backdropId: string; backdrop: DesignRectangle; panelId: string; panel: DesignFrame }>;

export async function fitPenOverlays(document: DesignDocument, fontClient?: Pick<DesignFontClient, 'list' | 'read'>): Promise<DesignDocument['nodes']> {
  const frames = Object.entries(document.nodes).flatMap(([id, node]) => {
    if (node.kind !== 'frame' || !node.clip || node.hidden || node.heightMode !== 'hug') return [];
    const overlays = penOverlays(node, document.nodes);
    return overlays.length ? [{ id, frame: node, overlays }] : [];
  });
  if (!frames.length) return document.nodes;

  const fonts = fontClient && createDesignPreviewFontLoader(fontClient);
  const request = new AbortController();
  try {
    const [yoga] = await Promise.all([loadDesignLayoutEngine(),
      fonts?.load(designExportFontRequests({ document, ids: document.rootIds }), request.signal)]);
    const scene = resolveDesignScene(yoga, document, measureDesignText);
    const nodes = { ...document.nodes };
    for (const { id, frame, overlays } of frames) fitFrameOverlays(id, frame, overlays, scene, nodes);
    return nodes;
  } finally {
    request.abort();
    fonts?.dispose();
  }
}

function penOverlays(frame: DesignFrame, nodes: DesignDocument['nodes']): PenOverlay[] {
  return frame.childIds.flatMap((backdropId, index) => {
    const backdrop = nodes[backdropId];
    const panelId = frame.childIds[index + 1];
    const panel = nodes[panelId];
    if (!isPenBackdrop(backdrop) || panel?.kind !== 'frame' || !isUntransformedOverlay(panel)
      || panel.y < 0 || panel.y >= backdrop.y + backdrop.height) return [];
    return [{ backdropId, backdrop, panelId, panel }];
  });
}

function isUntransformedOverlay(node: DesignNode): boolean {
  return Boolean(node.absolute && !node.hidden && !node.rotation && !node.flipX && !node.flipY);
}

function isPenBackdrop(node: DesignNode): node is DesignRectangle {
  if (node.kind !== 'rectangle' || !isUntransformedOverlay(node) || node.x !== 0 || node.y > 0
    || node.cornerRadius || node.cornerRadii?.some(Boolean) || node.fills?.length !== 1) return false;
  const [fill] = node.fills;
  if (fill.hidden || fill.gradient || fill.image || fill.shader) return false;
  const opacity = splitDesignColor(fill.color).opacity * (fill.opacity ?? 1) * (node.opacity ?? 1);
  return opacity > 0 && opacity < 1;
}

function fitFrameOverlays(id: string, frame: DesignFrame, overlays: readonly PenOverlay[], scene: DesignScene, nodes: Record<string, DesignNode>) {
  const { width, height } = scene[id];
  const lastFlowStart = frame.childIds.reduce((last, childId) =>
    participatesInDesignFlow(nodes[childId], childId, frame) ? Math.max(last, scene[childId].y) : last, 0);
  const fullWidth = overlays.filter(({ backdropId }) => scene[backdropId].width === width);
  const viewportEdges = new Set<number>();
  const sheets: PenOverlay[] = [];
  for (const overlay of fullWidth) {
    const { panel, panelId, backdrop } = overlay;
    const [topLeft, topRight, bottomRight, bottomLeft] = panel.cornerRadii ?? [0, 0, 0, 0];
    const bottomSheet = panel.x === 0 && scene[panelId].width === width && topLeft > 0 && topRight > 0
      && bottomRight === 0 && bottomLeft === 0;
    const edge = backdrop.y + backdrop.height;
    // A full-width backdrop preceding a bottom sheet supplies the original viewport edge.
    // Only adjust the sheet when measuring the content changes that edge.
    if (!bottomSheet || edge <= lastFlowStart || Math.round(edge) === Math.round(height)) continue;
    viewportEdges.add(edge);
    sheets.push(overlay);
  }
  for (const { backdropId, backdrop } of fullWidth) {
    if (viewportEdges.has(backdrop.y + backdrop.height)) nodes[backdropId] = { ...backdrop, height: height - backdrop.y };
  }
  // Absolute layers are excluded from flex sizing, so applying these edges cannot move the flow.
  for (const { panelId } of sheets) {
    const panel = nodes[panelId];
    nodes[panelId] = { ...panel, y: Math.max(0, height - scene[panelId].height) };
  }
}
