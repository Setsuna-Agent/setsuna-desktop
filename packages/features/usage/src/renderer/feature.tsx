import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { registerSettingsPage } from '@setsuna-desktop/renderer-contracts/settings';
import { ChartNoAxesCombined } from 'lucide-react';
import { lazy } from 'react';
import {
  usageFeature,
  usageRendererStateCapability,
} from '../contracts/index.js';
import { usageRendererHostCapability } from './capabilities.js';
import { createUsageClient } from './client.js';
import { usageMessages } from './messages.js';
import { RendererUsageStateService } from './service.js';

const UsageSettingsView = lazy(async () => {
  const module = await import('./UsageSettingsView.js');
  return { default: module.UsageSettingsView };
});

const dependencies = defineRendererDependencies({
  host: requiredCapability(usageRendererHostCapability),
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const stateProvider = declareCapabilityProvider(usageRendererStateCapability);

export const usageRendererFeature = defineRendererFeature({
  definition: usageFeature,
  dependencies,
  provides: [stateProvider],
  messages: [usageMessages],
  setup(context) {
    const service = new RendererUsageStateService({
      client: createUsageClient(context.dependencies.transport),
      scope: context.scope,
    });
    context.provide(stateProvider, service);
    registerSettingsPage(context.ui, {
        entryId: 'usage.settings-page',
        descriptionKey: 'feature.usage.settings.description',
        icon: ChartNoAxesCombined,
        sectionId: 'usage',
        location: 'settings',
        navigationGroupId: 'models-and-services',
        order: 100,
        pageHeading: 'view',
        titleKey: 'feature.usage.settings.title',
        render: ({ translate, ui }) => (
          <UsageSettingsView
            host={context.dependencies.host}
            service={service}
            translate={translate}
            ui={ui}
          />
        ),
    });
  },
});
