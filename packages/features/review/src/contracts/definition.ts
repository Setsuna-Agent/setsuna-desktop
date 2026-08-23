import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { FEATURE_PACKAGE_VERSION } from '../generated/package-version.js';

export const reviewFeature = defineFeatureDefinition({
  id: 'desktop-review',
  version: FEATURE_PACKAGE_VERSION,
});
