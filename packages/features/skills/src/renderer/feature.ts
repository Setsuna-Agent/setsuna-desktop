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
  skillsFeature,
  skillsRendererServiceCapability,
} from '../contracts/index.js';
import { createSkillsRendererClient } from './client.js';
import { RendererSkillsService } from './service.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const serviceProvider = declareCapabilityProvider(skillsRendererServiceCapability);

export const skillsRendererFeature = defineRendererFeature({
  definition: skillsFeature,
  dependencies,
  provides: [serviceProvider],
  setup(context) {
    context.provide(serviceProvider, new RendererSkillsService({
      client: createSkillsRendererClient(context.dependencies.transport),
      scope: context.scope,
    }));
    return {};
  },
});
