import type {
  RuntimeAvailableModel,
  RuntimeAvailableModelsResponse,
  RuntimeFetchModelsInput,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  ModelProviderCatalog,
  ModelProviderSettingsInput,
  ModelProviderSettingsState,
} from './capabilities.js';

const providerStateCodec = defineRuntimeCodec<ModelProviderSettingsState>((value) => {
  const record = objectRecord(value, 'Model provider state must be an object.');
  if (!Array.isArray(record.providers)) throw new Error('Model provider state must include providers.');
  return structuredClone(record) as ModelProviderSettingsState;
});

const providerInputCodec = defineRuntimeCodec<ModelProviderSettingsInput>((value) => {
  const record = objectRecord(value, 'Model provider input must be an object.');
  if (!Array.isArray(record.providers)) throw new Error('Model provider input must include providers.');
  return structuredClone(record) as ModelProviderSettingsInput;
});

const fetchModelsInputCodec = defineRuntimeCodec<RuntimeFetchModelsInput>((value) => {
  const record = objectRecord(value, 'Model discovery input must be an object.');
  return structuredClone(record) as RuntimeFetchModelsInput;
});

const availableModelsCodec = defineRuntimeCodec<RuntimeAvailableModelsResponse>((value) => {
  const record = objectRecord(value, 'Model discovery result must be an object.');
  if (!Array.isArray(record.models)) throw new Error('Model discovery result must include models.');
  return { models: structuredClone(record.models) as RuntimeAvailableModel[] };
});

const providerCatalogCodec = defineRuntimeCodec<ModelProviderCatalog>((value) => {
  const record = objectRecord(value, 'Model provider catalog must be an object.');
  if (!Array.isArray(record.providers)) throw new Error('Model provider catalog must include providers.');
  return structuredClone(record) as ModelProviderCatalog;
});

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value !== undefined && value !== null) throw new Error('Operation does not accept input.');
  return undefined;
});

export const readModelProviderSettings = defineFeatureOperation({
  id: 'model-provider.settings.read',
  method: 'GET',
  path: '/v1/features/model-provider/settings',
  input: emptyInputCodec,
  output: providerStateCodec,
  errors: Object.freeze({}),
  idempotency: 'idempotent',
});

export const readModelProviderCatalog = defineFeatureOperation({
  id: 'model-provider.catalog.read',
  method: 'GET',
  path: '/v1/features/model-provider/catalog',
  input: emptyInputCodec,
  output: providerCatalogCodec,
  errors: Object.freeze({}),
  idempotency: 'idempotent',
});

export const updateModelProviderSettings = defineFeatureOperation({
  id: 'model-provider.settings.update',
  method: 'PUT',
  path: '/v1/features/model-provider/settings',
  input: providerInputCodec,
  output: providerStateCodec,
  errors: Object.freeze({}),
  idempotency: 'idempotent',
});

export const discoverModelProviderModels = defineFeatureOperation({
  id: 'model-provider.models.discover',
  method: 'POST',
  path: '/v1/features/model-provider/models',
  input: fetchModelsInputCodec,
  output: availableModelsCodec,
  errors: Object.freeze({}),
  idempotency: 'idempotent',
});

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
