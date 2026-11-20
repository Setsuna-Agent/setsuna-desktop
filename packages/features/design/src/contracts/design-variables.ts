import type { DesignNode, DesignStyle } from './document.js';
import { parseDesignColor } from './design-color.js';
import { isDesignFontWeight } from './design-fonts.js';
import { parseDesignId, parseDesignResourceId } from './design-resource-id.js';
import { rebaseDesignTextRuns } from './design-text-runs.js';
import { maxDesignPolygonSides, minDesignPolygonSides } from './vector-geometry.js';

export const designVariableKinds = ['color', 'number', 'string', 'boolean'] as const;
export type DesignVariableKind = (typeof designVariableKinds)[number];
export type DesignVariableValue = string | number | boolean;

type Variable<K extends DesignVariableKind, V extends DesignVariableValue> = Readonly<{
  kind: K;
  name: string;
  collectionId?: string;
  modeValues?: Readonly<Record<string, V>>;
  aliasId?: string;
  modeAliasIds?: Readonly<Record<string, string>>;
}>;

// Colors keep their existing style IDs and file representation.
export type DesignVariable =
  | (Variable<'color', string> & Readonly<{ color: string }>)
  | (Variable<'number', number> & Readonly<{ value: number }>)
  | (Variable<'string', string> & Readonly<{ value: string }>)
  | (Variable<'boolean', boolean> & Readonly<{ value: boolean }>);

const number = (value: DesignVariableValue) => typeof value === 'number' && Number.isFinite(value);
const positive = (value: DesignVariableValue) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const spacing = (value: DesignVariableValue) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const opacity = (value: DesignVariableValue) => typeof value === 'number' && value >= 0 && value <= 1;
const string = (value: DesignVariableValue) => typeof value === 'string';
const boolean = (value: DesignVariableValue) => typeof value === 'boolean';

const fields = {
  width: ['number', positive], height: ['number', positive], opacity: ['number', opacity],
  minWidth: ['number', spacing], maxWidth: ['number', positive], rotation: ['number', number],
  cornerRadius: ['number', spacing], 'cornerRadii.0': ['number', spacing], 'cornerRadii.1': ['number', spacing],
  'cornerRadii.2': ['number', spacing], 'cornerRadii.3': ['number', spacing],
  gap: ['number', spacing], paddingX: ['number', spacing], paddingY: ['number', spacing],
  'paddingSides.0': ['number', spacing], 'paddingSides.1': ['number', spacing],
  'paddingSides.2': ['number', spacing], 'paddingSides.3': ['number', spacing],
  x: ['number', number], y: ['number', number], blur: ['number', spacing],
  'crop.x': ['number', opacity], 'crop.y': ['number', opacity],
  'geometry.sides': ['number', (value) => typeof value === 'number' && Number.isInteger(value)
    && value >= minDesignPolygonSides && value <= maxDesignPolygonSides],
  fontSize: ['number', positive], lineHeight: ['number', positive], letterSpacing: ['number', number],
  fontWeight: ['number', isDesignFontWeight],
  fontFamily: ['string', (value) => typeof value === 'string' && Boolean(value.trim()) && value.length <= 128 && !/[\p{C}]/u.test(value)],
  text: ['string', string], hidden: ['boolean', boolean], clip: ['boolean', boolean], wrap: ['boolean', boolean],
} as const satisfies Record<string, readonly [DesignVariableKind, (value: DesignVariableValue) => boolean]>;

export type DesignVariableField = keyof typeof fields;
export type DesignVariableIds = Readonly<Partial<Record<DesignVariableField, string>>>;
export type DesignVariableTarget = Readonly<{ variableIds?: DesignVariableIds }>;
export const designTypographyVariableFields = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] as const;
export const designCornerVariableFields = ['cornerRadii.0', 'cornerRadii.1', 'cornerRadii.2', 'cornerRadii.3'] as const;
export const designPaddingVariableFields = ['paddingSides.0', 'paddingSides.1', 'paddingSides.2', 'paddingSides.3'] as const;
export const designLayoutVariableFields = ['gap', 'paddingX', 'paddingY', ...designPaddingVariableFields, 'wrap'] as const;
export const defaultDesignImageCrop = { x: 0.5, y: 0.5 } as const;

