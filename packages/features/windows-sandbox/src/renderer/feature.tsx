import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
} from '@setsuna-desktop/feature-core/renderer';
import { windowsSandboxFeature } from '../contracts/index.js';
import { windowsSandboxRendererHostCapability } from './capabilities.js';
import { windowsSandboxMessages } from './messages.js';
import { WindowsSandboxSettingsView } from './WindowsSandboxSettingsView.js';

const dependencies = defineRendererDependencies({
  host: requiredCapability(windowsSandboxRendererHostCapability),
});

export const windowsSandboxRendererFeature = defineRendererFeature({
  definition: windowsSandboxFeature,
  dependencies,
  messages: [windowsSandboxMessages],
  setup(context) {
    const { host } = context.dependencies;
    if (host.platform !== 'win32') return {};
    return {
      settingsSectionExtensions: [{
        id: 'windows-sandbox',
        targetSectionId: 'runtime',
        order: 100,
        render: ({ translate, ui }) => (
          <WindowsSandboxSettingsView bridge={host.bridge} translate={translate} ui={ui} />
        ),
      }],
    };
  },
});
