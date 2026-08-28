import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineFeatureSettingsBundle,
  defineFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import { threadTitleGenerationFeature } from './definition.js';

export type ThreadTitleGenerationModelSelection = RuntimeConfiguredModelReference | null;

export const threadTitleGenerationModelSelectionCodec = defineRuntimeCodec<ThreadTitleGenerationModelSelection>((value) => {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Thread title generation model selection must be an object or null.');
  }
  const record = value as Record<string, unknown>;
  return Object.freeze({
    providerId: stableId(record.providerId, 'providerId'),
    modelId: stableId(record.modelId, 'modelId'),
  });
});

const modelSelectionDocument = defineFeatureSettingsDocument<
  ThreadTitleGenerationModelSelection,
  ThreadTitleGenerationModelSelection,
  ThreadTitleGenerationModelSelection,
  undefined
>({
  currentVersion: 1,
  schema: threadTitleGenerationModelSelectionCodec,
  defaults: () => null,
  migrations: Object.freeze({}),
  publicProjection: (value) => value,
  applyPatch: (_value, patch) => threadTitleGenerationModelSelectionCodec.parse(patch),
  secretNames: [],
  normalizeSecretPatch: () => Object.freeze({}),
  syncPolicy: 'portable',
});

export const threadTitleGenerationSettings = defineFeatureSettingsBundle({
  featureId: threadTitleGenerationFeature.id,
  documents: {
    'model-selection': modelSelectionDocument,
  },
});

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) {
    throw new Error(`Thread title generation ${label} must be a non-empty string.`);
  }
  return value.trim();
}
