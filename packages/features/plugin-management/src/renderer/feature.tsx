import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { capabilitiesRefreshCoordinatorCapability } from '@setsuna-desktop/renderer-contracts/capabilities';
import {
  CAPABILITIES_CATALOG_NAVIGATION_GROUP_ID,
  registerSettingsPage,
} from '@setsuna-desktop/renderer-contracts/settings';
import { lazy } from 'react';
import {
  pluginManagementFeature,
  pluginManagementRendererHostCapability,
  pluginManagementRendererServiceCapability,
} from '../contracts/index.js';
import { createPluginManagementClient } from './client.js';
import { pluginManagementMessages } from './messages.js';
import { RendererPluginManagementService } from './service.js';

const PluginCapabilitiesPage = lazy(async () => {
  const module = await import('./PluginCapabilitiesPage.js');
  return { default: module.PluginCapabilitiesPage };
});

const dependencies = defineRendererDependencies({
  capabilitiesRefresh: requiredCapability(capabilitiesRefreshCoordinatorCapability),
  host: requiredCapability(pluginManagementRendererHostCapability),
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const serviceProvider = declareCapabilityProvider(pluginManagementRendererServiceCapability);

export const pluginManagementRendererFeature = defineRendererFeature({
  definition: pluginManagementFeature,
  dependencies,
  provides: [serviceProvider],
  messages: [pluginManagementMessages],
  setup(context) {
    const service = new RendererPluginManagementService({
      bridge: context.dependencies.host.bridge,
      client: createPluginManagementClient(context.dependencies.transport),
      scope: context.scope,
    });
    context.provide(serviceProvider, service);
    context.scope.add(context.dependencies.capabilitiesRefresh.register(
      'plugin-management',
      async () => {
        await Promise.all([service.refresh(), service.refreshHooks()]);
      },
    ));
    registerSettingsPage(context.ui, {
      entryId: 'plugin-management.capabilities-page',
      location: 'capabilities',
      navigationGroupId: CAPABILITIES_CATALOG_NAVIGATION_GROUP_ID,
      order: 100,
      pageHeading: 'view',
      sectionId: 'plugins',
      titleKey: 'feature.pluginManagement.title',
      render: (props) => (
        <PluginCapabilitiesPage
          {...props}
          capabilitiesRefresh={context.dependencies.capabilitiesRefresh}
          openExternal={context.dependencies.host.openExternal}
          service={service}
        />
      ),
    });
  },
});
