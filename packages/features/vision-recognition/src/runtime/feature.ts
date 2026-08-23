import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  readVisionRecognitionSettings,
  testVisionRecognition,
  updateVisionRecognitionSettings,
  visionRecognitionFeature,
  visionRecognitionRuntimeHostCapability,
  visionRecognitionServiceCapability,
  visionRecognitionSettings,
  type VisionRecognitionModelSelection,
} from '../contracts/index.js';
import { RuntimeVisionRecognitionService } from './vision-recognition-service.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  settings: requiredCapability(runtimeFeatureSettingsRegistryCapability),
  host: requiredCapability(visionRecognitionRuntimeHostCapability),
});

export const visionRecognitionRuntimeFeature = defineRuntimeFeature({
  definition: visionRecognitionFeature,
  provides: [declareCapabilityProvider(visionRecognitionServiceCapability)],
  dependencies,
  settings: [visionRecognitionSettings],
  async setup(context) {
    const selection = context.dependencies.settings.open(
      visionRecognitionSettings.documents['model-selection'],
    );
    let importedLegacy: VisionRecognitionModelSelection | undefined;
    if (!await selection.exists()) {
      importedLegacy = await context.dependencies.host.readLegacySelection();
      await selection.initialize({
        value: importedLegacy,
      });
    }

    const service = new RuntimeVisionRecognitionService(
      context.scope,
      selection,
      context.dependencies.host,
      context.health,
      () => context.dependencies.settings.diagnoseDocument(
        visionRecognitionFeature.id,
        visionRecognitionSettings.documents['model-selection'].documentId,
      ),
    );
    const settingsApplied = await service.initialize();
    if (shouldRetireLegacyVisionSelection(settingsApplied, importedLegacy)) {
      await context.dependencies.host.retireLegacySelection();
    }

    context.dependencies.routes.register(
      context.scope,
      readVisionRecognitionSettings,
      () => service.readSettings(),
    );
    context.dependencies.routes.register(
      context.scope,
      updateVisionRecognitionSettings,
      (input) => service.updateSettings(input),
    );
    context.dependencies.routes.register(
      context.scope,
      testVisionRecognition,
      (input, operation) => service.testRecognition(input, operation.signal),
    );
    context.provide(declareCapabilityProvider(visionRecognitionServiceCapability), service);
  },
});

function shouldRetireLegacyVisionSelection(
  settingsApplied: boolean,
  importedLegacy: VisionRecognitionModelSelection | undefined,
): boolean {
  return settingsApplied || importedLegacy === null;
}
