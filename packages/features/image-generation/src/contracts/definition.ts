import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { FEATURE_PACKAGE_VERSION } from '../generated/package-version.js';

export const imageGenerationFeature = defineFeatureDefinition({
  id: 'image-generation',
  version: FEATURE_PACKAGE_VERSION,
});
