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
  readThreadTitleGenerationSettings,
  threadTitleGenerationControlCapability,
  threadTitleGenerationFeature,
  threadTitleGenerationLegacySettingsCapability,
  threadTitleGenerationRuntimeHostCapability,
  threadTitleGenerationSettings,
  updateThreadTitleGenerationSettings,
} from '../contracts/index.js';
import { RuntimeThreadTitleGenerationControl } from './runtime-thread-title-generation-control.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  settings: requiredCapability(runtimeFeatureSettingsRegistryCapability),
  host: requiredCapability(threadTitleGenerationRuntimeHostCapability),
  legacySettings: requiredCapability(threadTitleGenerationLegacySettingsCapability),
});

export const threadTitleGenerationRuntimeFeature = defineRuntimeFeature({
  definition: threadTitleGenerationFeature,
  provides: [declareCapabilityProvider(threadTitleGenerationControlCapability)],
  dependencies,
  settings: [threadTitleGenerationSettings],
  async setup(context) {
    const selection = context.dependencies.settings.open(
      threadTitleGenerationSettings.documents['model-selection'],
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
        code: 'THREAD_TITLE_GENERATION_SETTINGS_INVALID',
        message: 'Thread title generation settings could not be applied.',
      });
    }

    const control = new RuntimeThreadTitleGenerationControl(
      context.scope,
      selection,
      context.dependencies.host,
    );
    context.dependencies.routes.register(
      context.scope,
      readThreadTitleGenerationSettings,
      () => control.readSettings(),
    );
    context.dependencies.routes.register(
      context.scope,
      updateThreadTitleGenerationSettings,
      (input) => control.updateSettings(input),
    );
    context.provide(declareCapabilityProvider(threadTitleGenerationControlCapability), control);

    if (settingsReady) {
      await context.dependencies.legacySettings.retire();
      context.health.setCondition('settings', null);
    }
  },
});
