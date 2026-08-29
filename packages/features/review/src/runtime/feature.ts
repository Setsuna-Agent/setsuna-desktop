import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  generateReviewCommitMessage,
  readReviewSettings,
  reviewControlCapability,
  reviewFeature,
  reviewLegacySettingsCapability,
  reviewRuntimeHostCapability,
  reviewSettings,
  startAgentReview,
  updateReviewSettings,
} from '../contracts/index.js';
import { generateRuntimeReviewCommitMessage } from './commit-message-generation.js';
import { RuntimeReviewControl } from './runtime-review-control.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(reviewRuntimeHostCapability),
  legacySettings: requiredCapability(reviewLegacySettingsCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  settings: requiredCapability(runtimeFeatureSettingsRegistryCapability),
});

const controlProvider = declareCapabilityProvider(reviewControlCapability);

export const reviewRuntimeFeature = defineRuntimeFeature({
  definition: reviewFeature,
  provides: [controlProvider],
  dependencies,
  settings: [reviewSettings],
  async setup(context) {
    const selection = context.dependencies.settings.open(
      reviewSettings.documents['model-selection'],
    );
    let settingsReady = false;
    try {
      if (!await selection.exists()) {
        await selection.initialize({
          value: await context.dependencies.legacySettings.read(),
        });
      }
      await selection.read();
      settingsReady = true;
    } catch {
      context.health.setCondition('settings', {
        code: 'REVIEW_SETTINGS_INVALID',
        message: 'Review settings could not be applied.',
      });
    }

    const control = new RuntimeReviewControl(selection, context.dependencies.host);
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
    context.dependencies.routes.register(
      context.scope,
      startAgentReview,
      async (input) => (await control.start(input)).response,
    );
    context.dependencies.routes.register(
      context.scope,
      readReviewSettings,
      () => control.readSettings(),
    );
    context.dependencies.routes.register(
      context.scope,
      updateReviewSettings,
      (input) => control.updateSettings(input),
    );
    context.provide(controlProvider, control);

    if (settingsReady) {
      await context.dependencies.legacySettings.retire();
      context.health.setCondition('settings', null);
    }
  },
});
