import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { registerSettingsPageExtension } from '@setsuna-desktop/renderer-contracts/settings';
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
});

export const memoryRendererFeature = defineRendererFeature({
  definition: memoryFeature,
  dependencies,
  messages: [memoryMessages],
  setup(context) {
    const client = createMemoryClient(context.dependencies.transport);
    registerSettingsPageExtension(context.ui, {
        entryId: 'memory.personalization-settings',
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
    registerSettingsPageExtension(context.ui, {
        entryId: 'memory.task-model-settings',
        id: 'memory-task-models',
        targetSectionId: 'taskModels',
        order: 320,
        render: ({ translate, ui }) => (
          <MemoryTaskModelSettingsView client={client} translate={translate} ui={ui} />
        ),
    });
  },
});
