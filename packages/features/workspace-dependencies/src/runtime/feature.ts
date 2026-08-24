import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { FeatureSettingsRevisionConflictError } from '@setsuna-desktop/feature-core/settings';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
  type RuntimeFeatureSettingsDocumentHandle,
} from '@setsuna-desktop/feature-core/runtime';
import {
  DEFAULT_WORKSPACE_DEPENDENCY_SETTINGS,
  diagnoseWorkspaceDependencies,
  readWorkspaceDependencies,
  repairWorkspaceDependencies,
  updateWorkspaceDependencySettings,
  workspaceDependenciesControlCapability,
  workspaceDependenciesFeature,
  workspaceDependenciesLegacySettingsCapability,
  workspaceDependenciesRuntimeHostCapability,
  workspaceDependencyFeatureSettings,
  type WorkspaceDependencySettings,
  type WorkspaceDependencySettingsPatch,
  type WorkspaceDependencySettingsState,
  type WorkspaceDependencySettingsUpdate,
} from '../contracts/index.js';
import { ManagedWorkspaceDependencyManager } from './managed-workspace-dependency-manager.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  settings: requiredCapability(runtimeFeatureSettingsRegistryCapability),
  host: requiredCapability(workspaceDependenciesRuntimeHostCapability),
  legacySettings: requiredCapability(workspaceDependenciesLegacySettingsCapability),
});

export const workspaceDependenciesRuntimeFeature = defineRuntimeFeature({
  definition: workspaceDependenciesFeature,
  provides: [declareCapabilityProvider(workspaceDependenciesControlCapability)],
  dependencies,
  settings: [workspaceDependencyFeatureSettings],
  async setup(context) {
    const preferences = context.dependencies.settings.open(
      workspaceDependencyFeatureSettings.documents.preferences,
    );
    let settingsReady = false;
    try {
      if (!await preferences.exists()) {
        await preferences.initialize({ value: await context.dependencies.legacySettings.read() });
      }
      await preferences.read();
      settingsReady = true;
    } catch {
      context.health.setCondition('settings', {
        code: 'WORKSPACE_DEPENDENCY_SETTINGS_INVALID',
        message: 'Workspace dependency settings could not be applied.',
      });
    }

    const manager = new ManagedWorkspaceDependencyManager(
      context.dependencies.host.dataDir,
      async () => {
        try {
          return (await preferences.read()).value;
        } catch {
          return DEFAULT_WORKSPACE_DEPENDENCY_SETTINGS;
        }
      },
      () => context.dependencies.host.sandboxNetworkAccessEnabled(),
      {
        fetchImpl: context.dependencies.host.fetch,
        resolveNetworkEnvironment: () => context.dependencies.host.resolveNetworkEnvironment(),
      },
    );

    context.dependencies.routes.register(context.scope, readWorkspaceDependencies, async () => ({
      settings: await readPublicSettings(preferences),
      status: await manager.getStatus(),
    }));
    context.dependencies.routes.register(
      context.scope,
      updateWorkspaceDependencySettings,
      (input) => updatePublicSettings(preferences, input),
    );
    context.dependencies.routes.register(
      context.scope,
      diagnoseWorkspaceDependencies,
      () => runToolchainOperation(() => manager.diagnose()),
    );
    context.dependencies.routes.register(
      context.scope,
      repairWorkspaceDependencies,
      () => runToolchainOperation(() => manager.repair()),
    );
    context.provide(declareCapabilityProvider(workspaceDependenciesControlCapability), manager);

    if (settingsReady) {
      await context.dependencies.legacySettings.retire();
      context.health.setCondition('settings', null);
    }
  },
});

type WorkspaceDependencySettingsHandle = RuntimeFeatureSettingsDocumentHandle<
  WorkspaceDependencySettings,
  WorkspaceDependencySettings,
  WorkspaceDependencySettingsPatch,
  undefined
>;

async function readPublicSettings(
  preferences: WorkspaceDependencySettingsHandle,
): Promise<WorkspaceDependencySettingsState> {
  try {
    return await preferences.readPublic();
  } catch (error) {
    throw settingsUnavailable(error);
  }
}

async function updatePublicSettings(
  preferences: WorkspaceDependencySettingsHandle,
  input: WorkspaceDependencySettingsUpdate,
): Promise<WorkspaceDependencySettingsState> {
  try {
    return await preferences.update(input);
  } catch (error) {
    if (error instanceof FeatureSettingsRevisionConflictError) {
      throw new FeatureOperationFailure({
        code: 'REVISION_CONFLICT',
        message: error.message,
        retryable: true,
      });
    }
    throw settingsUnavailable(error);
  }
}

async function runToolchainOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new FeatureOperationFailure({
      code: 'TOOLCHAIN_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Workspace dependency toolchain is unavailable.',
      retryable: true,
    });
  }
}

function settingsUnavailable(error: unknown): FeatureOperationFailure {
  return new FeatureOperationFailure({
    code: 'SETTINGS_UNAVAILABLE',
    message: error instanceof Error ? error.message : 'Workspace dependency settings are unavailable.',
    retryable: true,
  });
}
