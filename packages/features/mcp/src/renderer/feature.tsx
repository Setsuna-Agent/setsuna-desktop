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
  CAPABILITIES_CATALOG_NAVIGATION_GROUP_ID,
  registerSettingsPage,
} from '@setsuna-desktop/renderer-contracts/settings';
import { capabilitiesRefreshCoordinatorCapability } from '@setsuna-desktop/renderer-contracts/capabilities';
import { lazy } from 'react';
import {
  mcpFeature,
  mcpRendererServiceCapability,
} from '../contracts/index.js';
import { createMcpRendererClient } from './client.js';
import { mcpMessages } from './messages.js';
import { RendererMcpService } from './service.js';

const McpCapabilitiesPage = lazy(async () => {
  const module = await import('./McpCapabilitiesPage.js');
  return { default: module.McpCapabilitiesPage };
});

const dependencies = defineRendererDependencies({
  capabilitiesRefresh: requiredCapability(capabilitiesRefreshCoordinatorCapability),
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const serviceProvider = declareCapabilityProvider(mcpRendererServiceCapability);

export const mcpRendererFeature = defineRendererFeature({
  definition: mcpFeature,
  dependencies,
  messages: [mcpMessages],
  provides: [serviceProvider],
  setup(context) {
    const service = new RendererMcpService({
      client: createMcpRendererClient(context.dependencies.transport),
      scope: context.scope,
    });
    context.scope.add(context.dependencies.capabilitiesRefresh.register('mcp', () => service.refresh()));
    context.provide(serviceProvider, service);
    registerSettingsPage(context.ui, {
      entryId: 'mcp.capabilities-page',
      location: 'capabilities',
      navigationGroupId: CAPABILITIES_CATALOG_NAVIGATION_GROUP_ID,
      order: 300,
      pageHeading: 'view',
      sectionId: 'mcp',
      titleKey: 'feature.mcp.title',
      render: (props) => <McpCapabilitiesPage {...props} service={service} />,
    });
  },
});
