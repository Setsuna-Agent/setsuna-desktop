import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import {
  mcpFeature,
  mcpRendererServiceCapability,
} from '../contracts/index.js';
import { createMcpRendererClient } from './client.js';
import { RendererMcpService } from './service.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const serviceProvider = declareCapabilityProvider(mcpRendererServiceCapability);

export const mcpRendererFeature = defineRendererFeature({
  definition: mcpFeature,
  dependencies,
  provides: [serviceProvider],
  setup(context) {
    context.provide(serviceProvider, new RendererMcpService({
      client: createMcpRendererClient(context.dependencies.transport),
      scope: context.scope,
    }));
  },
});
