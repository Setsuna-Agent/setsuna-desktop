import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import type { DesignDocument, DesignFrame } from '../../contracts/document.js';
import { designResourceParts } from '../../contracts/design-resource-id.js';
import { designVariableCollectionKey } from '../../contracts/design-variable-collections.js';
import { designVariableAliasId, designVariableValue, type DesignVariable } from '../../contracts/design-variables.js';
import {
  designPreviewAxisCount, designPreviewInitialVariant, designPreviewVariantCount, type DesignPreviewBoardModes, type DesignPreviewVariables,
} from '../../contracts/design-preview-variables.js';
import {
  designLibraryVariableCollections, designResourceNode, designVariableCollectionLabel, mapDesignNodeResourceIds, type DesignLibraryResources,
} from '../components/design-library-resources.js';
import type { DesignLibraryFiles } from '../components/read-design-library-files.js';

type Collection = Readonly<{ key: string; name: string; modes: readonly Readonly<{ name: string; id?: string }>[] }>;
export type PreviewVariableCatalog = Readonly<{
  data: DesignPreviewVariables;
  collections: readonly Collection[];
  collectionIndexes: ReadonlyMap<string, number>;
  styles: NonNullable<DesignDocument['styles']>;
}>;

export function createPreviewVariableCatalog(document: DesignDocument, resources: DesignLibraryResources, files: DesignLibraryFiles,
  t: RendererTranslate): PreviewVariableCatalog | undefined {
  const catalogDocument = { ...document, libraries: Object.fromEntries([...files].map(([id, file]) => [id, file.path])) };
  const styles = { ...document.styles, ...resources.styles };
  const variables = Object.entries(styles).flatMap(([id, style]) =>
    style.kind === 'text' ? [] : [{ id, style, key: variableCollection(document, id, style) }]);
  const used = new Set(variables.map(({ key }) => key));
  const collections = designLibraryVariableCollections(catalogDocument, resources)
    .filter(({ key, collection }) => used.has(key) || collection.name || collection.defaultModeName || Object.keys(collection.modes ?? {}).length > 0)
    .map((entry): Collection => ({
      key: entry.key,
      name: designVariableCollectionLabel(entry, t('feature.design.defaultVariableCollection')).slice(0, 512),
      modes: [{ name: entry.collection.defaultModeName ?? t('feature.design.defaultVariableMode') },
        ...Object.entries(entry.collection.modes ?? {}).map(([id, name]) => ({ id, name }))],
    }));
  if (!collections.length) return;
  const collectionIndexes = new Map(collections.map(({ key }, index) => [key, index]));
  const publicStyles = variables.filter(({ key }) => collectionIndexes.has(key));
  const variableIndexes = new Map(publicStyles.map(({ id }, index) => [id, index]));
  const data: DesignPreviewVariables = {
    collections: collections.map(({ name, modes }) => ({ name, modes: modes.map((mode) => mode.name) })),
    entries: publicStyles.map(({ key, style }) => {
      const collection = collectionIndexes.get(key)!;
      return { collection, name: style.name, kind: style.kind, cells: collections[collection].modes.map(({ id }) => {
        const alias = designVariableAliasId(style, id);
        return { value: designVariableValue(style, id), alias: alias ? variableIndexes.get(alias) : undefined };
      }) };
    }),
  };
  return { data, collections, collectionIndexes, styles };
}

export function designPreviewBoardModes(document: DesignDocument, resources: DesignLibraryResources, id: string,
  catalog: PreviewVariableCatalog): DesignPreviewBoardModes {
  const board = document.nodes[id] as DesignFrame;
  const initial = catalog.collections.map(({ key, modes }) => Math.max(0, modes.findIndex(({ id }) => id === board.variableModeIds?.[key])));
  const references = new Set<string>();
  const dependent = new Map<number, DesignVariable[]>();

  // Read source bindings because resolving a mode can remove authored runs or hide bound layers.
  const layerIds = new Set([id]);
  for (const layerId of layerIds) {
    const node = designResourceNode(document, layerId, resources);
    if (!node) continue;
    mapDesignNodeResourceIds(node, (styleId) => { references.add(styleId); return styleId; });
    if (node.kind !== 'frame') continue;
    if (node.instanceOf) layerIds.add(node.instanceOf);
    for (const child of node.childIds) layerIds.add(child);
  }

  const { styles } = catalog;
  // A mode can drive the board through a text style or an alias owned by a different collection.
  for (const id of references) {
    if (!Object.hasOwn(styles, id)) continue;
    const style = styles[id];
    if (style.kind === 'text') {
      for (const target of Object.values(style.typography.variableIds ?? {})) references.add(target);
      continue;
    }
    const index = catalog.collectionIndexes.get(variableCollection(document, id, style));
    if (index !== undefined && style.modeValues) {
      const dependencies = dependent.get(index) ?? [];
      dependencies.push(style);
      dependent.set(index, dependencies);
    }
    for (const target of [style.aliasId, ...Object.values(style.modeAliasIds ?? {})]) {
      if (target && Object.hasOwn(styles, target) && styles[target].kind === style.kind) references.add(target);
    }
  }

  // Named modes that resolve the same inputs share a frame. Only modes that drive the board need rendering.
  const axes = catalog.collections.flatMap(({ modes }, collection) => {
    const inputs = dependent.get(collection);
    if (!inputs || modes.length < 2) return [];
    const states = new Map<string, number>();
    const choices = modes.map(({ id }) => {
      const key = JSON.stringify(inputs.map((style) => [designVariableValue(style, id), designVariableAliasId(style, id)]));
      const existing = states.get(key);
      if (existing !== undefined) return existing;
      const next = states.size;
      states.set(key, next);
      return next;
    });
    return states.size > 1 ? [{ collection, modes: choices }] : [];
  });
  return { initial, axes };
}

export function* designPreviewModeVariants(board: DesignFrame, plan: DesignPreviewBoardModes, catalog: PreviewVariableCatalog) {
  const base = designPreviewInitialVariant(plan);
  const count = designPreviewVariantCount(plan);
  for (let index = 0; index < count; index += 1) {
    if (index === base) continue;
    const modes: Record<string, string> = Object.assign(Object.create(null), board.variableModeIds);
    let value = index;
    for (let position = plan.axes.length - 1; position >= 0; position -= 1) {
      const axis = plan.axes[position];
      const size = designPreviewAxisCount(axis);
      const collection = catalog.collections[axis.collection];
      const mode = collection.modes[axis.modes.indexOf(value % size)].id;
      if (mode === undefined) delete modes[collection.key];
      else modes[collection.key] = mode;
      value = Math.floor(value / size);
    }
    yield { index, modes };
  }
}

function variableCollection(document: DesignDocument, id: string, style: DesignVariable) {
  return designVariableCollectionKey(designResourceParts(id)?.documentId ?? document.documentId, style.collectionId);
}
