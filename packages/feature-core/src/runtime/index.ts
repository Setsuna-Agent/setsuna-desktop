import type { HostCapabilityProvider } from '../capability.js';
import {
  composeFeatureModules,
  createFeatureMounts,
  type FeatureComposition,
  type FeatureHostDefinition,
} from '../internal/composition.js';
import {
  defineDependencies,
  defineProcessFeature,
  type DefineProcessFeatureInput,
  type ProcessFeatureModule,
} from '../internal/module.js';
import type { DependencySpec } from '../capability.js';
import type {
  ErasedFeatureSettingsBundle,
  RuntimeFeatureSettingsRegistry,
} from '../settings.js';

export { completeFeatureHostActivation } from '../internal/host-bindings.js';
export type { FeatureHostBindingContext } from '../internal/host-bindings.js';

export type RuntimeFeatureModule = ProcessFeatureModule<'runtime'> & Readonly<{
  settings: readonly ErasedFeatureSettingsBundle[];
}>;
export type RuntimeFeatureComposition = FeatureComposition;
export type RuntimeFeatureHostDefinition = FeatureHostDefinition<RuntimeFeatureModule>;
export type RuntimeFeatureHostActivationInput = Readonly<{
  hostCapabilities?: readonly HostCapabilityProvider[];
  settingsRegistry?: RuntimeFeatureSettingsRegistry;
}>;

export interface RuntimeFeatureHost {
  activate(input?: RuntimeFeatureHostActivationInput): Promise<RuntimeFeatureComposition>;
}

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

export function defineRuntimeFeatureHost(
  definition: RuntimeFeatureHostDefinition,
): RuntimeFeatureHost {
  const mounts = createFeatureMounts(definition);
  return Object.freeze({
    activate(input: RuntimeFeatureHostActivationInput = {}) {
      const settingsRegistry = input.settingsRegistry;
      return composeFeatureModules<'runtime', void, RuntimeFeatureModule>({
        process: 'runtime',
        mounts,
        hostCapabilities: input.hostCapabilities,
        // Recovery metadata remains available after setup failures, but an
        // invalid graph must not publish any part of the settings catalog.
        beforeActivation: settingsRegistry
          ? () => settingsRegistry.registerBundles(mounts.flatMap(({ module }) => module.settings))
          : undefined,
      });
    },
  });
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
  threadEventReaderCapability,
} from './events.js';
export type {
  FeatureProjectionStore,
  ThreadEventReader,
  ThreadEventReadPage,
} from './events.js';
export type {
  FeatureActivationStatus,
  FeatureCriticality,
  FeatureDiagnostic,
  FeatureStatusSnapshot,
} from '../status.js';
