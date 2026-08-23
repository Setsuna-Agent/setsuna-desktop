import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineFeatureSettingsBundle,
  defineFeatureSettingsDocument,
  type FeatureSecretMetadata,
} from '@setsuna-desktop/feature-core/settings';
import { imageGenerationFeature } from './definition.js';

export type ImageGenerationConnection = Readonly<{
  baseUrl: string;
  model: string;
}>;

export type ImageGenerationPublicConnection = ImageGenerationConnection & Readonly<{
  apiKeySet: boolean;
  apiKeyPreview: string;
}>;

export type ImageGenerationConnectionPatch = Readonly<{
  baseUrl?: string;
  model?: string;
}>;

export type ImageGenerationSecretPatch = Readonly<{
  apiKey?: string;
  clearApiKey?: boolean;
}>;

export function normalizeImageGenerationServiceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && Boolean(url.hostname)
      && !url.username
      && !url.password
      ? normalized
      : null;
  } catch {
    return null;
  }
}

export const imageGenerationConnectionCodec = defineRuntimeCodec<ImageGenerationConnection>((value) => {
  const record = objectRecord(value, 'Image generation connection must be an object.');
  const baseUrl = normalizeImageGenerationServiceUrl(record.baseUrl);
  if (baseUrl === null) throw new Error('Image generation baseUrl must be an HTTP or HTTPS URL.');
  if (typeof record.model !== 'string') throw new Error('Image generation model must be a string.');
  return Object.freeze({ baseUrl, model: record.model.trim() });
});

export const imageGenerationConnectionPatchCodec = defineRuntimeCodec<ImageGenerationConnectionPatch>((value) => {
  const record = objectRecord(value, 'Image generation settings patch must be an object.');
  const baseUrl = record.baseUrl === undefined
    ? undefined
    : normalizeImageGenerationServiceUrl(record.baseUrl);
  if (baseUrl === null) throw new Error('Image generation baseUrl must be an HTTP or HTTPS URL.');
  if (record.model !== undefined && typeof record.model !== 'string') {
    throw new Error('Image generation model must be a string.');
  }
  return Object.freeze({
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(typeof record.model === 'string' ? { model: record.model.trim() } : {}),
  });
});

export const imageGenerationSecretPatchCodec = defineRuntimeCodec<ImageGenerationSecretPatch>((value) => {
  const record = objectRecord(value, 'Image generation secret patch must be an object.');
  if (record.apiKey !== undefined && typeof record.apiKey !== 'string') {
    throw new Error('Image generation apiKey must be a string.');
  }
  if (record.clearApiKey !== undefined && typeof record.clearApiKey !== 'boolean') {
    throw new Error('Image generation clearApiKey must be a boolean.');
  }
  return Object.freeze({
    ...(typeof record.apiKey === 'string' ? { apiKey: record.apiKey.trim() } : {}),
    ...(typeof record.clearApiKey === 'boolean' ? { clearApiKey: record.clearApiKey } : {}),
  });
});

const connectionDocument = defineFeatureSettingsDocument<
  ImageGenerationConnection,
  ImageGenerationPublicConnection,
  ImageGenerationConnectionPatch,
  ImageGenerationSecretPatch
>({
  currentVersion: 1,
  schema: imageGenerationConnectionCodec,
  defaults: () => Object.freeze({ baseUrl: '', model: '' }),
  migrations: Object.freeze({}),
  publicProjection: (value, secrets) => {
    const apiKey = secrets['api-key'] ?? EMPTY_SECRET_METADATA;
    return Object.freeze({
      ...value,
      apiKeySet: apiKey.set,
      apiKeyPreview: apiKey.preview,
    });
  },
  applyPatch: (value, patch) => imageGenerationConnectionCodec.parse({ ...value, ...patch }),
  secretNames: ['api-key'],
  credentialBackupSecretNames: ['api-key'],
  normalizeSecretPatch: (patch) => Object.freeze({
    ...(patch.clearApiKey === true ? { 'api-key': null } : {}),
    ...(typeof patch.apiKey === 'string' && patch.apiKey.trim()
      ? { 'api-key': patch.apiKey.trim() }
      : {}),
  }),
  syncPolicy: 'portable',
  retentionPolicy: 'retain-until-explicit-delete',
  applyPolicy: 'immediate',
});

export const imageGenerationSettings = defineFeatureSettingsBundle({
  featureId: imageGenerationFeature.id,
  documents: {
    connection: connectionDocument,
  },
});

const EMPTY_SECRET_METADATA: FeatureSecretMetadata = Object.freeze({ set: false, preview: '' });

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
