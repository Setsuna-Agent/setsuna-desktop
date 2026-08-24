import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  diagnoseWorkspaceDependencies,
  readWorkspaceDependencies,
  repairWorkspaceDependencies,
  updateWorkspaceDependencySettings,
  type RuntimeWorkspaceDependenciesStatus,
  type WorkspaceDependenciesSnapshot,
  type WorkspaceDependencySettingsState,
  type WorkspaceDependencySettingsUpdate,
} from '../contracts/index.js';

export type WorkspaceDependenciesClient = Readonly<{
  read(options?: Readonly<{ signal?: AbortSignal }>): Promise<WorkspaceDependenciesSnapshot>;
  updateSettings(
    input: WorkspaceDependencySettingsUpdate,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<WorkspaceDependencySettingsState>;
  diagnose(options?: Readonly<{ signal?: AbortSignal }>): Promise<RuntimeWorkspaceDependenciesStatus>;
  repair(options?: Readonly<{ signal?: AbortSignal }>): Promise<RuntimeWorkspaceDependenciesStatus>;
}>;

export function createWorkspaceDependenciesClient(
  transport: FeatureOperationTransport,
): WorkspaceDependenciesClient {
  return Object.freeze({
    read: (options) => transport.call(readWorkspaceDependencies, undefined, options),
    updateSettings: (input, options) => transport.call(updateWorkspaceDependencySettings, input, options),
    diagnose: (options) => transport.call(diagnoseWorkspaceDependencies, undefined, options),
    repair: (options) => transport.call(repairWorkspaceDependencies, undefined, options),
  });
}
