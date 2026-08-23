import { defineCapability, type CapabilityToken } from '../capability.js';
import type { RuntimeFeatureSettingsRegistry } from '../settings.js';

export const runtimeFeatureSettingsRegistryCapability: CapabilityToken<RuntimeFeatureSettingsRegistry> = defineCapability({
  id: 'runtime.feature-settings',
  major: 1,
  description: 'Access registered typed Feature settings documents and host-owned recovery operations',
});
