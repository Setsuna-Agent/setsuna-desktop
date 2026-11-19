import type { DesignDocument, DesignFrame, DesignNode } from './document.js';

export function designMaskLayer(document: DesignDocument, id: string | undefined) {
  const node = id && Object.hasOwn(document.nodes, id) ? document.nodes[id] : undefined;
  return node?.kind === 'rectangle' || node?.kind === 'ellipse' || node?.kind === 'vector' ? node : undefined;
}

export function designFrameMask(document: DesignDocument, frame: DesignFrame) {
  const id = frame.maskId;
  const mask = designMaskLayer(document, id);
  return id && frame.childIds.includes(id) && mask && !mask.hidden ? { id, node: mask } : undefined;
}

export function remapDesignLayerReferences(node: DesignNode, ids: ReadonlyMap<string, string>, keepComponentLinks = false): DesignNode {
  return mapDesignLayerReferences(node, (id) => ids.get(id) ?? id, keepComponentLinks);
}

export function mapDesignLayerReferences(node: DesignNode, mapId: (id: string) => string, keepComponentLinks = false): DesignNode {
  const lookup = (id: string | undefined) => id === undefined ? undefined : mapId(id);
  const interaction = node.interaction && 'targetId' in node.interaction
    ? { ...node.interaction, targetId: mapId(node.interaction.targetId) } : node.interaction;
  const componentSlot = lookup(node.componentSlot);
  if (node.kind !== 'frame') return { ...node, interaction, componentSlot };
  if (keepComponentLinks) return { ...node, maskId: lookup(node.maskId), interaction, componentSlot };
  const contentOverrides = node.contentOverrides && Object.fromEntries(Object.entries(node.contentOverrides).map(([path, value]) =>
    [path.split('/').map(mapId).join('/'), value]));
  return { ...node, maskId: lookup(node.maskId), componentSet: lookup(node.componentSet), instanceOf: lookup(node.instanceOf),
    interaction, componentSlot, contentOverrides };
}
