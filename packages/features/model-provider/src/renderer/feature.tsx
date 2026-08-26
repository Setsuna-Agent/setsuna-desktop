import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { HardDrive } from 'lucide-react';
import { modelProviderFeature } from '../contracts/index.js';
import { modelProviderRendererHostCapability, modelProviderRendererStateCapability } from './capabilities.js';
import { createModelProviderClient } from './client.js';
import { ModelProviderSettingsView } from './ModelProviderSettingsView.js';
import { modelProviderMessages } from './messages.js';
import { ModelProviderRendererStateService } from './service.js';
import './model-provider.css';

const dependencies = defineRendererDependencies({
  host: requiredCapability(modelProviderRendererHostCapability),
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});
const stateProvider = declareCapabilityProvider(modelProviderRendererStateCapability);

export const modelProviderRendererFeature = defineRendererFeature({
  definition: modelProviderFeature,
  dependencies,
  provides: [stateProvider],
  messages: [modelProviderMessages],
  setup(context) {
    const service = new ModelProviderRendererStateService(
      createModelProviderClient(context.dependencies.transport),
      context.dependencies.host.networkProxyBridge,
    );
    service.start();
    context.scope.add(() => service.dispose());
    context.provide(stateProvider, service);
    return {
      settingsViews: [{
        sectionId: 'model-provider',
        location: 'settings',
        navigationGroupId: 'models-and-services',
        order: 200,
        layout: 'wide',
        pageHeading: 'view',
        titleKey: 'feature.modelProvider.title',
        descriptionKey: 'feature.modelProvider.description',
        icon: HardDrive,
        render: ({ translate, ui }) => (
          <ModelProviderSettingsView
            host={context.dependencies.host}
            service={service}
            translate={translate}
            ui={ui}
          />
        ),
      }],
    };
  },
});
