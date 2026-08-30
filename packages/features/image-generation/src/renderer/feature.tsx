import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { registerSettingsPage } from '@setsuna-desktop/renderer-contracts/settings';
import { registerChatToolResult } from '@setsuna-desktop/renderer-contracts/chat';
import {
  imageGenerationFeature,
  imageGenerationRendererAssetsCapability,
} from '../contracts/index.js';
import { createImageGenerationClient } from './client.js';
import { ImageGenerationSettingsView } from './ImageGenerationSettingsView.js';
import {
  ImageGenerationToolResultView,
  imageGenerationToolResultPayloadCodec,
} from './ImageGenerationToolResultView.js';
import { imageGenerationMessages } from './messages.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
  assets: requiredCapability(imageGenerationRendererAssetsCapability),
});

export const imageGenerationRendererFeature = defineRendererFeature({
  definition: imageGenerationFeature,
  dependencies,
  messages: [imageGenerationMessages],
  setup(context) {
    const client = createImageGenerationClient(context.dependencies.transport);
    const assets = context.dependencies.assets;
    registerSettingsPage(context.ui, {
      entryId: 'image-generation.capabilities-page',
      sectionId: 'openai-image-generation',
      location: 'capabilities',
      order: 100,
      titleKey: 'feature.imageGeneration.settings.title',
      render: ({ translate, ui }) => (
        <ImageGenerationSettingsView assets={assets} client={client} translate={translate} ui={ui} />
      ),
    });
    registerChatToolResult(context.ui, {
        id: 'image-generation.result-view',
        resultKind: 'image-generation.result',
        major: 1,
        payload: imageGenerationToolResultPayloadCodec,
        render: ImageGenerationToolResultView,
    });
  },
});