export function designLayerVariableFields(kind: unknown, geometry?: unknown): readonly DesignVariableField[] {
  const common = ['x', 'y', 'rotation', 'width', 'minWidth', 'maxWidth', 'opacity', 'hidden'] as const;
  if (kind === 'text') return [...common, 'text', ...designTypographyVariableFields];
  const box = [...common, 'height'] as const;
  const corners = ['cornerRadius', ...designCornerVariableFields] as const;
  if (kind === 'frame') return [...box, ...corners, 'clip'];
  if (kind === 'image') return [...box, 'crop.x', 'crop.y'];
  if (kind === 'vector' && geometry && typeof geometry === 'object' && 'kind' in geometry && geometry.kind === 'polygon') {
    return [...box, 'geometry.sides'];
  }
  return kind === 'rectangle' || kind === 'web' ? [...box, ...corners] : box;
}

function parseRecord<T>(input: unknown, parse: (value: unknown) => T): Readonly<Record<string, T>> | undefined {
  if (input === undefined) return;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid design variable data.');
  return Object.fromEntries(Object.entries(input).map(([id, value]) => [parseDesignId(id), parse(value)]));
}

export function parseDesignVariableIds(input: unknown, allowed: readonly DesignVariableField[]): DesignVariableIds | undefined {
  if (input === undefined) return;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid design variable bindings.');
  return Object.fromEntries(Object.entries(input).map(([field, value]) => {
    if (!(allowed as readonly string[]).includes(field)) throw new Error('Invalid design variable field.');
    return [field, parseDesignResourceId(value)];
  }));
}

export function parseDesignVariable(entry: Readonly<Record<string, unknown>>, name: string): DesignVariable {
  const { kind, value, modeValues, aliasId, modeAliasIds } = entry;
  const base = { name, collectionId: entry.collectionId === undefined ? undefined : parseDesignId(entry.collectionId),
    aliasId: aliasId === undefined ? undefined : parseDesignResourceId(aliasId), modeAliasIds: parseRecord(modeAliasIds, parseDesignResourceId) };
  switch (kind) {
    case 'color':
      return { ...base, kind, color: parseDesignColor(entry.color), modeValues: parseRecord(modeValues, parseDesignColor) };
    case 'number':
      return { ...base, kind, value: expectVariableValue(value, 'number'), modeValues: parseRecord(modeValues, (item) => expectVariableValue(item, 'number')) };
    case 'string':
      return { ...base, kind, value: expectVariableValue(value, 'string'), modeValues: parseRecord(modeValues, (item) => expectVariableValue(item, 'string')) };
    case 'boolean':
      return { ...base, kind, value: expectVariableValue(value, 'boolean'), modeValues: parseRecord(modeValues, (item) => expectVariableValue(item, 'boolean')) };
    default:
      throw new Error('Invalid design variable type.');
  }
}

type ScalarTypes = { number: number; string: string; boolean: boolean };
function expectVariableValue<K extends keyof ScalarTypes>(input: unknown, kind: K): ScalarTypes[K] {
  if (typeof input !== kind || (kind === 'number' && !Number.isFinite(input))) throw new Error('Invalid design variable value.');
  return input as ScalarTypes[K];
}

export function designVariableValue(variable: DesignVariable, mode?: string): DesignVariableValue {
  if (mode && variable.modeValues && Object.hasOwn(variable.modeValues, mode)) return variable.modeValues[mode];
  return variable.kind === 'color' ? variable.color : variable.value;
}

