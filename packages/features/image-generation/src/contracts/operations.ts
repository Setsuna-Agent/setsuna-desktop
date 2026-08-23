import {
  isRuntimeRasterImageMimeType,
  type RuntimeGeneratedMessageAttachment,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  ImageGenerationSettingsState,
  ImageGenerationSettingsUpdate,
  ImageGenerationTestInput,
  ImageGenerationTestResult,
} from './service.js';
import {
  imageGenerationConnectionPatchCodec,
  imageGenerationSecretPatchCodec,
  type ImageGenerationPublicConnection,
} from './settings.js';

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined;
  throw new Error('Operation does not accept input.');
});

export const imageGenerationSettingsStateCodec = defineRuntimeCodec<ImageGenerationSettingsState>((value) => {
  const record = objectRecord(value, 'Image generation settings state must be an object.');
  const revision = nonNegativeInteger(record.revision, 'settings revision');
  const appliedRevision = record.appliedRevision === null
    ? null
    : nonNegativeInteger(record.appliedRevision, 'applied settings revision');
  if (
    record.health !== 'ready'
    && record.health !== 'not-configured'
    && record.health !== 'credentials-missing'
    && record.health !== 'provider-unavailable'
    && record.health !== 'settings-invalid'
  ) throw new Error('Image generation health is invalid.');
  return Object.freeze({
    value: publicConnection(record.value),
    revision,
    appliedRevision,
    health: record.health,
  });
});

const settingsUpdateCodec = defineRuntimeCodec<ImageGenerationSettingsUpdate>((value) => {
  const record = objectRecord(value, 'Image generation settings update must be an object.');
  return Object.freeze({
    expectedRevision: nonNegativeInteger(record.expectedRevision, 'expected revision'),
    patch: imageGenerationConnectionPatchCodec.parse(record.patch ?? {}),
    ...(record.secretPatch === undefined
      ? {}
      : { secretPatch: imageGenerationSecretPatchCodec.parse(record.secretPatch) }),
  });
});

const testInputCodec = defineRuntimeCodec<ImageGenerationTestInput>((value) => {
  const record = objectRecord(value, 'Image generation test input must be an object.');
  if (typeof record.prompt !== 'string' || !record.prompt.trim()) {
    throw new Error('Image generation prompt must be a non-empty string.');
  }
  return Object.freeze({ prompt: record.prompt.trim() });
});

const testResultCodec = defineRuntimeCodec<ImageGenerationTestResult>((value) => {
  const record = objectRecord(value, 'Image generation test result must be an object.');
  if (!Array.isArray(record.images)) throw new Error('Image generation test images must be an array.');
  const images = record.images.map(generatedAttachment);
  const durationMs = nonNegativeInteger(record.durationMs, 'test duration');
  if (record.model !== undefined && typeof record.model !== 'string') {
    throw new Error('Image generation test model must be a string.');
  }
  return Object.freeze({
    images,
    durationMs,
    ...(typeof record.model === 'string' ? { model: record.model } : {}),
  });
});

export const readImageGenerationSettings = defineFeatureOperation({
  id: 'image-generation.settings.read',
  method: 'GET',
  path: '/v1/features/image-generation/settings',
  input: emptyInputCodec,
  output: imageGenerationSettingsStateCodec,
  errors: Object.freeze({
    SETTINGS_UNAVAILABLE: { status: 503 },
  }),
  idempotency: 'safe',
});

export const updateImageGenerationSettings = defineFeatureOperation({
  id: 'image-generation.settings.update',
  method: 'PATCH',
  path: '/v1/features/image-generation/settings',
  input: settingsUpdateCodec,
  output: imageGenerationSettingsStateCodec,
  errors: Object.freeze({
    SETTINGS_UNAVAILABLE: { status: 503 },
  }),
  idempotency: 'idempotent',
});

export const testImageGenerationConnection = defineFeatureOperation({
  id: 'image-generation.connection.test',
  method: 'POST',
  path: '/v1/features/image-generation/test',
  input: testInputCodec,
  output: testResultCodec,
  errors: Object.freeze({}),
  idempotency: 'non-idempotent',
});

function publicConnection(value: unknown): ImageGenerationPublicConnection {
  const record = objectRecord(value, 'Image generation public connection must be an object.');
  if (
    typeof record.baseUrl !== 'string'
    || typeof record.model !== 'string'
    || typeof record.apiKeySet !== 'boolean'
    || typeof record.apiKeyPreview !== 'string'
  ) throw new Error('Image generation public connection is invalid.');
  return Object.freeze({
    baseUrl: record.baseUrl,
    model: record.model,
    apiKeySet: record.apiKeySet,
    apiKeyPreview: record.apiKeyPreview,
  });
}

function generatedAttachment(value: unknown): RuntimeGeneratedMessageAttachment {
  const record = objectRecord(value, 'Generated image attachment must be an object.');
  if (
    record.source !== 'generated'
    || typeof record.id !== 'string'
    || typeof record.name !== 'string'
    || typeof record.type !== 'string'
    || !isRuntimeRasterImageMimeType(record.type)
    || !Number.isSafeInteger(record.size)
    || (record.size as number) <= 0
    || typeof record.assetId !== 'string'
  ) throw new Error('Generated image attachment is invalid.');
  return Object.freeze({
    id: record.id,
    name: record.name,
    type: record.type,
    size: record.size as number,
    source: 'generated',
    assetId: record.assetId,
    ...(record.modelVisible === false ? { modelVisible: false } : {}),
  });
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Image generation ${label} is invalid.`);
  return value as number;
}
