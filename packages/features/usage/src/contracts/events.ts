import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureEventContract } from '@setsuna-desktop/feature-core/events';
import { usageFeature } from './definition.js';

const usageRecordedCodec = defineRuntimeCodec<Readonly<{ recordId: string }>>((value) => {
  if (!value || typeof value !== 'object' || !('recordId' in value)
    || typeof value.recordId !== 'string' || !value.recordId.trim()) {
    throw new Error('Usage recorded event requires a record ID.');
  }
  return Object.freeze({ recordId: value.recordId });
});

// An invalidation marker only: totals remain in the durable usage store and are
// re-queried, so replay never adds background usage to the conversation turn.
export const usageRecordedEvent = defineFeatureEventContract({
  featureId: usageFeature.id,
  eventType: 'usage.recorded',
  currentVersion: 1,
  codecs: { 1: usageRecordedCodec },
  migrate: (_version, value) => usageRecordedCodec.parse(value),
});
