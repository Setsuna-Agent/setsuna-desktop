import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import {
  reviewFeature,
  reviewRendererServiceCapability,
} from '../contracts/index.js';
import { createReviewClient } from './client.js';
import { reviewMessages } from './messages.js';
import { ReviewSettingsView } from './ReviewSettingsView.js';
import { RendererReviewService } from './service.js';
import './styles/review.css';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const serviceProvider = declareCapabilityProvider(reviewRendererServiceCapability);

export const reviewRendererFeature = defineRendererFeature({
  definition: reviewFeature,
  dependencies,
  messages: [reviewMessages],
  provides: [serviceProvider],
  setup(context) {
    const client = createReviewClient(context.dependencies.transport);
    context.provide(serviceProvider, new RendererReviewService(client));
    return {
      settingsSectionExtensions: [{
        id: 'desktop-review-task-model',
        targetSectionId: 'taskModels',
        order: 80,
        render: ({ translate, ui }) => (
          <ReviewSettingsView
            client={client}
            translate={translate}
            ui={ui}
          />
        ),
      }],
    };
  },
});
