import {
  composeRendererFeatures,
  composeRendererMessages,
  rendererComposerStatusViewRegistryCapability,
  rendererFeatureEventFeedCapability,
  rendererFeatureOperationTransportCapability,
  rendererSettingsViewRegistryCapability,
  rendererToolResultViewRegistryCapability,
  type RendererFeatureComposition,
  type ComposedRendererMessages,
} from '@setsuna-desktop/feature-core/renderer';
import {
  declareCapabilityProvider,
  optionalCapability,
  provideHostCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  collaborationRendererStateCapability,
  createNoopCollaborationRendererStateService,
  type CollaborationRendererStateService,
} from '@setsuna-desktop/feature-collaboration/contracts';
import { imageGenerationRendererAssetsCapability } from '@setsuna-desktop/feature-image-generation/contracts';
import { builtinRendererFeatures } from './builtin-renderer-features.js';
import { createDesktopFeatureOperationTransport } from './desktop-feature-operation-transport.js';
import {
  RendererComposerStatusViewRegistry,
  RendererSettingsViewRegistry,
  RendererToolResultViewRegistry,
  type RendererFeatureViews,
} from './feature-view-registries.js';
import { RendererFeatureEventHub } from './renderer-feature-event-hub.js';
import { hostMessages } from '../shared/i18n/messages.js';
import type { AppLocale } from '../shared/i18n/I18nProvider.js';

export type ActiveRendererFeatures = Readonly<{
  collaboration: CollaborationRendererStateService;
  composition: RendererFeatureComposition;
  messages: ComposedRendererMessages<AppLocale>;
  views: RendererFeatureViews;
}>;

export async function activateBuiltinRendererFeatures(): Promise<ActiveRendererFeatures> {
  const runtime = window.setsunaDesktop?.runtime;
  const desktop = window.setsunaDesktop?.desktop;
  if (!runtime || !desktop) throw new Error('Desktop Feature bridge is unavailable.');
  const views = Object.freeze({
    composerStatuses: new RendererComposerStatusViewRegistry(),
    events: new RendererFeatureEventHub(),
    settings: new RendererSettingsViewRegistry(),
    toolResults: new RendererToolResultViewRegistry(),
  });
  // Static metadata belongs to installed modules, not activation scopes.
  const messages = composeRendererMessages(hostMessages, builtinRendererFeatures);
  const composition = await composeRendererFeatures({
    mounts: builtinRendererFeatures,
    hostCapabilities: [
      provideHostCapability(
        declareCapabilityProvider(rendererFeatureOperationTransportCapability),
        createDesktopFeatureOperationTransport(runtime),
      ),
      provideHostCapability(
        declareCapabilityProvider(rendererFeatureEventFeedCapability),
        views.events,
      ),
      provideHostCapability(
        declareCapabilityProvider(rendererComposerStatusViewRegistryCapability),
        views.composerStatuses,
      ),
      provideHostCapability(
        declareCapabilityProvider(rendererSettingsViewRegistryCapability),
        views.settings,
      ),
      provideHostCapability(
        declareCapabilityProvider(rendererToolResultViewRegistryCapability),
        views.toolResults,
      ),
      provideHostCapability(
        declareCapabilityProvider(imageGenerationRendererAssetsCapability),
        Object.freeze({
          read: (assetId: string) => desktop.readImageAsset(assetId),
          copy: (input: { assetId: string; name: string }) => desktop.copyImageToClipboard(input),
          reveal: (input: { assetId: string; name: string }) => desktop.revealImageInFolder(input),
        }),
      ),
    ],
  });
  const dependencies = composition.resolveHostDependencies({
    collaboration: optionalCapability(
      collaborationRendererStateCapability,
      createNoopCollaborationRendererStateService,
    ),
  });
  return Object.freeze({
    collaboration: dependencies.collaboration,
    composition,
    messages,
    views,
  });
}
