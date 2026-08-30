import type {
  CapabilityDeclaration,
  DependencySpec,
  HostCapabilityProvider,
  ResolveDependencies,
} from '../capability.js';
import {
  composeFeatureModules,
  createFeatureMounts,
  type FeatureActivation,
  type FeatureComposition,
  type FeatureHostDefinition,
} from '../internal/composition.js';
import {
  defineDependencies,
  defineProcessFeature,
  type DefineProcessFeatureInput,
  type ProcessFeatureModule,
} from '../internal/module.js';
import type { Awaitable, Disposer, FeatureScope } from '../scope.js';
import type { FeatureHealthReporter } from '../status.js';
import {
  composeRendererMessages,
  type ComposedRendererMessages,
  type RendererMessageBundle,
} from './messages.js';
import type { RendererPluginOwner, RendererUiRegistrar } from './slots.js';

export { completeFeatureHostActivation } from '../internal/host-bindings.js';
export type { FeatureHostBindingContext } from '../internal/host-bindings.js';

export type RendererFeatureModule = ProcessFeatureModule<'renderer', void> & Readonly<{
  messages: readonly RendererMessageBundle[];
}>;
export type RendererFeatureActivation = FeatureActivation<void>;
export type RendererFeatureComposition = FeatureComposition<void>;
export type RendererFeatureHostDefinition = FeatureHostDefinition<RendererFeatureModule>;

export type ActivatedRendererFeatureHost<TLocale extends string> = Readonly<{
  composition: RendererFeatureComposition;
  messages: ComposedRendererMessages<TLocale>;
}>;

export interface RendererFeatureHost {
  activate<const TLocale extends string>(input: Readonly<{
    createUiRegistrar: RendererUiRegistrarFactory;
    hostCapabilities?: readonly HostCapabilityProvider[];
    hostMessages: Readonly<Record<TLocale, Readonly<Record<string, string>>>>;
  }>): Promise<ActivatedRendererFeatureHost<TLocale>>;
}

export type RendererFeatureSetupContext<TDependencies> = Readonly<{
  dependencies: TDependencies;
  health: FeatureHealthReporter;
  provide<TValue>(declaration: CapabilityDeclaration<TValue>, value: TValue): void;
  scope: FeatureScope;
  ui: RendererUiRegistrar;
}>;

export type RendererUiRegistrarFactory = (
  owner: RendererPluginOwner,
  track: (disposer: Disposer) => void,
) => RendererUiRegistrar;

export type DefineRendererFeatureInput<TSpec extends DependencySpec> = Omit<
  DefineProcessFeatureInput<TSpec, void>,
  'setup'
> & Readonly<{
  messages?: readonly RendererMessageBundle[];
  setup(
    context: RendererFeatureSetupContext<ResolveDependencies<TSpec>>,
  ): Awaitable<void>;
}>;

export function defineRendererDependencies<const TSpec extends DependencySpec>(spec: TSpec): TSpec {
  return defineDependencies(spec);
}

export function defineRendererFeature<const TSpec extends DependencySpec>(
  input: DefineRendererFeatureInput<TSpec>,
): RendererFeatureModule {
  return Object.freeze({
    ...defineProcessFeature('renderer', {
      definition: input.definition,
      provides: input.provides,
      dependencies: input.dependencies,
      setup: async (context) => {
        const rendererContext = context as typeof context & Readonly<{ ui?: RendererUiRegistrar }>;
        if (!rendererContext.ui) {
          throw new Error(`Renderer UI registrar is unavailable for Feature "${input.definition.id}".`);
        }
        await input.setup(Object.freeze({
          ...context,
          ui: rendererContext.ui,
        }));
      },
    }),
    messages: Object.freeze([...(input.messages ?? [])]),
  });
}

export function defineRendererFeatureHost(
  definition: RendererFeatureHostDefinition,
): RendererFeatureHost {
  const mounts = createFeatureMounts(definition);
  return Object.freeze({
    async activate<const TLocale extends string>(input: Readonly<{
      createUiRegistrar: RendererUiRegistrarFactory;
      hostCapabilities?: readonly HostCapabilityProvider[];
      hostMessages: Readonly<Record<TLocale, Readonly<Record<string, string>>>>;
    }>): Promise<ActivatedRendererFeatureHost<TLocale>> {
      const messages = composeRendererMessages(input.hostMessages, mounts);
      const composition = await composeFeatureModules<
        'renderer',
        void,
        RendererFeatureModule
      >({
        process: 'renderer',
        mounts,
        hostCapabilities: input.hostCapabilities,
        setupContextExtension: ({ module, scope }) => ({
          ui: input.createUiRegistrar(
            Object.freeze({
              featureId: module.definition.id,
              pluginId: `feature.${module.definition.id}`,
              scopeId: scope.owner.scopeId,
            }),
            (disposer) => scope.add(disposer),
          ),
        }),
      });
      return Object.freeze({ composition, messages });
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
  FeatureActivationStatus,
  FeatureCriticality,
  FeatureDiagnostic,
  FeatureStatusSnapshot,
} from '../status.js';
export { rendererFeatureOperationTransportCapability } from './transport.js';
export { rendererFeatureEventFeedCapability } from './events.js';
export type {
  RendererFeatureEventFeed,
  RendererFeatureEventFeedListener,
} from './events.js';
export {
  composeRendererMessages,
  defineRendererMessageBundle,
  resolveRendererMessage,
} from './messages.js';
export type {
  ComposedRendererMessages,
  RendererMessageBundle,
  RendererFeatureMessageKey,
  RendererMessageNamespace,
  RendererTranslate,
  RendererTranslationParams,
} from './messages.js';
export {
  assertRendererPluginId,
  assertRendererSlotEntryId,
  declareRendererChildSlot,
  defineChainRendererSlot,
  defineKeyedRendererSlot,
  defineListRendererSlot,
  defineRendererPlugin,
  defineSingleRendererSlot,
} from './slots.js';
export type {
  RendererAnySlot,
  RendererChainInput,
  RendererChainOutput,
  RendererChainSlot,
  RendererChainSlotEntry,
  RendererKeyedSlot,
  RendererKeyedEntryDescriptor,
  RendererKeyedSlotEntry,
  RendererListSlot,
  RendererListSlotEntry,
  RendererOwnedSlotRenderer,
  RendererPluginDefinition,
  RendererPluginOwner,
  RendererSingleSlot,
  RendererSingleSlotEntry,
  RendererSlotDeclaration,
  RendererSlotErrorRender,
  RendererSlotKey,
  RendererSlotKind,
  RendererSlotMetadata,
  RendererSlotProps,
  RendererSlotRender,
  RendererSlotScope,
  RendererUiRegistrar,
  RendererVisualSlot,
} from './slots.js';
