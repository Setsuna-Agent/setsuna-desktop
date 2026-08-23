import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { FEATURE_PACKAGE_VERSION } from '../generated/package-version.js';

export const memoryFeature = defineFeatureDefinition({
  id: 'memory',
  version: FEATURE_PACKAGE_VERSION,
});
