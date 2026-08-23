import {
  eraseDependencySpec,
  type CapabilityDeclaration,
  type CapabilityRequirementDeclaration,
  type DependencySpec,
  type ResolveDependencies,
} from '../capability.js';
import type { FeatureDefinition } from '../definition.js';
import type { Awaitable, FeatureScope } from '../scope.js';
import type { FeatureHealthReporter } from '../status.js';

export type FeatureProcess = 'runtime' | 'renderer' | 'main';

export type ErasedFeatureSetupContext = Readonly<{
  scope: FeatureScope;
  dependencies: Readonly<Record<string, unknown>>;
  health: FeatureHealthReporter;
  provide<TValue>(declaration: CapabilityDeclaration<TValue>, value: TValue): void;
}>;

export type FeatureSetupContext<TDependencies> = Readonly<{
  scope: FeatureScope;
  dependencies: TDependencies;
  health: FeatureHealthReporter;
  provide<TValue>(declaration: CapabilityDeclaration<TValue>, value: TValue): void;
}>;

export type ProcessFeatureModule<TProcess extends FeatureProcess> = Readonly<{
  process: TProcess;
  definition: FeatureDefinition;
  provides: readonly CapabilityDeclaration[];
  dependencies: readonly CapabilityRequirementDeclaration[];
  setup(context: ErasedFeatureSetupContext): Awaitable<void>;
}>;

export type DefineProcessFeatureInput<TSpec extends DependencySpec> = Readonly<{
  definition: FeatureDefinition;
  provides?: readonly CapabilityDeclaration[];
  dependencies: TSpec;
  setup(context: FeatureSetupContext<ResolveDependencies<TSpec>>): Awaitable<void>;
}>;

export function defineProcessFeature<
  TProcess extends FeatureProcess,
  const TSpec extends DependencySpec,
>(
  process: TProcess,
  input: DefineProcessFeatureInput<TSpec>,
): ProcessFeatureModule<TProcess> {
  const provides = Object.freeze([...(input.provides ?? [])]);
  const dependencies = eraseDependencySpec(input.dependencies);

  return Object.freeze({
    process,
    definition: input.definition,
    provides,
    dependencies,
    setup: (context: ErasedFeatureSetupContext) => {
      const resolved = Object.fromEntries(
        dependencies.map(({ slot }) => [slot, context.dependencies[slot]]),
      ) as ResolveDependencies<TSpec>;
      return input.setup(Object.freeze({
        scope: context.scope,
        dependencies: Object.freeze(resolved),
        health: context.health,
        provide: context.provide,
      }));
    },
  });
}

export function defineDependencies<const TSpec extends DependencySpec>(spec: TSpec): TSpec {
  return Object.freeze({ ...spec });
}
