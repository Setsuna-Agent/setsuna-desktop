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
  sideConversationFeature,
  sideConversationRendererHostCapability,
  sideConversationRendererServiceCapability,
} from '../contracts/index.js';
import { createSideConversationClient } from './client.js';
import { sideConversationMessages } from './messages.js';
import { RendererSideConversationService } from './service.js';

const dependencies = defineRendererDependencies({
  host: requiredCapability(sideConversationRendererHostCapability),
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const serviceProvider = declareCapabilityProvider(sideConversationRendererServiceCapability);

export const sideConversationRendererFeature = defineRendererFeature({
  definition: sideConversationFeature,
  dependencies,
  messages: [sideConversationMessages],
  provides: [serviceProvider],
  setup(context) {
    const service = new RendererSideConversationService({
      client: createSideConversationClient(context.dependencies.transport),
      host: context.dependencies.host,
      scope: context.scope,
    });
    context.provide(serviceProvider, service);
  },
});
