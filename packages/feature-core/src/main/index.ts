import type { DependencySpec, HostCapabilityProvider } from '../capability.js';
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

export { completeFeatureHostActivation } from '../internal/host-bindings.js';
export type { FeatureHostBindingContext } from '../internal/host-bindings.js';

export type MainFeatureModule = ProcessFeatureModule<'main'>;
export type MainFeatureComposition = FeatureComposition;
export type MainFeatureHostDefinition = FeatureHostDefinition<MainFeatureModule>;
export type MainFeatureHostActivationInput = Readonly<{
  hostCapabilities?: readonly HostCapabilityProvider[];
}>;

export interface MainFeatureHost {
  activate(input?: MainFeatureHostActivationInput): Promise<MainFeatureComposition>;
}

export function defineMainDependencies<const TSpec extends DependencySpec>(spec: TSpec): TSpec {
  return defineDependencies(spec);
}

export function defineMainFeature<const TSpec extends DependencySpec>(
  input: DefineProcessFeatureInput<TSpec>,
): MainFeatureModule {
  return defineProcessFeature('main', input);
}

export function defineMainFeatureHost(
  definition: MainFeatureHostDefinition,
): MainFeatureHost {
  const mounts = createFeatureMounts(definition);
  return Object.freeze({
    activate: (input: MainFeatureHostActivationInput = {}) => composeFeatureModules<
      'main',
      void,
      MainFeatureModule
    >({
      process: 'main',
      mounts,
      hostCapabilities: input.hostCapabilities,
    }),
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
  FeatureActivationStatus,
  FeatureCriticality,
  FeatureDiagnostic,
  FeatureStatusSnapshot,
} from '../status.js';
