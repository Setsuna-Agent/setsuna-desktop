import { parseDesignColor } from './design-color.js';
import { maxExpandedDesignLayers } from './document.js';
import { designVariableKinds, type DesignVariableKind, type DesignVariableValue } from './design-variables.js';

export const maxDesignPreviewFrames = 2_048;

type PreviewVariableCell = Readonly<{ value: DesignVariableValue; alias?: number }>;
export type DesignPreviewVariables = Readonly<{
  collections: readonly Readonly<{ name: string; modes: readonly string[] }>[];
  entries: readonly Readonly<{ collection: number; name: string; kind: DesignVariableKind; cells: readonly PreviewVariableCell[] }>[];
}>;
export type DesignPreviewBoardModes = Readonly<{
  initial: readonly number[];
  axes: readonly Readonly<{ collection: number; modes: readonly number[] }>[];
}>;

export function designPreviewAxisCount(axis: DesignPreviewBoardModes['axes'][number]) {
  return Math.max(...axis.modes) + 1;
}

export function designPreviewVariantCount(plan?: DesignPreviewBoardModes) {
  return plan?.axes.reduce((count, axis) => count * designPreviewAxisCount(axis), 1) ?? 1;
}

export function designPreviewInitialVariant(plan: DesignPreviewBoardModes) {
  return plan.axes.reduce((index, axis) => index * designPreviewAxisCount(axis) + axis.modes[plan.initial[axis.collection]], 0);
}

export function parseDesignPreviewVariables(value: unknown): DesignPreviewVariables | undefined {
  if (value === undefined) return;
  const source = value as Partial<DesignPreviewVariables> | null;
  const collections = Array.from(array(source?.collections, maxExpandedDesignLayers), (value) => {
    const collection = value as DesignPreviewVariables['collections'][number] | null;
    return { name: label(collection?.name), modes: Array.from(array(collection?.modes, maxDesignPreviewFrames, 1), label) };
  });
  const rawEntries = array(source?.entries, maxExpandedDesignLayers);
  const entries = Array.from(rawEntries, (value) => {
    const entry = value as DesignPreviewVariables['entries'][number] | null;
    const collection = integer(entry?.collection, collections.length);
    if (!entry || !designVariableKinds.includes(entry.kind)) throw new Error('Invalid preview variable kind.');
    const { kind } = entry;
    const modeCount = collections[collection].modes.length;
    const cells = Array.from(array(entry.cells, modeCount, modeCount), (value): PreviewVariableCell => {
      const cell = value as PreviewVariableCell | null;
      return { value: scalar(cell?.value, kind), alias: cell?.alias === undefined ? undefined : integer(cell.alias, rawEntries.length) };
    });
    return { collection, kind, name: label(entry.name), cells };
  });
  return { collections, entries };
}

export function parseDesignPreviewBoardModes(value: unknown, variables: DesignPreviewVariables | undefined): DesignPreviewBoardModes | undefined {
  if (!variables && value === undefined) return;
  if (!variables || !value) throw new Error('Missing preview variable modes.');
  const source = value as Partial<DesignPreviewBoardModes>;
  const { collections } = variables;
  const initial = Array.from(array(source.initial, collections.length, collections.length),
    (mode, index) => integer(mode, collections[index].modes.length));
  let previous = -1;
  const axes = Array.from(array(source.axes, collections.length), (value) => {
    const axis = value as DesignPreviewBoardModes['axes'][number] | null;
    const collection = integer(axis?.collection, collections.length);
    const modeCount = collections[collection].modes.length;
    const modes = Array.from(array(axis?.modes, modeCount, modeCount), (mode) => integer(mode, modeCount));
    const unique = new Set(modes);
    if (collection <= previous || unique.size < 2 || Math.max(...modes) !== unique.size - 1) throw new Error('Invalid preview variant axis.');
    previous = collection;
    return { collection, modes };
  });
  const plan = { initial, axes };
  if (designPreviewVariantCount(plan) > maxDesignPreviewFrames) throw new Error('Too many preview variants.');
  return plan;
}

function array(value: unknown, max: number, min = 0): readonly unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('Invalid preview variable data.');
  return value;
}

function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= max) throw new Error('Invalid preview variable index.');
  return value;
}

function label(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error('Invalid preview variable label.');
  return value;
}

function scalar(value: unknown, kind: DesignVariableKind): DesignVariableValue {
  if (kind === 'color') return parseDesignColor(value);
  if (kind === 'boolean' && typeof value === 'boolean' || kind === 'string' && typeof value === 'string'
    || kind === 'number' && typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('Invalid preview variable value.');
}
