import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { FEATURE_PACKAGE_VERSION } from '../generated/package-version.js';

export const visionRecognitionFeature = defineFeatureDefinition({
  id: 'vision-recognition',
  version: FEATURE_PACKAGE_VERSION,
});
