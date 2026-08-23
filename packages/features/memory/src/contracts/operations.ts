import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  MemoryModelOption,
  MemorySettingsState,
  MemorySettingsUpdate,
} from './capabilities.js';
import {
  memoryPreferencesCodec,
  memoryPreferencesPatchCodec,
} from './settings.js';
import type { RuntimeMemoryPreview, RuntimeMemoryPreviewItem } from './types.js';

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined;
  throw new Error('Operation does not accept input.');
});

export const memorySettingsStateCodec = defineRuntimeCodec<MemorySettingsState>((value) => {
  const record = objectRecord(value, 'Memory settings state must be an object.');
  if (!Array.isArray(record.availableModels)) throw new Error('Memory model options must be an array.');
  return Object.freeze({
    value: memoryPreferencesCodec.parse(record.value),
    revision: nonNegativeInteger(record.revision, 'settings revision'),
    availableModels: Object.freeze(record.availableModels.map(modelOption)),
  });
});

const memorySettingsUpdateCodec = defineRuntimeCodec<MemorySettingsUpdate>((value) => {
  const record = objectRecord(value, 'Memory settings update must be an object.');
  return Object.freeze({
    expectedRevision: nonNegativeInteger(record.expectedRevision, 'expected revision'),
    patch: memoryPreferencesPatchCodec.parse(record.patch ?? {}),
  });
});

export const memoryPreviewCodec = defineRuntimeCodec<RuntimeMemoryPreview>((value) => {
  const record = objectRecord(value, 'Memory preview must be an object.');
  if (typeof record.storagePath !== 'string' || !Array.isArray(record.items)) {
    throw new Error('Memory preview is invalid.');
  }
  return Object.freeze({
    storagePath: record.storagePath,
    total: nonNegativeInteger(record.total, 'preview total'),
    items: record.items.map(previewItem),
  });
});

const deleteMemoryInputCodec = defineRuntimeCodec<Readonly<{ memoryId: string }>>((value) => {
  const record = objectRecord(value, 'Delete memory input must be an object.');
  return Object.freeze({ memoryId: stableId(record.memoryId, 'memoryId') });
});

const mutationResultCodec = defineRuntimeCodec<Readonly<{ ok: true }>>((value) => {
  const record = objectRecord(value, 'Memory mutation result must be an object.');
  if (record.ok !== true) throw new Error('Memory mutation result is invalid.');
  return Object.freeze({ ok: true });
});

export const readMemorySettings = defineFeatureOperation({
  id: 'memory.settings.read',
  method: 'GET',
  path: '/v1/features/memory/settings',
  input: emptyInputCodec,
  output: memorySettingsStateCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'safe',
});

export const updateMemorySettings = defineFeatureOperation({
  id: 'memory.settings.update',
  method: 'PATCH',
  path: '/v1/features/memory/settings',
  input: memorySettingsUpdateCodec,
  output: memorySettingsStateCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'idempotent',
});

export const previewMemory = defineFeatureOperation({
  id: 'memory.preview.read',
  method: 'GET',
  path: '/v1/features/memory/preview',
  input: emptyInputCodec,
  output: memoryPreviewCodec,
  errors: Object.freeze({ DEPENDENCY_UNAVAILABLE: { status: 503 } }),
  idempotency: 'safe',
});

export const deleteMemory = defineFeatureOperation({
  id: 'memory.item.delete',
  method: 'DELETE',
  path: '/v1/features/memory/items/:memoryId',
  input: deleteMemoryInputCodec,
  output: mutationResultCodec,
  errors: Object.freeze({ DEPENDENCY_UNAVAILABLE: { status: 503 } }),
  idempotency: 'idempotent',
});

export const clearMemory = defineFeatureOperation({
  id: 'memory.store.clear',
  method: 'DELETE',
  path: '/v1/features/memory/items',
  input: emptyInputCodec,
  output: mutationResultCodec,
  errors: Object.freeze({ DEPENDENCY_UNAVAILABLE: { status: 503 } }),
  idempotency: 'idempotent',
});

function previewItem(value: unknown): RuntimeMemoryPreviewItem {
  const record = objectRecord(value, 'Memory preview item must be an object.');
  const scope = record.scope === 'global' || record.scope === 'project' ? record.scope : null;
  const origin = record.origin === 'active' || record.origin === 'passive' ? record.origin : null;
  if (!scope || !origin) throw new Error('Memory preview item scope or origin is invalid.');
  for (const key of ['id', 'title', 'updatedAt', 'preview'] as const) {
    if (typeof record[key] !== 'string') throw new Error(`Memory preview item ${key} is invalid.`);
  }
  return Object.freeze({
    id: record.id as string,
    title: record.title as string,
    scope,
    origin,
    ...(memoryKind(record.kind) ? { kind: memoryKind(record.kind) } : {}),
    ...optionalText(record, 'source'),
    ...optionalText(record, 'projectId'),
    ...optionalText(record, 'workspaceRoot'),
    ...optionalText(record, 'storageRoot'),
    ...optionalText(record, 'createdAt'),
    updatedAt: record.updatedAt as string,
    chars: nonNegativeInteger(record.chars, 'preview item chars'),
    preview: record.preview as string,
    ...(Array.isArray(record.tags)
      ? { tags: record.tags.filter((tag): tag is string => typeof tag === 'string') }
      : {}),
  });
}

function modelOption(value: unknown): MemoryModelOption {
  const record = objectRecord(value, 'Memory model option must be an object.');
  return Object.freeze({
    providerId: stableId(record.providerId, 'providerId'),
    providerName: stableId(record.providerName, 'providerName'),
    modelId: stableId(record.modelId, 'modelId'),
    modelName: stableId(record.modelName, 'modelName'),
    modelCode: stableId(record.modelCode, 'modelCode'),
  });
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 512) {
    throw new Error(`Memory ${label} is invalid.`);
  }
  return value.trim();
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Memory ${label} is invalid.`);
  return value as number;
}

function optionalText(record: Record<string, unknown>, key: string): Record<string, string> {
  return typeof record[key] === 'string' ? { [key]: record[key] as string } : {};
}

function memoryKind(value: unknown): RuntimeMemoryPreviewItem['kind'] | undefined {
  return value === 'preference' || value === 'project_rule' || value === 'fact'
    || value === 'workflow' || value === 'decision' || value === 'note'
    ? value
    : undefined;
}
