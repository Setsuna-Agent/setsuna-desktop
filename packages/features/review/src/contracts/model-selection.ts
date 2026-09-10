import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';

export type ReviewModelSelection = RuntimeConfiguredModelReference | null;

export const reviewModelSelectionCodec = defineRuntimeCodec<ReviewModelSelection>((value) => {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Review model selection must be an object or null.');
  }
  const record = value as Record<string, unknown>;
  return Object.freeze({
    providerId: stableId(record.providerId, 'providerId'),
    modelId: stableId(record.modelId, 'modelId'),
  });
});

function stableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 256) {
    throw new Error(`Review ${label} must be a non-empty string.`);
  }
  return value.trim();
}
