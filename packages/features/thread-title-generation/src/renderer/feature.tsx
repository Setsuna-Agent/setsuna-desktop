import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { threadTitleGenerationFeature } from '../contracts/index.js';
import { createThreadTitleGenerationClient } from './client.js';
import { threadTitleGenerationMessages } from './messages.js';
import { ThreadTitleGenerationSettingsView } from './ThreadTitleGenerationSettingsView.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

export const threadTitleGenerationRendererFeature = defineRendererFeature({
  definition: threadTitleGenerationFeature,
  dependencies,
  messages: [threadTitleGenerationMessages],
  setup(context) {
    const client = createThreadTitleGenerationClient(context.dependencies.transport);
    return {
      settingsSectionExtensions: [{
        id: 'thread-title-generation-task-model',
        targetSectionId: 'taskModels',
        order: 100,
        render: ({ translate, ui }) => (
          <ThreadTitleGenerationSettingsView
            client={client}
            translate={translate}
            ui={ui}
          />
        ),
      }],
    };
  },
});
