import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRendererDependencies, defineRendererFeature, rendererFeatureOperationTransportCapability } from '@setsuna-desktop/feature-core/renderer';
import { assistantsFeature } from '../contracts/index.js';
import { assistantsRendererServiceCapability, createAssistantsRendererService } from './client.js';
import { assistantsMessages } from './messages.js';
import './assistants.css';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

export const assistantsRendererFeature = defineRendererFeature({
  definition: assistantsFeature, dependencies, messages: [assistantsMessages],
  provides: [declareCapabilityProvider(assistantsRendererServiceCapability)],
  setup(context) {
    context.provide(declareCapabilityProvider(assistantsRendererServiceCapability), createAssistantsRendererService(context.dependencies.transport));
  },
});
