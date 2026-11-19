import type { DesignDocument, DesignEdit, DesignFrame, DesignNode } from '../../contracts/index.js';
import { designResourceParts } from '../../contracts/design-resource-id.js';
import { designStylesForModes, resolveDesignNodeStyles } from '../../contracts/design-styles.js';
import { createDesignVariableResolver } from '../../contracts/design-variable-aliases.js';
import { designVariableCollectionKey } from '../../contracts/design-variable-collections.js';
import { designVariableValue, mapDesignVariableIds, resolveDesignVariableTarget, withDesignVariableValue } from '../../contracts/design-variables.js';
import { detachDesignInstance } from './design-components.js';
import { mapDesignNodeResourceIds, type DesignLibraryResources } from './design-library-resources.js';

export function planDesignLibraryUnlink(
  document: DesignDocument, projected: DesignDocument, resources: DesignLibraryResources, path: string,
): readonly DesignEdit[] | undefined {
  const links = Object.entries(document.libraries ?? {});
  // The panel shows unique paths, including stale links to a file whose document ID changed.
  const removed = new Set(links.filter(([, linkedPath]) => linkedPath === path).map(([id]) => id));
  if (!removed.size) return [];
  const libraries = Object.fromEntries(links.filter(([id]) => !removed.has(id)));
  const detached = { ...projected, libraries };
  const edits: DesignEdit[] = [];
  const styles = projected.styles;
  const matches = (id: string | undefined) => Boolean(id && removed.has(designResourceParts(id)?.documentId ?? ''));
  const keep = (id: string) => matches(id) ? undefined : id;

  function libraryStyles(modes?: DesignFrame['variableModeIds']) {
    const resolved = designStylesForModes(styles, document.documentId, modes);
    return Object.fromEntries(Object.entries(resolved ?? {}).filter(([id]) => matches(id)));
  }
  function removeModes(node: DesignNode): DesignNode {
    if (node.kind !== 'frame' || !node.variableModeIds) return node;
    const entries = Object.entries(node.variableModeIds);
    const remaining = entries.filter(([key]) => !removed.has(designResourceParts(key)?.documentId ?? key));
    return remaining.length === entries.length ? node : { ...node, variableModeIds: remaining.length ? Object.fromEntries(remaining) : undefined };
  }

  // Refuse to flatten an instance while its definition is unavailable. The projected frame would be empty.
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== 'frame' || !node.instanceOf || !matches(node.instanceOf)) continue;
    const source = resources.nodes[node.instanceOf];
    if (source?.kind !== 'frame' || !source.component) return;
  }

  const usesUnlinkedInstance = new Map<string, boolean>();
  function needsDetach(sourceId: string): boolean {
    if (matches(sourceId)) return true;
    const cached = usesUnlinkedInstance.get(sourceId);
    if (cached !== undefined) return cached;
    const source = document.nodes[sourceId];
    const affected = source?.kind === 'frame' && (source.instanceOf ? needsDetach(source.instanceOf) : source.childIds.some(needsDetach));
    usesUnlinkedInstance.set(sourceId, affected);
    return affected;
  }

  const defaults = libraryStyles();
  function visit(id: string, scoped: DesignDocument['styles']) {
    const node = document.nodes[id];
    // A local instance can override content inside a shared instance nested in its source.
    if (node.kind === 'frame' && node.instanceOf && needsDetach(node.instanceOf)) {
      for (const edit of detachDesignInstance(detached, id)) {
        edits.push(edit.kind === 'update' || edit.kind === 'insert' ? { ...edit, node: removeModes(edit.node) } : edit);
      }
      return;
    }
    const local = removeModes(node);
    let changed = local !== node;
    const next = mapDesignNodeResourceIds(resolveDesignNodeStyles(local, scoped), (id) => {
      if (matches(id)) { changed = true; return undefined; }
      return id;
    });
    if (changed) edits.push({ kind: 'update', nodeId: id, node: next });
    if (node.kind === 'frame') node.childIds.forEach((child) => visit(child, scoped));
  }
  for (const id of document.rootIds) {
    const node = document.nodes[id];
    visit(id, node.kind === 'frame' && node.variableModeIds ? libraryStyles(node.variableModeIds) : defaults);
  }

  const resolveDefault = createDesignVariableResolver(styles, document.documentId);
  for (const [styleId, style] of Object.entries(document.styles ?? {})) {
    if (style.kind === 'text') {
      if (Object.values(style.typography.variableIds ?? {}).some(matches)) {
        const typography = mapDesignVariableIds(resolveDesignVariableTarget(style.typography, defaults), keep);
        edits.push({ kind: 'setStyle', styleId, style: { ...style, typography } });
      }
      continue;
    }
    let next = style;
    if (matches(style.aliasId)) next = withDesignVariableValue(next, undefined, resolveDefault(styleId) ?? designVariableValue(style));
    const collection = designVariableCollectionKey(document.documentId, style.collectionId);
    for (const [mode, alias] of Object.entries(style.modeAliasIds ?? {})) {
      if (!matches(alias)) continue;
      const resolve = createDesignVariableResolver(styles, document.documentId, { [collection]: mode });
      next = withDesignVariableValue(next, mode, resolve(styleId) ?? designVariableValue(style, mode));
    }
    if (next !== style) edits.push({ kind: 'setStyle', styleId, style: next });
  }
  for (const documentId of removed) edits.push({ kind: 'unlinkLibrary', documentId });
  return edits;
}
