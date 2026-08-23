import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { FEATURE_PACKAGE_VERSION } from '../generated/package-version.js';

export const browserFeature = defineFeatureDefinition({
  id: 'browser',
  version: FEATURE_PACKAGE_VERSION,
});
