import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import {
  type ThreadTitleGenerationModelOption,
  type ThreadTitleGenerationSettingsState,
  type ThreadTitleGenerationSettingsUpdate,
} from './capabilities.js';
import { threadTitleGenerationModelSelectionCodec } from './settings.js';

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined;
  throw new Error('Operation does not accept input.');
});

export const threadTitleGenerationSettingsStateCodec = defineRuntimeCodec<ThreadTitleGenerationSettingsState>((value) => {
  const record = objectRecord(value, 'Thread title generation settings state must be an object.');
  if (!Array.isArray(record.availableModels)) {
    throw new Error('Thread title generation availableModels must be an array.');
  }
  return Object.freeze({
    selection: threadTitleGenerationModelSelectionCodec.parse(record.selection),
    revision: nonNegativeInteger(record.revision, 'revision'),
    availableModels: Object.freeze(record.availableModels.map(modelOption)),
  });
});

const settingsUpdateCodec = defineRuntimeCodec<ThreadTitleGenerationSettingsUpdate>((value) => {
  const record = objectRecord(value, 'Thread title generation settings update must be an object.');
  return Object.freeze({
    expectedRevision: nonNegativeInteger(record.expectedRevision, 'expectedRevision'),
    selection: threadTitleGenerationModelSelectionCodec.parse(record.selection),
  });
});

export const readThreadTitleGenerationSettings = defineFeatureOperation({
  id: 'thread-title-generation.settings.read',
  method: 'GET',
  path: '/v1/features/thread-title-generation/settings',
  input: emptyInputCodec,
  output: threadTitleGenerationSettingsStateCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'safe',
});

export const updateThreadTitleGenerationSettings = defineFeatureOperation({
  id: 'thread-title-generation.settings.update',
  method: 'PATCH',
  path: '/v1/features/thread-title-generation/settings',
  input: settingsUpdateCodec,
  output: threadTitleGenerationSettingsStateCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'idempotent',
});

function modelOption(value: unknown): ThreadTitleGenerationModelOption {
  const record = objectRecord(value, 'Thread title generation model option must be an object.');
  for (const key of ['providerId', 'providerName', 'modelId', 'modelName', 'modelCode'] as const) {
    if (typeof record[key] !== 'string' || !record[key]) {
      throw new Error(`Thread title generation ${key} is invalid.`);
    }
  }
  return Object.freeze({
    providerId: record.providerId as string,
    providerName: record.providerName as string,
    modelId: record.modelId as string,
    modelName: record.modelName as string,
    modelCode: record.modelCode as string,
  });
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Thread title generation ${label} is invalid.`);
  }
  return value as number;
}
