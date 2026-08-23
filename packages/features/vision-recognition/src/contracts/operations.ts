import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import {
  VISION_RECOGNITION_PROMPT_MAX_CHARS,
  type VisionRecognitionHealth,
  type VisionRecognitionModelOption,
  type VisionRecognitionSettingsState,
  type VisionRecognitionSettingsUpdate,
  type VisionRecognitionTestInput,
  type VisionRecognitionTestResult,
} from './service.js';
import { visionRecognitionModelSelectionCodec } from './settings.js';

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined;
  throw new Error('Operation does not accept input.');
});

export const visionRecognitionSettingsStateCodec = defineRuntimeCodec<VisionRecognitionSettingsState>((value) => {
  const record = objectRecord(value, 'Vision recognition settings state must be an object.');
  const health = visionHealth(record.health);
  if (!Array.isArray(record.availableModels)) throw new Error('Vision recognition models must be an array.');
  return Object.freeze({
    selection: visionRecognitionModelSelectionCodec.parse(record.selection),
    revision: nonNegativeInteger(record.revision, 'settings revision'),
    appliedRevision: record.appliedRevision === null
      ? null
      : nonNegativeInteger(record.appliedRevision, 'applied settings revision'),
    availableModels: Object.freeze(record.availableModels.map(modelOption)),
    health,
  });
});

const settingsUpdateCodec = defineRuntimeCodec<VisionRecognitionSettingsUpdate>((value) => {
  const record = objectRecord(value, 'Vision recognition settings update must be an object.');
  return Object.freeze({
    expectedRevision: nonNegativeInteger(record.expectedRevision, 'expected revision'),
    selection: visionRecognitionModelSelectionCodec.parse(record.selection),
  });
});

const testInputCodec = defineRuntimeCodec<VisionRecognitionTestInput>((value) => {
  const record = objectRecord(value, 'Vision recognition test input must be an object.');
  if (typeof record.prompt !== 'string' || !record.prompt.trim()) {
    throw new Error('Vision recognition prompt must be a non-empty string.');
  }
  const prompt = record.prompt.trim();
  if (prompt.length > VISION_RECOGNITION_PROMPT_MAX_CHARS) {
    throw new Error('Vision recognition prompt is too long.');
  }
  return Object.freeze({ prompt });
});

const testResultCodec = defineRuntimeCodec<VisionRecognitionTestResult>((value) => {
  const record = objectRecord(value, 'Vision recognition test result must be an object.');
  if (typeof record.content !== 'string' || !record.content.trim()) {
    throw new Error('Vision recognition test content must be a non-empty string.');
  }
  if (record.model !== undefined && typeof record.model !== 'string') {
    throw new Error('Vision recognition test model must be a string.');
  }
  return Object.freeze({
    content: record.content,
    durationMs: nonNegativeInteger(record.durationMs, 'test duration'),
    ...(typeof record.model === 'string' ? { model: record.model } : {}),
  });
});

export const readVisionRecognitionSettings = defineFeatureOperation({
  id: 'vision-recognition.settings.read',
  method: 'GET',
  path: '/v1/features/vision-recognition/settings',
  input: emptyInputCodec,
  output: visionRecognitionSettingsStateCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'safe',
});

export const updateVisionRecognitionSettings = defineFeatureOperation({
  id: 'vision-recognition.settings.update',
  method: 'PATCH',
  path: '/v1/features/vision-recognition/settings',
  input: settingsUpdateCodec,
  output: visionRecognitionSettingsStateCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'idempotent',
});

export const testVisionRecognition = defineFeatureOperation({
  id: 'vision-recognition.model.test',
  method: 'POST',
  path: '/v1/features/vision-recognition/test',
  input: testInputCodec,
  output: testResultCodec,
  errors: Object.freeze({
    PLUGIN_NOT_INSTALLED: { status: 404 },
    FEATURE_NOT_CONFIGURED: { status: 409 },
    MODEL_UNAVAILABLE: { status: 409 },
    PROVIDER_UNAVAILABLE: { status: 503 },
  }),
  idempotency: 'non-idempotent',
});

function modelOption(value: unknown): VisionRecognitionModelOption {
  const record = objectRecord(value, 'Vision recognition model option must be an object.');
  for (const key of ['providerId', 'providerName', 'modelId', 'modelName', 'modelCode'] as const) {
    if (typeof record[key] !== 'string' || !record[key]) throw new Error(`Vision recognition ${key} is invalid.`);
  }
  return Object.freeze({
    providerId: record.providerId as string,
    providerName: record.providerName as string,
    modelId: record.modelId as string,
    modelName: record.modelName as string,
    modelCode: record.modelCode as string,
  });
}

function visionHealth(value: unknown): VisionRecognitionHealth {
  if (
    value !== 'ready'
    && value !== 'not-configured'
    && value !== 'model-unavailable'
    && value !== 'provider-unavailable'
    && value !== 'settings-invalid'
  ) throw new Error('Vision recognition health is invalid.');
  return value;
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Vision recognition ${label} is invalid.`);
  }
  return value as number;
}
