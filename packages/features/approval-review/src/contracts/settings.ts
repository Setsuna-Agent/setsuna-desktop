import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import {
  defineFeatureSettingsBundle,
  defineFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import { approvalReviewFeature } from './definition.js';

export type ApprovalReviewModelSelection = RuntimeConfiguredModelReference | null;

export const approvalReviewModelSelectionCodec = defineRuntimeCodec<ApprovalReviewModelSelection>((value) => {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Approval review model selection must be an object or null.');
  }
  const record = value as Record<string, unknown>;
  return Object.freeze({
    providerId: stableId(record.providerId, 'providerId'),
    modelId: stableId(record.modelId, 'modelId'),
  });
});

const modelSelectionDocument = defineFeatureSettingsDocument<
  ApprovalReviewModelSelection,
  ApprovalReviewModelSelection,
  ApprovalReviewModelSelection,
  undefined
>({
  currentVersion: 1,
  schema: approvalReviewModelSelectionCodec,
  defaults: () => null,
  migrations: Object.freeze({}),
  publicProjection: (value) => value,
  applyPatch: (_value, patch) => approvalReviewModelSelectionCodec.parse(patch),
  secretNames: [],
  normalizeSecretPatch: () => Object.freeze({}),
  syncPolicy: 'portable',
});

export const approvalReviewSettings = defineFeatureSettingsBundle({
  featureId: approvalReviewFeature.id,
  documents: {
    'model-selection': modelSelectionDocument,
  },
});

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) {
    throw new Error(`Approval review ${label} must be a non-empty string.`);
  }
  return value.trim();
}