export function designVariableAliasId(variable: DesignVariable, mode?: string): string | undefined {
  if (mode && Object.hasOwn(variable.modeValues ?? {}, mode)) {
    return Object.hasOwn(variable.modeAliasIds ?? {}, mode) ? variable.modeAliasIds?.[mode] : undefined;
  }
  return variable.aliasId;
}

export function withDesignVariableValue(
  variable: DesignVariable, mode: string | undefined, value: DesignVariableValue | undefined, aliasId?: string,
): DesignVariable {
  if (value !== undefined && typeof value !== typeof designVariableValue(variable)) return variable;
  // The scalar check preserves the relationship between kind and the base and mode values.
  if (mode) {
    const values: Record<string, DesignVariableValue> = Object.assign(Object.create(null), variable.modeValues);
    const aliases: Record<string, string> = Object.assign(Object.create(null), variable.modeAliasIds);
    if (value === undefined) delete values[mode];
    else values[mode] = value;
    if (aliasId && value !== undefined) aliases[mode] = aliasId;
    else delete aliases[mode];
    return { ...variable, modeValues: Object.keys(values).length ? values : undefined,
      modeAliasIds: Object.keys(aliases).length ? aliases : undefined } as DesignVariable;
  }
  if (value === undefined) return variable;
  return variable.kind === 'color' ? { ...variable, color: value as string, aliasId } : { ...variable, value, aliasId } as DesignVariable;
}

export function designVariableFieldValue(field: DesignVariableField, style: DesignStyle | undefined): DesignVariableValue | undefined {
  const [kind, accepts] = fields[field];
  if (!style || style.kind !== kind) return;
  const value = designVariableValue(style);
  if (!accepts(value)) return;
  if (field === 'fontFamily' && typeof value === 'string') return value.trim();
  if (field === 'rotation' && typeof value === 'number') return normalizeDesignRotation(value);
  return value;
}

export function designVariableFieldKind(field: DesignVariableField): DesignVariableKind {
  return fields[field][0];
}

export function normalizeDesignRotation(value: number): number {
  const angle = value % 360;
  return angle >= 180 ? angle - 360 : angle < -180 ? angle + 360 : angle;
}

type DesignWidthLimits = Pick<DesignNode, 'minWidth' | 'maxWidth'>;

export function validDesignWidthLimits({ minWidth, maxWidth }: DesignWidthLimits): boolean {
  return minWidth === undefined || maxWidth === undefined || minWidth <= maxWidth;
}

function fieldValue(target: DesignVariableTarget, field: DesignVariableField): unknown {
  const [name, index] = field.split('.');
  const value = (target as Readonly<Record<string, unknown>>)[name] ?? (name === 'crop' ? defaultDesignImageCrop : undefined);
  if (index === undefined) return value;
  return value && typeof value === 'object' ? (value as Readonly<Record<string, unknown>>)[index] : undefined;
}

function withFieldValue<T extends DesignVariableTarget>(target: T, field: DesignVariableField, value: DesignVariableValue): T {
  if (fieldValue(target, field) === value) return target;
  const [name, index] = field.split('.');
  if (index === undefined) return { ...target, [name]: value };
  const nested = (target as Readonly<Record<string, unknown>>)[name] ?? (name === 'crop' ? defaultDesignImageCrop : undefined);
  if (Array.isArray(nested)) return { ...target, [name]: nested.map((entry, i) => i === Number(index) ? value : entry) };
  return nested && typeof nested === 'object' ? { ...target, [name]: { ...nested, [index]: value } } : target;
}

export function bindDesignVariable<T extends DesignVariableTarget>(
  target: T, field: DesignVariableField, id: string | undefined, value?: DesignVariableValue,
): T {
  const changed = value === undefined ? target : withFieldValue(target, field, value);
  const updated = (field === 'minWidth' || field === 'maxWidth') && !validDesignWidthLimits(changed as DesignWidthLimits) ? target : changed;
  if (target.variableIds?.[field] === id) return updated;
  const variableIds = { ...target.variableIds };
  if (id) variableIds[field] = id;
  else delete variableIds[field];
  return { ...updated, variableIds: Object.keys(variableIds).length ? variableIds : undefined };
}

