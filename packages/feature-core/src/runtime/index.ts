import type { HostCapabilityProvider } from '../capability.js';
import {
  composeFeatureModules,
  type FeatureComposition,
  type FeatureMount,
} from '../internal/composition.js';
import {
  defineDependencies,
  defineProcessFeature,
  type DefineProcessFeatureInput,
  type ProcessFeatureModule,
} from '../internal/module.js';
import type { DependencySpec } from '../capability.js';
import type { FeatureCriticality } from '../status.js';
import type {
  ErasedFeatureSettingsBundle,
  RuntimeFeatureSettingsRegistry,
} from '../settings.js';

export type RuntimeFeatureModule = ProcessFeatureModule<'runtime'> & Readonly<{
  settings: readonly ErasedFeatureSettingsBundle[];
}>;
export type RuntimeFeatureMount = FeatureMount<RuntimeFeatureModule>;
export type RuntimeFeatureComposition = FeatureComposition;

export function defineRuntimeDependencies<const TSpec extends DependencySpec>(spec: TSpec): TSpec {
  return defineDependencies(spec);
}

export function defineRuntimeFeature<const TSpec extends DependencySpec>(
  input: DefineProcessFeatureInput<TSpec> & Readonly<{
    settings?: readonly ErasedFeatureSettingsBundle[];
  }>,
): RuntimeFeatureModule {
  return Object.freeze({
    ...defineProcessFeature('runtime', input),
    settings: Object.freeze([...(input.settings ?? [])]),
  });
}

export function mountRuntimeFeature(
  module: RuntimeFeatureModule,
  options: Readonly<{ criticality: FeatureCriticality; enabled?: boolean }>,
): RuntimeFeatureMount {
  return Object.freeze({
    module,
    criticality: options.criticality,
    enabled: options.enabled ?? true,
  });
}

export function composeRuntimeFeatures(input: Readonly<{
  mounts: readonly RuntimeFeatureMount[];
  hostCapabilities?: readonly HostCapabilityProvider[];
  settingsRegistry?: RuntimeFeatureSettingsRegistry;
}>): Promise<RuntimeFeatureComposition> {
  if (input.settingsRegistry) {
    // Settings definitions belong to the installed host catalog, not an
    // execution scope. Register every installed module before graph activation
    // so disabled, degraded, or failed Features retain their recovery plane.
    for (const mount of input.mounts) {
      for (const bundle of mount.module.settings) input.settingsRegistry.register(bundle);
    }
  }
  return composeFeatureModules({ process: 'runtime', ...input });
}

export type {
  CapabilityDeclaration,
  CapabilityRequirement,
  CapabilityToken,
  DependencySpec,
  HostCapabilityProvider,
  ResolveDependencies,
} from '../capability.js';
export type { FeatureDefinition, FeatureId } from '../definition.js';
export type { FeatureScope } from '../scope.js';
export type {
  ErasedFeatureSettingsBundle,
  RuntimeFeatureSettingsDocumentHandle,
  RuntimeFeatureSettingsRegistry,
} from '../settings.js';
export {
  runtimeRouteRegistrarCapability,
  type RuntimeFeatureRouteHandlerContext,
  type RuntimeRouteRegistrar,
} from './routes.js';
export { runtimeFeatureSettingsRegistryCapability } from './settings.js';
export {
  createFeatureProjectionStore,
  runtimeFeatureEventRegistrarCapability,
  threadEventReaderCapability,
} from './events.js';
export type {
  FeatureProjectionStore,
  RuntimeFeatureEventRegistrar,
  ThreadEventReader,
  ThreadEventReadPage,
} from './events.js';
export type {
  FeatureActivationStatus,
  FeatureCriticality,
  FeatureDiagnostic,
  FeatureStatusSnapshot,
} from '../status.js';
