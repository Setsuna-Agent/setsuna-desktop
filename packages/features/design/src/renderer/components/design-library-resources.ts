import type { DesignDocument, DesignNode, DesignStyle } from '../../contracts/index.js';
import { mapDesignLayerReferences } from '../../contracts/design-references.js';
import { designResourceId, designResourceParts } from '../../contracts/design-resource-id.js';

export type DesignLibraryResources = Readonly<{
  nodes: Readonly<Record<string, DesignNode>>;
  styles: Readonly<Record<string, DesignStyle>>;
}>;

export const emptyDesignLibraryResources: DesignLibraryResources = { nodes: Object.create(null), styles: Object.create(null) };

export function buildDesignLibraryResources(documentId: string, libraries: readonly DesignDocument[]): DesignLibraryResources {
  if (!libraries.length) return emptyDesignLibraryResources;
  const nodes: Record<string, DesignNode> = Object.create(null);
  const styles: Record<string, DesignStyle> = Object.create(null);
  for (const library of libraries) {
    function qualify(id: string) {
      const reference = designResourceParts(id);
      if (reference) return reference.documentId === documentId ? reference.id : id;
      return designResourceId(library.documentId, id);
    }
    for (const [id, style] of Object.entries(library.styles ?? {})) styles[qualify(id)] = style;
    function collect(id: string) {
      const qualifiedId = qualify(id);
      if (Object.hasOwn(nodes, qualifiedId)) return;
      const node = mapDesignLayerReferences(mapDesignStyleIds(library.nodes[id], qualify), qualify);
      const interaction = node.interaction && 'targetId' in node.interaction ? undefined : node.interaction;
      // These definitions are inputs to the editor's projection. Only instances enter the canvas tree.
      nodes[qualifiedId] = node.kind === 'frame' ? { ...node, interaction, childIds: node.childIds.map(qualify) } : { ...node, interaction };
      if (node.kind === 'frame') node.childIds.forEach(collect);
    }
    for (const [id, node] of Object.entries(library.nodes)) if (node.kind === 'frame' && node.component) collect(id);
  }
  return { nodes, styles };
}

export function designResourceNode(document: DesignDocument, id: string, resources: DesignLibraryResources | undefined): DesignNode | undefined {
  return Object.hasOwn(document.nodes, id) ? document.nodes[id] : resources?.nodes[id];
}

export function linkedDesignPath(document: Pick<DesignDocument, 'libraries'>, resourceId: string): string | undefined {
  const reference = designResourceParts(resourceId);
  return reference && document.libraries && Object.hasOwn(document.libraries, reference.documentId)
    ? document.libraries[reference.documentId] : undefined;
}

export function designStyleChoices(document: DesignDocument, resources: DesignLibraryResources): DesignDocument['styles'] {
  if (!document.libraries) return document.styles;
  const linked = Object.entries(resources.styles).filter(([id]) => linkedDesignPath(document, id));
  return linked.length ? { ...document.styles, ...Object.fromEntries(linked) } : document.styles;
}

export function mapDesignStyleIds(node: DesignNode, mapId: (id: string) => string | undefined): DesignNode {
  const paint = <T extends { styleId?: string }>(value: T): T => value.styleId ? { ...value, styleId: mapId(value.styleId) } : value;
  const base = { ...node, strokes: node.strokes?.map(paint), shadow: node.shadow && paint(node.shadow) };
  if (base.kind === 'image') return base;
  const fills = base.fills?.map((fill) => ({
    ...paint(fill), gradient: fill.gradient && { ...fill.gradient, stops: fill.gradient.stops.map(paint) },
  }));
  return base.kind === 'text' ? { ...base, fills, textStyleId: base.textStyleId && mapId(base.textStyleId), runs: base.runs?.map(paint) }
    : { ...base, fills };
}
