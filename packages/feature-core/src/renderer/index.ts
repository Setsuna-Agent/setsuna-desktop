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
import type { RendererMessageBundle } from './messages.js';

export type RendererFeatureModule = ProcessFeatureModule<'renderer'> & Readonly<{
  messages: readonly RendererMessageBundle[];
}>;
export type RendererFeatureMount = FeatureMount<RendererFeatureModule>;
export type RendererFeatureComposition = FeatureComposition;

export type DefineRendererFeatureInput<TSpec extends DependencySpec> = DefineProcessFeatureInput<TSpec> & Readonly<{
  messages?: readonly RendererMessageBundle[];
}>;

export function defineRendererDependencies<const TSpec extends DependencySpec>(spec: TSpec): TSpec {
  return defineDependencies(spec);
}

export function defineRendererFeature<const TSpec extends DependencySpec>(
  input: DefineRendererFeatureInput<TSpec>,
): RendererFeatureModule {
  return Object.freeze({
    ...defineProcessFeature('renderer', input),
    messages: Object.freeze([...(input.messages ?? [])]),
  });
}

export function mountRendererFeature(
  module: RendererFeatureModule,
  options: Readonly<{ criticality: FeatureCriticality; enabled?: boolean }>,
): RendererFeatureMount {
  return Object.freeze({
    module,
    criticality: options.criticality,
    enabled: options.enabled ?? true,
  });
}

export function composeRendererFeatures(input: Readonly<{
  mounts: readonly RendererFeatureMount[];
  hostCapabilities?: readonly HostCapabilityProvider[];
}>): Promise<RendererFeatureComposition> {
  return composeFeatureModules({ process: 'renderer', ...input });
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
  rendererComposerStatusViewRegistryCapability,
  rendererSettingsViewRegistryCapability,
  rendererToolResultViewRegistryCapability,
} from './views.js';
export type {
  ComposerActiveTurn,
  ComposerStatusViewContribution,
  ComposerStatusViewHostProps,
  ComposerStatusViewRegistry,
  ErasedToolResultViewContribution,
  RegisteredComposerStatusView,
  RegisteredSettingsSectionExtension,
  RegisteredSettingsView,
  ResolvedToolResultView,
  SettingsButtonProps,
  SettingsGroupProps,
  SettingsIconButtonProps,
  SettingsNavigationRowProps,
  SettingsRowProps,
  SettingsSectionProps,
  SettingsSectionExtensionContribution,
  SettingsSectionExtensionHostProps,
  SettingsSectionSubpageContribution,
  SettingsSectionSubpageHostProps,
  SettingsSelectFieldProps,
  SettingsToggleProps,
  SettingsViewContribution,
  SettingsViewHostProps,
  SettingsViewIconProps,
  SettingsViewLocation,
  SettingsViewRegistry,
  SettingsViewUi,
  ToolResultViewContribution,
  ToolResultViewProps,
  ToolResultViewRegistry,
} from './views.js';
