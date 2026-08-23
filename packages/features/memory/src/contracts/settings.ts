import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineFeatureSettingsBundle,
  defineFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import { memoryFeature } from './definition.js';

export type MemoryPreferences = Readonly<{
  useMemories: boolean;
  generateMemories: boolean;
  disableOnExternalContext: boolean;
  extractionModel: RuntimeConfiguredModelReference | null;
  consolidationModel: RuntimeConfiguredModelReference | null;
  /** Compatibility fallback for pre-Feature settings that stored a raw model code. */
  extractionModelCode?: string;
  /** Compatibility fallback for pre-Feature settings that stored a raw model code. */
  consolidationModelCode?: string;
  minRateLimitRemainingPercent?: number;
  maxRolloutsPerStartup?: number;
  maxRolloutAgeDays?: number;
  minRolloutIdleHours?: number;
  maxUnusedDays?: number;
  maxRawMemoriesForConsolidation?: number;
}>;

export type MemoryPreferencesPatch = Readonly<{
  useMemories?: boolean;
  generateMemories?: boolean;
  disableOnExternalContext?: boolean;
  extractionModel?: RuntimeConfiguredModelReference | null;
  consolidationModel?: RuntimeConfiguredModelReference | null;
  extractionModelCode?: string | null;
  consolidationModelCode?: string | null;
  minRateLimitRemainingPercent?: number | null;
  maxRolloutsPerStartup?: number | null;
  maxRolloutAgeDays?: number | null;
  minRolloutIdleHours?: number | null;
  maxUnusedDays?: number | null;
  maxRawMemoriesForConsolidation?: number | null;
}>;

export const DEFAULT_MEMORY_PREFERENCES: MemoryPreferences = Object.freeze({
  useMemories: true,
  generateMemories: true,
  disableOnExternalContext: false,
  extractionModel: null,
  consolidationModel: null,
});

export const memoryPreferencesCodec = defineRuntimeCodec<MemoryPreferences>((value) => {
  const record = objectRecord(value, 'Memory preferences must be an object.');
  return Object.freeze({
    useMemories: booleanValue(record.useMemories, true, 'useMemories'),
    generateMemories: booleanValue(record.generateMemories, true, 'generateMemories'),
    disableOnExternalContext: booleanValue(record.disableOnExternalContext, false, 'disableOnExternalContext'),
    extractionModel: modelReference(record.extractionModel, 'extractionModel'),
    consolidationModel: modelReference(record.consolidationModel, 'consolidationModel'),
    ...optionalString(record, 'extractionModelCode'),
    ...optionalString(record, 'consolidationModelCode'),
    ...optionalInteger(record, 'minRateLimitRemainingPercent', 0, 100),
    ...optionalInteger(record, 'maxRolloutsPerStartup', 1),
    ...optionalInteger(record, 'maxRolloutAgeDays', 0),
    ...optionalInteger(record, 'minRolloutIdleHours', 1),
    ...optionalInteger(record, 'maxUnusedDays', 1),
    ...optionalInteger(record, 'maxRawMemoriesForConsolidation', 1),
  });
});

export const memoryPreferencesPatchCodec = defineRuntimeCodec<MemoryPreferencesPatch>((value) => {
  const record = objectRecord(value, 'Memory preferences patch must be an object.');
  return Object.freeze({
    ...optionalBooleanPatch(record, 'useMemories'),
    ...optionalBooleanPatch(record, 'generateMemories'),
    ...optionalBooleanPatch(record, 'disableOnExternalContext'),
    ...optionalModelPatch(record, 'extractionModel'),
    ...optionalModelPatch(record, 'consolidationModel'),
    ...optionalNullableString(record, 'extractionModelCode'),
    ...optionalNullableString(record, 'consolidationModelCode'),
    ...optionalNullableInteger(record, 'minRateLimitRemainingPercent', 0, 100),
    ...optionalNullableInteger(record, 'maxRolloutsPerStartup', 1),
    ...optionalNullableInteger(record, 'maxRolloutAgeDays', 0),
    ...optionalNullableInteger(record, 'minRolloutIdleHours', 1),
    ...optionalNullableInteger(record, 'maxUnusedDays', 1),
    ...optionalNullableInteger(record, 'maxRawMemoriesForConsolidation', 1),
  });
});

