import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { registerSettingsPage } from '@setsuna-desktop/renderer-contracts/settings';
import { visionRecognitionFeature } from '../contracts/index.js';
import { createVisionRecognitionClient } from './client.js';
import { visionRecognitionMessages } from './messages.js';
import { VisionRecognitionSettingsView } from './VisionRecognitionSettingsView.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

export const visionRecognitionRendererFeature = defineRendererFeature({
  definition: visionRecognitionFeature,
  dependencies,
  messages: [visionRecognitionMessages],
  setup(context) {
    const client = createVisionRecognitionClient(context.dependencies.transport);
    registerSettingsPage(context.ui, {
        entryId: 'vision-recognition.capabilities-page',
        sectionId: 'openai-vision-recognition',
        location: 'capabilities',
        order: 110,
        titleKey: 'feature.visionRecognition.settings.title',
        render: ({ translate, ui }) => (
          <VisionRecognitionSettingsView client={client} translate={translate} ui={ui} />
        ),
    });
  },
});
