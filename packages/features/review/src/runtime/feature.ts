import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  generateReviewCommitMessage,
  reviewFeature,
  reviewRuntimeHostCapability,
} from '../contracts/index.js';
import { generateRuntimeReviewCommitMessage } from './commit-message-generation.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(reviewRuntimeHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});

export const reviewRuntimeFeature = defineRuntimeFeature({
  definition: reviewFeature,
  dependencies,
  setup(context) {
    context.dependencies.routes.register(
      context.scope,
      generateReviewCommitMessage,
      async (input, operation) => ({
        message: await generateRuntimeReviewCommitMessage(
          context.dependencies.host,
          input,
          operation.signal,
        ),
      }),
    );
  },
});
