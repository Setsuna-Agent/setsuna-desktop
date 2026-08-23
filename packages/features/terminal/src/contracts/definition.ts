import { defineFeatureDefinition } from '@setsuna-desktop/feature-core/definition';
import { FEATURE_PACKAGE_VERSION } from '../generated/package-version.js';

export const terminalFeature = defineFeatureDefinition({
  id: 'terminal',
  version: FEATURE_PACKAGE_VERSION,
});