export function resolveDesignVariableTarget<T extends DesignVariableTarget>(
  target: T, styles: Readonly<Record<string, DesignStyle>> | undefined, detachId?: string,
): T {
  if (!target.variableIds || !styles) return target;
  let resolved = target;
  for (const [property, id] of Object.entries(target.variableIds)) {
    if (detachId && id !== detachId) continue;
    const field = property as DesignVariableField;
    const value = designVariableFieldValue(field, Object.hasOwn(styles, id) ? styles[id] : undefined);
    if (detachId) resolved = bindDesignVariable(resolved, field, undefined, value);
    else if (value !== undefined) resolved = withFieldValue(resolved, field, value);
  }
  if (!validDesignWidthLimits(resolved as DesignWidthLimits)) {
    // Modes can change both bounds at once. Use the authored pair when a mode crosses them.
    const { minWidth, maxWidth } = target as DesignWidthLimits;
    return { ...resolved, minWidth, maxWidth };
  }
  return resolved;
}

export function mapDesignVariableIds<T extends DesignVariableTarget>(target: T, mapId: (id: string) => string | undefined): T {
  if (!target.variableIds) return target;
  const variableIds = Object.fromEntries(Object.entries(target.variableIds).flatMap(([field, id]) => {
    const mapped = mapId(id);
    return mapped ? [[field, mapped]] : [];
  }));
  return { ...target, variableIds: Object.keys(variableIds).length ? variableIds : undefined };
}

export function resolveDesignNodeVariables(node: DesignNode, styles: Readonly<Record<string, DesignStyle>> | undefined, detachId?: string): DesignNode {
  const resolve = <T extends DesignVariableTarget>(target: T) => resolveDesignVariableTarget(target, styles, detachId);
  const layer = resolve(node);
  const strokes = mapChanged(layer.strokes, resolve);
  const shadow = layer.shadow && resolve(layer.shadow);
  const appearance = strokes === layer.strokes && shadow === layer.shadow ? layer : { ...layer, strokes, shadow };
  if (appearance.kind === 'image') return appearance;
  const fills = mapChanged(appearance.fills, resolve);
  const filled = fills === appearance.fills ? appearance : { ...appearance, fills };
  if (filled.kind === 'frame' && filled.layout) {
    const layout = resolve(filled.layout);
    if (layout !== filled.layout) return { ...filled, layout };
  }
  return filled.kind === 'text' && node.kind === 'text' && filled.text !== node.text
    ? { ...filled, runs: rebaseDesignTextRuns(node.text, filled.text, filled.runs) } : filled;
}

function mapChanged<T extends DesignVariableTarget>(list: readonly T[] | undefined, resolve: (value: T) => T): readonly T[] | undefined {
  return list?.some((entry) => entry.variableIds) ? list.map(resolve) : list;
}

export function clearDesignChangedBindings(current: DesignNode, next: DesignNode): DesignNode {
  const layer = clearChanged(current, next);
  if (current.kind !== 'frame' || layer.kind !== 'frame' || !current.layout || !layer.layout) return layer;
  const layout = clearChanged(current.layout, layer.layout);
  return layout === layer.layout ? layer : { ...layer, layout };
}

export function clearChanged<T extends DesignVariableTarget>(current: DesignVariableTarget, next: T): T {
  if (!current.variableIds || !next.variableIds) return next;
  let result = next;
  for (const [property, id] of Object.entries(next.variableIds)) {
    const field = property as DesignVariableField;
    if (current.variableIds[field] === id && fieldValue(current, field) !== fieldValue(next, field)) {
      result = bindDesignVariable(result, field, undefined);
    }
  }
  return result;
}
