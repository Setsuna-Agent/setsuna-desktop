export { workspaceDependenciesFeature } from './definition.js';
export {
  workspaceDependenciesControlCapability,
  workspaceDependenciesLegacySettingsCapability,
  workspaceDependenciesRuntimeHostCapability,
} from './capabilities.js';
export type {
  WorkspaceDependenciesControl,
  WorkspaceDependenciesFetch,
  WorkspaceDependenciesLegacySettingsAdapter,
  WorkspaceDependenciesRuntimeHost,
} from './capabilities.js';
export {
  DEFAULT_NPM_REGISTRY_URL,
  DEFAULT_PYTHON_PACKAGE_INDEX_URL,
  DEFAULT_WORKSPACE_DEPENDENCY_SETTINGS,
  normalizeNpmRegistryUrl,
  normalizePythonPackageIndexUrl,
  workspaceDependencyFeatureSettings,
  workspaceDependencySettingsCodec,
  workspaceDependencySettingsPatchCodec,
} from './settings.js';
export type {
  WorkspaceDependencySettings,
  WorkspaceDependencySettingsPatch,
  WorkspaceDependencySettingsState,
} from './settings.js';
export {
  diagnoseWorkspaceDependencies,
  readWorkspaceDependencies,
  repairWorkspaceDependencies,
  updateWorkspaceDependencySettings,
} from './operations.js';
export type {
  WorkspaceDependenciesSnapshot,
  WorkspaceDependencySettingsUpdate,
} from './operations.js';
export type {
  PrepareShellToolchainInput,
  RuntimeWorkspaceDependenciesStatus,
  RuntimeWorkspaceDependencyCheck,
  RuntimeWorkspaceDependencySource,
  RuntimeWorkspaceDependencyToolStatus,
  ShellToolchain,
  ShellToolchainCommand,
  WorkspaceDependencyPromptContext,
} from './types.js';
