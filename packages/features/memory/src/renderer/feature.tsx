import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
  rendererSettingsViewRegistryCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { memoryFeature } from '../contracts/index.js';
import { createMemoryClient } from './client.js';
import { memoryMessages } from './messages.js';
import {
  MemoryPreferencesSettingsView,
  MemoryPreviewSettingsView,
  MemoryTaskModelSettingsView,
} from './MemorySettingsView.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
  settingsViews: requiredCapability(rendererSettingsViewRegistryCapability),
});

export const memoryRendererFeature = defineRendererFeature({
  definition: memoryFeature,
  dependencies,
  messages: [memoryMessages],
  setup(context) {
    const client = createMemoryClient(context.dependencies.transport);
    context.dependencies.settingsViews.registerSectionExtension(context.scope, {
      id: 'memory-preferences',
      targetSectionId: 'personalization',
      order: 320,
      render: ({ openSubpage, translate, ui }) => (
        <MemoryPreferencesSettingsView
          client={client}
          translate={translate}
          ui={ui}
          onOpenPreview={() => openSubpage('preview')}
        />
      ),
      subpages: [{
        id: 'preview',
        render: ({ onBack, translate, ui }) => (
          <MemoryPreviewSettingsView
            client={client}
            onBack={onBack}
            translate={translate}
            ui={ui}
          />
        ),
      }],
    });
    context.dependencies.settingsViews.registerSectionExtension(context.scope, {
      id: 'memory-task-models',
      targetSectionId: 'taskModels',
      order: 320,
      render: ({ translate, ui }) => (
        <MemoryTaskModelSettingsView client={client} translate={translate} ui={ui} />
      ),
    });
  },
});
