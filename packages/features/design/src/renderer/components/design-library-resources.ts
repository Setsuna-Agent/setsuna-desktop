import type { DesignDocument, DesignNode, DesignPaint, DesignStyle } from '../../contracts/index.js';
import { mapDesignLayerReferences } from '../../contracts/design-references.js';
import { designResourceId, designResourceParts } from '../../contracts/design-resource-id.js';
import { designLibraryDarkModeId, findBundledDesignLibrary, isDesignLibraryPresetDocumentId } from '../../contracts/design-library-presets.js';
import { mapDesignVariableAliases } from '../../contracts/design-variable-aliases.js';
import { designVariableCollectionKey, designVariableCollections, type DesignVariableCollection, type DesignVariableCollections,
  type DesignVariableModeIds } from '../../contracts/design-variable-collections.js';
import { mapDesignVariableIds } from '../../contracts/design-variables.js';

export type DesignLibraryResources = Readonly<{
  documents: ReadonlyMap<string, DesignDocument>;
  nodes: Readonly<Record<string, DesignNode>>;
  styles: Readonly<Record<string, DesignStyle>>;
  variableCollections: Readonly<Record<string, DesignVariableCollections>>;
}>;

export const emptyDesignLibraryResources: DesignLibraryResources = {
  documents: new Map(), nodes: Object.create(null), styles: Object.create(null), variableCollections: Object.create(null),
};

export function buildDesignLibraryResources(documentId: string, libraries: readonly DesignDocument[]): DesignLibraryResources {
  if (!libraries.length) return emptyDesignLibraryResources;
  const nodes: Record<string, DesignNode> = Object.create(null);
  const styles: Record<string, DesignStyle> = Object.create(null);
  const variableCollections: Record<string, DesignVariableCollections> = Object.create(null);
  for (const library of libraries) {
    function qualify(id: string) {
      const reference = designResourceParts(id);
      if (reference) return reference.documentId === documentId ? reference.id : id;
      return designResourceId(library.documentId, id);
    }
    const entries = Object.entries(library.styles ?? {});
    for (const [id, style] of entries) {
      styles[qualify(id)] = style.kind === 'text' ? { ...style, typography: mapDesignVariableIds(style.typography, qualify) }
        : mapDesignVariableAliases(style, qualify);
    }
    if (library.variableCollections || entries.some(([, style]) => style.kind !== 'text')) {
      variableCollections[library.documentId] = designVariableCollections(library.variableCollections);
    }
    function collect(id: string) {
      const qualifiedId = qualify(id);
      if (Object.hasOwn(nodes, qualifiedId)) return;
      const node = mapDesignLayerReferences(mapDesignNodeResourceIds(library.nodes[id], qualify), qualify);
      const interaction = node.interaction && 'targetId' in node.interaction ? undefined : node.interaction;
      // These definitions are inputs to the editor's projection. Only instances enter the canvas tree.
      nodes[qualifiedId] = node.kind === 'frame' ? { ...node, interaction, childIds: node.childIds.map(qualify) } : { ...node, interaction };
      if (node.kind === 'frame') node.childIds.forEach(collect);
    }
    for (const [id, node] of Object.entries(library.nodes)) if (node.kind === 'frame' && node.component) collect(id);
  }
  return { documents: new Map(libraries.map((library) => [library.documentId, library])), nodes, styles, variableCollections };
}

export type DesignLibraryVariableCollection = Readonly<{
  key: string;
  id: string;
  collection: DesignVariableCollection;
  path?: string;
}>;

export function designLibraryVariableCollections(document: DesignDocument, resources: DesignLibraryResources): DesignLibraryVariableCollection[] {
  function entries(owner: string, collections: DesignVariableCollections, path?: string) {
    return Object.entries(collections).map(([id, collection]) => ({ id, key: designVariableCollectionKey(owner, id), collection, path }));
  }
  return [
    ...entries(document.documentId, designVariableCollections(document.variableCollections)),
    ...Object.entries(document.libraries ?? {}).flatMap(([owner, path]) =>
      Object.hasOwn(resources.variableCollections, owner) ? entries(owner, resources.variableCollections[owner], path) : []),
  ];
}

export function designVariableCollectionLabel({ collection, path }: DesignLibraryVariableCollection, defaultName: string): string {
  return collection.name ?? findBundledDesignLibrary(path)?.name ?? path?.split('/').at(-1)?.replace(/\.design\.json$/iu, '') ?? defaultName;
}

export function designLibrarySourceLabel(path: string | undefined): string | undefined {
  return findBundledDesignLibrary(path)?.name ?? path;
}

export function designResourceNode(document: DesignDocument, id: string, resources: DesignLibraryResources | undefined): DesignNode | undefined {
  return Object.hasOwn(document.nodes, id) ? document.nodes[id] : resources?.nodes[id];
}

export function linkedDesignPath(document: Pick<DesignDocument, 'libraries'>, resourceId: string): string | undefined {
  const reference = designResourceParts(resourceId);
  return reference && document.libraries && Object.hasOwn(document.libraries, reference.documentId)
    ? document.libraries[reference.documentId] : undefined;
}

export function isPresetLibraryPath(document: Pick<DesignDocument, 'libraries'>, path: string): boolean {
  return Object.entries(document.libraries ?? {}).some(([id, source]) => source === path && isDesignLibraryPresetDocumentId(id));
}

export function lockDesignLibraryPreview(document: DesignDocument): DesignDocument {
  // The scene inherits locks from root layers. Linked definitions keep their authored flags.
  const nodes = { ...document.nodes };
  for (const id of document.rootIds) nodes[id] = { ...nodes[id], locked: true };
  return { ...document, nodes };
}

export function designLibraryDarkModes({ documentId, variableCollections }: DesignDocument): DesignVariableModeIds {
  return Object.fromEntries(Object.entries(variableCollections ?? {}).flatMap(([id, collection]) =>
    Object.hasOwn(collection.modes ?? {}, designLibraryDarkModeId) ? [[designVariableCollectionKey(documentId, id), designLibraryDarkModeId]] : []));
}

export function designStyleChoices(document: DesignDocument, resources: DesignLibraryResources): DesignDocument['styles'] {
  if (!document.libraries) return document.styles;
  const linked = Object.entries(resources.styles).filter(([id]) => linkedDesignPath(document, id));
  return linked.length ? { ...document.styles, ...Object.fromEntries(linked) } : document.styles;
}

export function mapDesignNodeResourceIds(node: DesignNode, mapId: (id: string) => string | undefined): DesignNode {
  const style = <T extends { styleId?: string }>(value: T): T => value.styleId ? { ...value, styleId: mapId(value.styleId) } : value;
  const paint = <T extends DesignPaint>(value: T): T => {
    const mapped = mapDesignVariableIds(style(value), mapId);
    const gradient = value.gradient;
    return gradient ? { ...mapped, gradient: { ...gradient, stops: gradient.stops.map(style) } } : mapped;
  };
  const base = { ...mapDesignVariableIds(node, mapId), strokes: node.strokes?.map(paint), shadow: node.shadow && paint(node.shadow) };
  if (base.kind === 'image') return base;
  const fills = base.fills?.map(paint);
  if (base.kind === 'frame') return { ...base, fills, layout: base.layout && mapDesignVariableIds(base.layout, mapId) };
  return base.kind === 'text' ? { ...base, fills, textStyleId: base.textStyleId && mapId(base.textStyleId), runs: base.runs?.map(style) }
    : { ...base, fills };
}
