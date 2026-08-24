import {
  completeFeatureHostActivation,
  defineRuntimeFeatureHost,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
  threadEventReaderCapability,
  type RuntimeFeatureComposition,
} from '@setsuna-desktop/feature-core/runtime';
import {
  optionalCapability,
  provideHostCapability,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import { browserRuntimeToolServiceCapability } from '@setsuna-desktop/feature-browser/contracts';
import { browserRuntimeFeature } from '@setsuna-desktop/feature-browser/runtime';
import {
  collaborationControlCapability,
  collaborationRuntimeHostCapability,
  createNoopCollaborationControl,
} from '@setsuna-desktop/feature-collaboration/contracts';
import { collaborationRuntimeFeature } from '@setsuna-desktop/feature-collaboration/runtime';
import {
  imageGenerationAssetStoreCapability,
  imageGenerationFeature,
  imageGenerationLegacySettingsCapability,
  imageGenerationNetworkCapability,
  imageGenerationReferenceReaderCapability,
  imageGenerationServiceCapability,
  imageGenerationWorkspaceFilesCapability,
} from '@setsuna-desktop/feature-image-generation/contracts';
import { imageGenerationRuntimeFeature } from '@setsuna-desktop/feature-image-generation/runtime';
import {
  createNoopGoalControl,
  goalControlCapability,
  goalRuntimeHostCapability,
} from '@setsuna-desktop/feature-goal/contracts';
import { goalRuntimeFeature } from '@setsuna-desktop/feature-goal/runtime';
import {
  createNoopMemoryControl,
  memoryControlCapability,
  memoryLegacySettingsCapability,
  memoryRuntimeHostCapability,
} from '@setsuna-desktop/feature-memory/contracts';
import { memoryRuntimeFeature } from '@setsuna-desktop/feature-memory/runtime';
import {
  visionRecognitionFeature,
  visionRecognitionRuntimeHostCapability,
  visionRecognitionServiceCapability,
} from '@setsuna-desktop/feature-vision-recognition/contracts';
import { visionRecognitionRuntimeFeature } from '@setsuna-desktop/feature-vision-recognition/runtime';
import {
  workspaceDependenciesControlCapability,
  workspaceDependenciesFeature,
  workspaceDependenciesLegacySettingsCapability,
  workspaceDependenciesRuntimeHostCapability,
} from '@setsuna-desktop/feature-workspace-dependencies/contracts';
import { workspaceDependenciesRuntimeFeature } from '@setsuna-desktop/feature-workspace-dependencies/runtime';
import type { RuntimeContainer } from '../runtime/runtime-factory.js';

const runtimeFeatures = defineRuntimeFeatureHost({
  required: [browserRuntimeFeature],
  optional: [
    collaborationRuntimeFeature,
    imageGenerationRuntimeFeature,
    goalRuntimeFeature,
    memoryRuntimeFeature,
    visionRecognitionRuntimeFeature,
    workspaceDependenciesRuntimeFeature,
  ],
});

export async function activateBuiltinRuntimeFeatures(
  runtime: RuntimeContainer,
): Promise<RuntimeFeatureComposition> {
  const composition = await runtimeFeatures.activate({
    settingsRegistry: runtime.featureSettings,
    hostCapabilities: [
      provideHostCapability(runtimeRouteRegistrarCapability, runtime.featureRoutes),
      provideHostCapability(
        threadEventReaderCapability,
        runtime.threadEventReader,
      ),
      provideHostCapability(
        runtimeFeatureSettingsRegistryCapability,
        runtime.featureSettings,
      ),
      provideHostCapability(
        imageGenerationAssetStoreCapability,
        runtime.generatedImageStore,
      ),
      provideHostCapability(
        imageGenerationReferenceReaderCapability,
        runtime.threadStore,
      ),
      provideHostCapability(
        imageGenerationNetworkCapability,
        Object.freeze({ fetch: runtime.networkProxyFetch.forRoute() }),
      ),
      provideHostCapability(
        imageGenerationWorkspaceFilesCapability,
        runtime.workspaceProjects,
      ),
      provideHostCapability(
        imageGenerationLegacySettingsCapability,
        runtime.configStore.imageGenerationLegacySettingsAdapter(),
      ),
      provideHostCapability(
        collaborationRuntimeHostCapability,
        runtime.agentLoop.collaborationRuntimeHost(),
      ),
      provideHostCapability(
        goalRuntimeHostCapability,
        runtime.agentLoop.goalRuntimeHost(),
      ),
      provideHostCapability(
        memoryRuntimeHostCapability,
        runtime.agentLoop.memoryRuntimeHost(),
      ),
      provideHostCapability(
        memoryLegacySettingsCapability,
        runtime.configStore.memoryLegacySettingsAdapter(),
      ),
      provideHostCapability(
        visionRecognitionRuntimeHostCapability,
        runtime.visionRecognitionHost,
      ),
      provideHostCapability(
        workspaceDependenciesRuntimeHostCapability,
        Object.freeze({
          dataDir: runtime.dataDir,
          fetch: runtime.networkProxyFetch.forRoute(),
          resolveNetworkEnvironment: () => runtime.networkProxyFetch.environmentForRoute(),
          sandboxNetworkAccessEnabled: async () => (
            (await runtime.configStore.getConfig()).sandboxWorkspaceWrite?.networkAccess === true
          ),
        }),
      ),
      provideHostCapability(
        workspaceDependenciesLegacySettingsCapability,
        runtime.configStore.workspaceDependenciesLegacySettingsAdapter(),
      ),
    ],
  });

  return completeFeatureHostActivation(composition, (host) => {
    host.bind({
      tools: requiredCapability(browserRuntimeToolServiceCapability),
    }, ({ tools }) => runtime.browserToolHost.bind(tools));

    host.bind({
      collaboration: optionalCapability(collaborationControlCapability, createNoopCollaborationControl),
    }, ({ collaboration }) => runtime.agentLoop.bindCollaborationControl(collaboration));

    host.bindWhenFeatureAvailable(imageGenerationFeature.id, {
      imageGeneration: requiredCapability(imageGenerationServiceCapability),
    }, ({ imageGeneration }) => runtime.extensionManager.setImageGenerationService(imageGeneration));

    host.bind({
      goal: optionalCapability(goalControlCapability, createNoopGoalControl),
    }, ({ goal }) => runtime.agentLoop.bindGoalControl(goal));

    host.bind(
      { memory: optionalCapability(memoryControlCapability, createNoopMemoryControl) },
      ({ memory }) => runtime.agentLoop.bindMemoryControl(memory),
      ({ memory }) => runtime.memoryToolHost.bind(memory),
    );

    host.bindWhenFeatureAvailable(visionRecognitionFeature.id, {
      visionRecognition: requiredCapability(visionRecognitionServiceCapability),
    }, ({ visionRecognition }) => runtime.extensionManager.setVisionRecognitionService(visionRecognition));

    host.bindWhenFeatureAvailable(workspaceDependenciesFeature.id, {
      workspaceDependencies: requiredCapability(workspaceDependenciesControlCapability),
    }, ({ workspaceDependencies }) => (
      runtime.backgroundShellProcesses.bindWorkspaceDependencies(workspaceDependencies)
    ));

    host.add(runtime.featureManagement.attach(host.composition));
    return host.composition;
  });
}
