import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import {
  reviewCommitMessageCapability,
  reviewFeature,
  reviewFilePreviewCapability,
  reviewRendererSenderCapability,
} from '../contracts/index.js';
import { registerReviewIpc } from './ipc.js';

const dependencies = defineMainDependencies({
  commitMessages: requiredCapability(reviewCommitMessageCapability),
  previews: requiredCapability(reviewFilePreviewCapability),
  rendererSender: requiredCapability(reviewRendererSenderCapability),
});

export const reviewMainFeature = defineMainFeature({
  definition: reviewFeature,
  dependencies,
  setup(context) {
    context.scope.add(registerReviewIpc(context.scope, context.dependencies));
  },
});
