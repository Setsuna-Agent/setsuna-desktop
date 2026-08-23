import {
  composeRuntimeFeatures,
  runtimeFeatureEventRegistrarCapability,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
  threadEventReaderCapability,
  type RuntimeFeatureComposition,
} from '@setsuna-desktop/feature-core/runtime';
import {
  declareCapabilityProvider,
  optionalCapability,
  provideHostCapability,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { browserRuntimeToolServiceCapability } from '@setsuna-desktop/feature-browser/contracts';
import {
  imageGenerationAssetStoreCapability,
  imageGenerationFeature,
  imageGenerationLegacySettingsCapability,
  imageGenerationNetworkCapability,
  imageGenerationReferenceReaderCapability,
  imageGenerationServiceCapability,
  imageGenerationWorkspaceFilesCapability,
} from '@setsuna-desktop/feature-image-generation/contracts';
import {
  createNoopGoalControl,
  goalControlCapability,
  goalRuntimeHostCapability,
} from '@setsuna-desktop/feature-goal/contracts';
import {
  visionRecognitionFeature,
  visionRecognitionRuntimeHostCapability,
  visionRecognitionServiceCapability,
} from '@setsuna-desktop/feature-vision-recognition/contracts';
import type { RuntimeContainer } from '../runtime/runtime-factory.js';
import { builtinRuntimeFeatures } from './builtin-runtime-features.js';

export async function activateBuiltinRuntimeFeatures(
  runtime: RuntimeContainer,
): Promise<RuntimeFeatureComposition> {
  const composition = await composeRuntimeFeatures({
    mounts: builtinRuntimeFeatures,
    settingsRegistry: runtime.featureSettings,
    hostCapabilities: [
      provideHostCapability(declareCapabilityProvider(runtimeRouteRegistrarCapability), runtime.featureRoutes),
      provideHostCapability(
        declareCapabilityProvider(runtimeFeatureEventRegistrarCapability),
        runtime.featureEvents,
      ),
      provideHostCapability(
        declareCapabilityProvider(threadEventReaderCapability),
        runtime.threadEventReader,
      ),
      provideHostCapability(
        declareCapabilityProvider(runtimeFeatureSettingsRegistryCapability),
        runtime.featureSettings,
      ),
      provideHostCapability(
        declareCapabilityProvider(imageGenerationAssetStoreCapability),
        runtime.generatedImageStore,
      ),
      provideHostCapability(
        declareCapabilityProvider(imageGenerationReferenceReaderCapability),
        runtime.threadStore,
      ),
      provideHostCapability(
        declareCapabilityProvider(imageGenerationNetworkCapability),
        Object.freeze({ fetch: runtime.networkProxyFetch.forRoute() }),
      ),
      provideHostCapability(
        declareCapabilityProvider(imageGenerationWorkspaceFilesCapability),
        runtime.workspaceProjects,
      ),
      provideHostCapability(
        declareCapabilityProvider(imageGenerationLegacySettingsCapability),
        runtime.configStore.imageGenerationLegacySettingsAdapter(),
      ),
      provideHostCapability(
        declareCapabilityProvider(goalRuntimeHostCapability),
        runtime.agentLoop.goalRuntimeHost(),
      ),
      provideHostCapability(
        declareCapabilityProvider(visionRecognitionRuntimeHostCapability),
        runtime.visionRecognitionHost,
      ),
    ],
  });

  const browserDependencies = composition.resolveHostDependencies({
    tools: requiredCapability(browserRuntimeToolServiceCapability),
  });
  runtime.browserToolHost.bind(browserDependencies.tools);

  const status = composition.status(imageGenerationFeature.id)?.status;
  if (status === 'active' || status === 'degraded') {
    const dependencies = composition.resolveHostDependencies({
      imageGeneration: requiredCapability(imageGenerationServiceCapability),
    });
    runtime.extensionManager.setImageGenerationService(dependencies.imageGeneration);
  }
  const goalDependencies = composition.resolveHostDependencies({
    goal: optionalCapability(goalControlCapability, createNoopGoalControl),
  });
  runtime.agentLoop.bindGoalControl(goalDependencies.goal);
  const visionStatus = composition.status(visionRecognitionFeature.id)?.status;
  if (visionStatus === 'active' || visionStatus === 'degraded') {
    const dependencies = composition.resolveHostDependencies({
      visionRecognition: requiredCapability(visionRecognitionServiceCapability),
    });
    runtime.extensionManager.setVisionRecognitionService(dependencies.visionRecognition);
  }
  runtime.featureManagement.attach(composition);
  return composition;
}
