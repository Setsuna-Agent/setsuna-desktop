import type { DependencySpec, HostCapabilityProvider } from '../capability.js';
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
import {
  composeRendererMessages,
  type ComposedRendererMessages,
  type RendererMessageBundle,
} from './messages.js';
import type {
  RendererFeatureContributionInput,
  RendererFeatureContributions,
} from './views.js';

export { completeFeatureHostActivation } from '../internal/host-bindings.js';
export type { FeatureHostBindingContext } from '../internal/host-bindings.js';

export type RendererFeatureModule = ProcessFeatureModule<'renderer', RendererFeatureContributions> & Readonly<{
  messages: readonly RendererMessageBundle[];
}>;
export type RendererFeatureActivation = FeatureActivation<RendererFeatureContributions>;
export type RendererFeatureComposition = FeatureComposition<RendererFeatureContributions>;
export type RendererFeatureHostDefinition = FeatureHostDefinition<RendererFeatureModule>;

export type ActivatedRendererFeatureHost<TLocale extends string> = Readonly<{
  composition: RendererFeatureComposition;
  messages: ComposedRendererMessages<TLocale>;
}>;

export interface RendererFeatureHost {
  activate<const TLocale extends string>(input: Readonly<{
    hostCapabilities?: readonly HostCapabilityProvider[];
    hostMessages: Readonly<Record<TLocale, Readonly<Record<string, string>>>>;
  }>): Promise<ActivatedRendererFeatureHost<TLocale>>;
}

export type DefineRendererFeatureInput<TSpec extends DependencySpec> = DefineProcessFeatureInput<
  TSpec,
  RendererFeatureContributionInput | void
> & Readonly<{
  messages?: readonly RendererMessageBundle[];
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
      setup: async (context) => normalizeRendererFeatureContributions(await input.setup(context)),
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
      hostCapabilities?: readonly HostCapabilityProvider[];
      hostMessages: Readonly<Record<TLocale, Readonly<Record<string, string>>>>;
    }>): Promise<ActivatedRendererFeatureHost<TLocale>> {
      const messages = composeRendererMessages(input.hostMessages, mounts);
      const composition = await composeFeatureModules<
        'renderer',
        RendererFeatureContributions,
        RendererFeatureModule
      >({
        process: 'renderer',
        mounts,
        hostCapabilities: input.hostCapabilities,
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
export type {
  ComposerActiveTurn,
  ComposerStatusViewContribution,
  ComposerStatusViewHostProps,
  ComposerStatusViewCatalog,
  CheckboxProps,
  ErasedToolResultViewContribution,
  RendererFeatureContributionInput,
  RendererFeatureContributions,
  RegisteredComposerStatusView,
  RegisteredSettingsSectionExtension,
  RegisteredSettingsView,
  ResolvedToolResultView,
  SettingsButtonProps,
  SettingsDialogProps,
  SettingsGroupProps,
  SettingsIconButtonProps,
  SettingsNavigationRowProps,
  SettingsPageHeadingProps,
  SettingsRowProps,
  SettingsSectionProps,
  SettingsSectionExtensionContribution,
  SettingsSectionExtensionHostProps,
  SettingsSectionSubpageContribution,
  SettingsSectionSubpageHostProps,
  SettingsSelectFieldProps,
  SettingsTooltipProps,
  SettingsToggleProps,
  SettingsViewContribution,
  SettingsViewHostProps,
  SettingsViewIconProps,
  SettingsViewLocation,
  SettingsViewCatalog,
  SettingsViewUi,
  ToolResultViewContribution,
  ToolResultViewProps,
  ToolResultViewCatalog,
} from './views.js';

function normalizeRendererFeatureContributions(
  input: RendererFeatureContributionInput | void,
): RendererFeatureContributions {
  return Object.freeze({
    composerStatusViews: Object.freeze([...(input?.composerStatusViews ?? [])]),
    settingsViews: Object.freeze([...(input?.settingsViews ?? [])]),
    settingsSectionExtensions: Object.freeze([...(input?.settingsSectionExtensions ?? [])]),
    toolResultViews: Object.freeze([...(input?.toolResultViews ?? [])]),
  });
}
