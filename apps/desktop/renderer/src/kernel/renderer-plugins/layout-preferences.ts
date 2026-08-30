export const RENDERER_LAYOUT_PREFERENCES_STORAGE_KEY = 'setsuna.renderer-layout-preferences';

export type RendererListPreference = Readonly<{
  hiddenEntryIds?: readonly string[];
  order?: readonly string[];
}>;

export type RendererLayoutPreferencesV1 = Readonly<{
  schemaVersion: 1;
  singleSelections: Readonly<Record<string, string>>;
  keyedSelections: Readonly<Record<string, Readonly<Record<string, string>>>>;
  listPreferences: Readonly<Record<string, RendererListPreference>>;
}>;

export type RendererLayoutPreferenceLoadResult = Readonly<{
  issues: readonly string[];
  preferences: RendererLayoutPreferencesV1;
}>;

export interface RendererLayoutPreferenceStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface RendererLayoutPreferenceStore {
  clear(): void;
  load(): RendererLayoutPreferenceLoadResult;
  save(preferences: RendererLayoutPreferencesV1): void;
}

export function emptyRendererLayoutPreferences(): RendererLayoutPreferencesV1 {
  return Object.freeze({
    schemaVersion: 1,
    singleSelections: Object.freeze({}),
    keyedSelections: Object.freeze({}),
    listPreferences: Object.freeze({}),
  });
}

export function decodeRendererLayoutPreferences(value: unknown): RendererLayoutPreferencesV1 {
  const record = objectRecord(value, 'layout preferences');
  if (record.schemaVersion !== 1) throw new Error('Unsupported layout preference schemaVersion.');
  return Object.freeze({
    schemaVersion: 1,
    singleSelections: stringRecord(record.singleSelections, 'singleSelections'),
    keyedSelections: nestedStringRecord(record.keyedSelections, 'keyedSelections'),
    listPreferences: listPreferenceRecord(record.listPreferences),
  });
}

export function createRendererLayoutPreferenceStore(
  storage: RendererLayoutPreferenceStorage,
): RendererLayoutPreferenceStore {
  return Object.freeze({
    clear: () => storage.removeItem(RENDERER_LAYOUT_PREFERENCES_STORAGE_KEY),
    load: () => {
      const source = storage.getItem(RENDERER_LAYOUT_PREFERENCES_STORAGE_KEY);
      if (source === null) return Object.freeze({ issues: Object.freeze([]), preferences: emptyRendererLayoutPreferences() });
      try {
        return Object.freeze({
          issues: Object.freeze([]),
          preferences: decodeRendererLayoutPreferences(JSON.parse(source) as unknown),
        });
      } catch (error) {
        return Object.freeze({
          issues: Object.freeze([error instanceof Error ? error.message : String(error)]),
          preferences: emptyRendererLayoutPreferences(),
        });
      }
    },
    save: (preferences: RendererLayoutPreferencesV1) => {
      const normalized = decodeRendererLayoutPreferences(preferences);
      storage.setItem(RENDERER_LAYOUT_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
    },
  });
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  const record = objectRecord(value, label);
  const result: Record<string, string> = {};
  for (const [key, entryId] of Object.entries(record)) {
    if (!key.trim() || typeof entryId !== 'string' || !entryId.trim()) {
      throw new Error(`${label} must contain non-empty string identities.`);
    }
    result[key] = entryId;
  }
  return Object.freeze(result);
}

function nestedStringRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  const record = objectRecord(value, label);
  const result: Record<string, Readonly<Record<string, string>>> = {};
  for (const [slotId, selections] of Object.entries(record)) {
    if (!slotId.trim()) throw new Error(`${label} contains an empty Slot identity.`);
    result[slotId] = stringRecord(selections, `${label}.${slotId}`);
  }
  return Object.freeze(result);
}

function listPreferenceRecord(
  value: unknown,
): Readonly<Record<string, RendererListPreference>> {
  const record = objectRecord(value, 'listPreferences');
  const result: Record<string, RendererListPreference> = {};
  for (const [slotId, rawPreference] of Object.entries(record)) {
    if (!slotId.trim()) throw new Error('listPreferences contains an empty Slot identity.');
    const preference = objectRecord(rawPreference, `listPreferences.${slotId}`);
    const hiddenEntryIds = optionalStringArray(preference.hiddenEntryIds, `${slotId}.hiddenEntryIds`);
    const order = optionalStringArray(preference.order, `${slotId}.order`);
    result[slotId] = Object.freeze({
      ...(hiddenEntryIds ? { hiddenEntryIds } : {}),
      ...(order ? { order } : {}),
    });
  }
  return Object.freeze(result);
}

function optionalStringArray(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicate identities.`);
  return Object.freeze([...value]);
}
