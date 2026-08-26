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
  runtimeActivityFeature,
  runtimeActivityRendererServiceCapability,
} from '../contracts/index.js';
import { createRuntimeActivityClient } from './client.js';
import { runtimeActivityMessages } from './messages.js';
import { RendererRuntimeActivityService } from './service.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const serviceProvider = declareCapabilityProvider(runtimeActivityRendererServiceCapability);

export const runtimeActivityRendererFeature = defineRendererFeature({
  definition: runtimeActivityFeature,
  dependencies,
  messages: [runtimeActivityMessages],
  provides: [serviceProvider],
  setup(context) {
    context.provide(serviceProvider, new RendererRuntimeActivityService({
      client: createRuntimeActivityClient(context.dependencies.transport),
      scope: context.scope,
    }));
    return {};
  },
});
