import type { DependencySpec, HostCapabilityProvider } from '../capability.js';
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
import type { FeatureCriticality } from '../status.js';

export type MainFeatureModule = ProcessFeatureModule<'main'>;
export type MainFeatureMount = FeatureMount<MainFeatureModule>;
export type MainFeatureComposition = FeatureComposition;

export function defineMainDependencies<const TSpec extends DependencySpec>(spec: TSpec): TSpec {
  return defineDependencies(spec);
}

export function defineMainFeature<const TSpec extends DependencySpec>(
  input: DefineProcessFeatureInput<TSpec>,
): MainFeatureModule {
  return defineProcessFeature('main', input);
}

export function mountMainFeature(
  module: MainFeatureModule,
  options: Readonly<{ criticality: FeatureCriticality; enabled?: boolean }>,
): MainFeatureMount {
  return Object.freeze({
    module,
    criticality: options.criticality,
    enabled: options.enabled ?? true,
  });
}

export function composeMainFeatures(input: Readonly<{
  mounts: readonly MainFeatureMount[];
  hostCapabilities?: readonly HostCapabilityProvider[];
}>): Promise<MainFeatureComposition> {
  return composeFeatureModules({ process: 'main', ...input });
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
  FeatureActivationStatus,
  FeatureCriticality,
  FeatureDiagnostic,
  FeatureStatusSnapshot,
} from '../status.js';
