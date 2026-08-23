import { declareCapabilityProvider, requiredCapability, optionalCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  imageGenerationAssetStoreCapability,
  imageGenerationFeature,
  imageGenerationLegacySettingsCapability,
  imageGenerationNetworkCapability,
  imageGenerationReferenceReaderCapability,
  imageGenerationServiceCapability,
  imageGenerationSettings,
  imageGenerationWorkspaceFilesCapability,
  type LegacyImageGenerationSettings,
  readImageGenerationSettings,
  testImageGenerationConnection,
  updateImageGenerationSettings,
} from '../contracts/index.js';
import { RuntimeImageGenerationService } from './image-generation-service.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  settings: requiredCapability(runtimeFeatureSettingsRegistryCapability),
  generatedImages: requiredCapability(imageGenerationAssetStoreCapability),
  references: requiredCapability(imageGenerationReferenceReaderCapability),
  network: requiredCapability(imageGenerationNetworkCapability),
  workspaceFiles: optionalCapability(imageGenerationWorkspaceFilesCapability, () => null),
  legacySettings: requiredCapability(imageGenerationLegacySettingsCapability),
});

export const imageGenerationRuntimeFeature = defineRuntimeFeature({
  definition: imageGenerationFeature,
  provides: [declareCapabilityProvider(imageGenerationServiceCapability)],
  dependencies,
  settings: [imageGenerationSettings],
  async setup(context) {
    const connection = context.dependencies.settings.open(imageGenerationSettings.documents.connection);
    let importedLegacy: LegacyImageGenerationSettings | null = null;
    if (!await connection.exists()) {
      importedLegacy = await context.dependencies.legacySettings.read();
      await connection.initialize({
        value: importedLegacy.connection,
        ...(importedLegacy.apiKey ? { secrets: { 'api-key': importedLegacy.apiKey } } : {}),
      });
    }

    const service = new RuntimeImageGenerationService(
      context.scope,
      connection,
      context.dependencies.generatedImages,
      context.dependencies.references,
      context.dependencies.network,
      context.dependencies.workspaceFiles,
      context.health,
      () => context.dependencies.settings.diagnoseDocument(
        imageGenerationFeature.id,
        imageGenerationSettings.documents.connection.documentId,
      ),
    );
    const settingsApplied = await service.initialize();
    if (shouldRetireLegacyImageGenerationSettings(settingsApplied, importedLegacy)) {
      await context.dependencies.legacySettings.retire();
    }

    context.dependencies.routes.register(
      context.scope,
      readImageGenerationSettings,
      () => service.readSettings(),
    );
    context.dependencies.routes.register(
      context.scope,
      updateImageGenerationSettings,
      (input) => service.updateSettings(input),
    );
    context.dependencies.routes.register(
      context.scope,
      testImageGenerationConnection,
      (input, operation) => service.testGeneration(input, operation.signal),
    );
    context.provide(declareCapabilityProvider(imageGenerationServiceCapability), service);
  },
});

function shouldRetireLegacyImageGenerationSettings(
  settingsApplied: boolean,
  importedLegacy: LegacyImageGenerationSettings | null,
): boolean {
  if (settingsApplied) return true;
  if (!importedLegacy) return false;
  return !importedLegacy.connection.baseUrl.trim()
    && !importedLegacy.connection.model.trim()
    && !importedLegacy.apiKey.trim();
}

export function unavailableImageGenerationService(): never {
  throw new FeatureOperationFailure({
    code: 'FEATURE_UNAVAILABLE',
    message: 'Image generation Feature is unavailable.',
    retryable: true,
  });
}