const preferencesDocument = defineFeatureSettingsDocument<
  MemoryPreferences,
  MemoryPreferences,
  MemoryPreferencesPatch,
  undefined
>({
  currentVersion: 1,
  schema: memoryPreferencesCodec,
  defaults: () => DEFAULT_MEMORY_PREFERENCES,
  migrations: Object.freeze({}),
  publicProjection: (value) => value,
  applyPatch: (value, patch) => applyMemoryPreferencesPatch(value, patch),
  secretNames: [],
  normalizeSecretPatch: () => Object.freeze({}),
  syncPolicy: 'portable',
  retentionPolicy: 'retain-until-explicit-delete',
  applyPolicy: 'next-turn',
});

export const memorySettings = defineFeatureSettingsBundle({
  featureId: memoryFeature.id,
  documents: { preferences: preferencesDocument },
});

export function applyMemoryPreferencesPatch(
  value: MemoryPreferences,
  patch: MemoryPreferencesPatch,
): MemoryPreferences {
  const next: Record<string, unknown> = { ...value };
  for (const [key, item] of Object.entries(patch)) {
    if (item === null && key !== 'extractionModel' && key !== 'consolidationModel') delete next[key];
    else next[key] = item;
  }
  if (Object.hasOwn(patch, 'extractionModel')) delete next.extractionModelCode;
  if (Object.hasOwn(patch, 'consolidationModel')) delete next.consolidationModelCode;
  return memoryPreferencesCodec.parse(next);
}

function modelReference(value: unknown, label: string): RuntimeConfiguredModelReference | null {
  if (value === undefined || value === null) return null;
  const record = objectRecord(value, `Memory ${label} must be an object or null.`);
  return Object.freeze({
    providerId: stableId(record.providerId, `${label}.providerId`),
    modelId: stableId(record.modelId, `${label}.modelId`),
  });
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) {
    throw new Error(`Memory ${label} is invalid.`);
  }
  return value.trim();
}

function booleanValue(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`Memory ${label} must be a boolean.`);
  return value;
}

function optionalBooleanPatch(record: Record<string, unknown>, key: string): Record<string, boolean> {
  if (!Object.hasOwn(record, key)) return {};
  if (typeof record[key] !== 'boolean') throw new Error(`Memory ${key} must be a boolean.`);
  return { [key]: record[key] } as Record<string, boolean>;
}

function optionalModelPatch(record: Record<string, unknown>, key: string): Record<string, RuntimeConfiguredModelReference | null> {
  if (!Object.hasOwn(record, key)) return {};
  return { [key]: modelReference(record[key], key) };
}

function optionalString(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  if (value === undefined) return {};
  if (typeof value !== 'string') throw new Error(`Memory ${key} must be a string.`);
  const normalized = value.trim();
  return normalized ? { [key]: normalized } : {};
}

function optionalNullableString(record: Record<string, unknown>, key: string): Record<string, string | null> {
  if (!Object.hasOwn(record, key)) return {};
  if (record[key] === null) return { [key]: null };
  if (typeof record[key] !== 'string') throw new Error(`Memory ${key} must be a string or null.`);
  return { [key]: (record[key] as string).trim() || null };
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): Record<string, number> {
  const value = record[key];
  if (value === undefined) return {};
  return { [key]: integer(value, key, minimum, maximum) };
}

function optionalNullableInteger(
  record: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): Record<string, number | null> {
  if (!Object.hasOwn(record, key)) return {};
  if (record[key] === null) return { [key]: null };
  return { [key]: integer(record[key], key, minimum, maximum) };
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Memory ${label} is invalid.`);
  }
  return value as number;
}
