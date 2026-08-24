import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineFeatureSettingsBundle,
  defineFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import { visionRecognitionFeature } from './definition.js';

export type VisionRecognitionModelSelection = RuntimeConfiguredModelReference | null;

export const visionRecognitionModelSelectionCodec = defineRuntimeCodec<VisionRecognitionModelSelection>((value) => {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vision recognition model selection must be an object or null.');
  }
  const record = value as Record<string, unknown>;
  const providerId = stableId(record.providerId, 'providerId');
  const modelId = stableId(record.modelId, 'modelId');
  return Object.freeze({ providerId, modelId });
});

const modelSelectionDocument = defineFeatureSettingsDocument<
  VisionRecognitionModelSelection,
  VisionRecognitionModelSelection,
  VisionRecognitionModelSelection,
  undefined
>({
  currentVersion: 1,
  schema: visionRecognitionModelSelectionCodec,
  defaults: () => null,
  migrations: Object.freeze({}),
  publicProjection: (value) => value,
  applyPatch: (_value, patch) => visionRecognitionModelSelectionCodec.parse(patch),
  secretNames: [],
  normalizeSecretPatch: () => Object.freeze({}),
  syncPolicy: 'portable',
});

export const visionRecognitionSettings = defineFeatureSettingsBundle({
  featureId: visionRecognitionFeature.id,
  documents: {
    'model-selection': modelSelectionDocument,
  },
});

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) {
    throw new Error(`Vision recognition ${label} must be a non-empty string.`);
  }
  return value.trim();
}
