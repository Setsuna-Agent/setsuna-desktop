import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import { pluginManagementFeature } from '../contracts/index.js';
import { pluginManagementMainHostCapability } from './capabilities.js';
import { registerPluginManagementIpc } from './ipc.js';

const dependencies = defineMainDependencies({
  host: requiredCapability(pluginManagementMainHostCapability),
});

export const pluginManagementMainFeature = defineMainFeature({
  definition: pluginManagementFeature,
  dependencies,
  setup(context) {
    context.scope.add(registerPluginManagementIpc(context.scope, context.dependencies.host));
  },
});
