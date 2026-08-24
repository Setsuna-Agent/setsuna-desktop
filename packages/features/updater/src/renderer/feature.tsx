import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { lazy } from 'react';
import { updaterFeature } from '../contracts/index.js';
import {
  updaterRendererHostCapability,
  updaterRendererStateCapability,
} from './capabilities.js';
import { updaterMessages } from './messages.js';
import { UpdaterRendererStateService } from './service.js';

const UpdaterSettingsView = lazy(async () => {
  const module = await import('./UpdaterSettingsView.js');
  return { default: module.UpdaterSettingsView };
});

const dependencies = defineRendererDependencies({
  host: requiredCapability(updaterRendererHostCapability),
});

const stateProvider = declareCapabilityProvider(updaterRendererStateCapability);

export const updaterRendererFeature = defineRendererFeature({
  definition: updaterFeature,
  dependencies,
  provides: [stateProvider],
  messages: [updaterMessages],
  setup(context) {
    const { host } = context.dependencies;
    const service = new UpdaterRendererStateService(host.bridge);
    service.start();
    context.scope.add(() => service.dispose());
    context.provide(stateProvider, service);
    return {
      settingsSectionExtensions: [{
        id: 'updater-about',
        targetSectionId: 'about',
        order: 100,
        render: ({ translate, ui }) => (
          <UpdaterSettingsView
            openExternal={host.openExternal}
            platform={host.platform}
            service={service}
            translate={translate}
            ui={ui}
          />
        ),
      }],
    };
  },
});
