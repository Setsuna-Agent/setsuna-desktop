import type { DesignEdit, DesignFrame, DesignStyle } from './document.js';
import { designResourceId, parseDesignId, parseDesignResourceId } from './design-resource-id.js';
import { designVariableAliasId, withDesignVariableValue, type DesignVariable } from './design-variables.js';

export const defaultVariableCollectionId = 'default';

export type DesignVariableCollection = Readonly<{
  name?: string;
  defaultModeName?: string;
  modes?: Readonly<Record<string, string>>;
}>;
export type DesignVariableCollections = Readonly<Record<string, DesignVariableCollection>>;
export type DesignVariableModeIds = Readonly<Record<string, string>>;

export function designVariableCollectionKey(owner: string, collectionId = defaultVariableCollectionId): string {
  // Existing documents use the library ID for their original collection.
  return collectionId === defaultVariableCollectionId ? owner : designResourceId(owner, collectionId);
}

export function designVariableCollections(collections: DesignVariableCollections | undefined): DesignVariableCollections {
  return { [defaultVariableCollectionId]: {}, ...collections };
}

export function parseDesignVariableCollection(input: unknown, parseName: (value: unknown) => string): DesignVariableCollection {
  const { name, defaultModeName, modes } = variableRecord(input);
  return { name: name === undefined ? undefined : parseName(name), defaultModeName: defaultModeName === undefined ? undefined : parseName(defaultModeName),
    modes: modes === undefined ? undefined : Object.fromEntries(Object.entries(variableRecord(modes)).map(([id, label]) => [parseDesignId(id), parseName(label)])) };
}

export function parseDesignVariableCollections(input: unknown, legacyModes: unknown, parseName: (value: unknown) => string): DesignVariableCollections | undefined {
  if (input === undefined) return legacyModes === undefined ? undefined
    : { [defaultVariableCollectionId]: parseDesignVariableCollection({ modes: legacyModes }, parseName) };
  return Object.fromEntries(Object.entries(variableRecord(input)).map(([id, collection]) => [parseDesignId(id), parseDesignVariableCollection(collection, parseName)]));
}

export function parseDesignModeSelection(input: unknown): DesignVariableModeIds | undefined {
  if (input === undefined) return;
  return Object.fromEntries(Object.entries(variableRecord(input)).map(([key, mode]) => [parseDesignResourceId(key), parseDesignId(mode)]));
}

export function validateDesignVariableCollections(styles: Readonly<Record<string, DesignStyle>> | undefined, collections: DesignVariableCollections | undefined) {
  for (const resource of Object.values(styles ?? {})) {
    if (resource.kind === 'text') continue;
    const id = resource.collectionId ?? defaultVariableCollectionId;
    const collection = collections && Object.hasOwn(collections, id) ? collections[id] : undefined;
    if (!collection && id !== defaultVariableCollectionId) throw new Error('A design variable requires an existing collection.');
    if (resource.modeValues && Object.keys(resource.modeValues).some((mode) => !Object.hasOwn(collection?.modes ?? {}, mode))) {
      throw new Error('A design variable can only use modes from its collection.');
    }
    if (resource.modeAliasIds && Object.keys(resource.modeAliasIds).some((mode) => !Object.hasOwn(resource.modeValues ?? {}, mode))) {
      throw new Error('A variable alias requires a fallback value in its mode.');
    }
  }
}

export function planDesignVariableMove(
  styleId: string, variable: DesignVariable, source: DesignVariableCollection,
  destination: Readonly<{ id: string; collection: DesignVariableCollection }>,
): readonly DesignEdit[] {
  const availableModes = new Map(Object.entries(destination.collection.modes ?? {}));
  const modes: Record<string, string> = Object.assign(Object.create(null), destination.collection.modes);
  const edits: DesignEdit[] = [];
  let addedModes = false;
  let moved: DesignVariable = { ...variable, collectionId: destination.id === defaultVariableCollectionId ? undefined : destination.id,
    modeValues: undefined, modeAliasIds: undefined };

  for (const [id, name] of Object.entries(source.modes ?? {})) {
    const values = variable.modeValues;
    if (!values || !Object.hasOwn(values, id)) continue;
    let targetId = availableModes.get(id) === name ? id : [...availableModes].find(([, label]) => label === name)?.[0];
    if (targetId === undefined) {
      targetId = Object.hasOwn(modes, id) ? crypto.randomUUID() : id;
      modes[targetId] = name;
      addedModes = true;
    }
    // Each destination mode can receive one override, even when mode names repeat.
    availableModes.delete(targetId);
    moved = withDesignVariableValue(moved, targetId, values[id], designVariableAliasId(variable, id));
  }
  if (addedModes) edits.push({ kind: 'setVariableCollection', collectionId: destination.id, collection: { ...destination.collection, modes } });
  edits.push({ kind: 'setStyle', styleId, style: moved });
  return edits;
}

export function withoutDesignModes(frame: DesignFrame, key: string, removed: ReadonlySet<string>): DesignFrame {
  const selected = frame.variableModeIds?.[key];
  if (!selected || !removed.has(selected)) return frame;
  const modes = { ...frame.variableModeIds };
  delete modes[key];
  return { ...frame, variableModeIds: Object.keys(modes).length ? modes : undefined };
}

function variableRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid variable collection.');
  return input as Record<string, unknown>;
}
