import { defineCapability, type CapabilityToken } from '../capability.js';
import type { FeatureOperationTransport } from '../operation.js';

export const rendererFeatureOperationTransportCapability: CapabilityToken<FeatureOperationTransport> = defineCapability({
  id: 'renderer.feature-operation-transport',
  major: 1,
  description: 'Typed and cancellable renderer transport for Feature operations',
});
