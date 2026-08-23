import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { FEATURE_PACKAGE_VERSION } from '../generated/package-version.js';

export const goalFeature = defineFeatureDefinition({
  id: 'goal',
  version: FEATURE_PACKAGE_VERSION,
});
