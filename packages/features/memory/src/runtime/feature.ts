import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  clearMemory,
  deleteMemory,
  memoryControlCapability,
  memoryFeature,
  memoryLegacySettingsCapability,
  memoryRuntimeHostCapability,
  memorySettings,
  previewMemory,
  readMemorySettings,
  updateMemorySettings,
} from '../contracts/index.js';
import { RuntimeMemoryCoordinator } from './runtime-memory-coordinator.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  settings: requiredCapability(runtimeFeatureSettingsRegistryCapability),
  host: requiredCapability(memoryRuntimeHostCapability),
  legacySettings: requiredCapability(memoryLegacySettingsCapability),
});

export const memoryRuntimeFeature = defineRuntimeFeature({
  definition: memoryFeature,
  provides: [declareCapabilityProvider(memoryControlCapability)],
  dependencies,
  settings: [memorySettings],
  async setup(context) {
    const preferences = context.dependencies.settings.open(memorySettings.documents.preferences);
    let settingsReady = false;
    try {
      if (!await preferences.exists()) {
        const legacy = await context.dependencies.legacySettings.read();
        await preferences.initialize({ value: legacy.value });
      }
      // exists() is intentionally cheap; read() is the schema/migration gate
      // that must succeed before the only legacy copy can be retired.
      await preferences.read();
      settingsReady = true;
    } catch {
      context.health.setCondition('settings', {
        code: 'MEMORY_SETTINGS_INVALID',
        message: 'Memory settings could not be applied.',
      });
    }

    const control = new RuntimeMemoryCoordinator({
      host: context.dependencies.host,
      settings: preferences,
    });
    context.scope.add(async () => {
      await control.shutdown(5_000);
    });

    context.dependencies.routes.register(context.scope, readMemorySettings, () => control.readSettings());
    context.dependencies.routes.register(context.scope, updateMemorySettings, (input) => control.updateSettings(input));
    context.dependencies.routes.register(context.scope, previewMemory, () => control.preview());
    context.dependencies.routes.register(context.scope, deleteMemory, async ({ memoryId }) => {
      await control.delete(memoryId);
      return { ok: true };
    });
    context.dependencies.routes.register(context.scope, clearMemory, async () => {
      await control.clear();
      return { ok: true };
    });

    context.provide(declareCapabilityProvider(memoryControlCapability), control);
    if (settingsReady) {
      await context.dependencies.legacySettings.retire();
      context.health.setCondition('settings', null);
    }
  },
});
