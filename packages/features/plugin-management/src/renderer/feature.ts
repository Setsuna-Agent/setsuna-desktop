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
  pluginManagementFeature,
  pluginManagementRendererHostCapability,
  pluginManagementRendererServiceCapability,
} from '../contracts/index.js';
import { createPluginManagementClient } from './client.js';
import { RendererPluginManagementService } from './service.js';

const dependencies = defineRendererDependencies({
  host: requiredCapability(pluginManagementRendererHostCapability),
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const serviceProvider = declareCapabilityProvider(pluginManagementRendererServiceCapability);

export const pluginManagementRendererFeature = defineRendererFeature({
  definition: pluginManagementFeature,
  dependencies,
  provides: [serviceProvider],
  setup(context) {
    context.provide(serviceProvider, new RendererPluginManagementService({
      bridge: context.dependencies.host.bridge,
      client: createPluginManagementClient(context.dependencies.transport),
      scope: context.scope,
    }));
  },
});
