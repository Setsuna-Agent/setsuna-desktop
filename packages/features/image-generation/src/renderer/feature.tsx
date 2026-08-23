import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
  rendererSettingsViewRegistryCapability,
  rendererToolResultViewRegistryCapability,
} from '@setsuna-desktop/feature-core/renderer';
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
  settingsViews: requiredCapability(rendererSettingsViewRegistryCapability),
  toolResultViews: requiredCapability(rendererToolResultViewRegistryCapability),
  assets: requiredCapability(imageGenerationRendererAssetsCapability),
});

export const imageGenerationRendererFeature = defineRendererFeature({
  definition: imageGenerationFeature,
  dependencies,
  messages: [imageGenerationMessages],
  setup(context) {
    const client = createImageGenerationClient(context.dependencies.transport);
    const assets = context.dependencies.assets;
    context.dependencies.settingsViews.register(context.scope, {
      sectionId: 'openai-image-generation',
      location: 'capabilities',
      order: 100,
      titleKey: 'feature.imageGeneration.settings.title',
      render: ({ translate }) => (
        <ImageGenerationSettingsView assets={assets} client={client} translate={translate} />
      ),
    });
    context.dependencies.toolResultViews.register(context.scope, {
      id: 'image-generation.result-view',
      resultKind: 'image-generation.result',
      major: 1,
      payload: imageGenerationToolResultPayloadCodec,
      render: ImageGenerationToolResultView,
    });
  },
});
