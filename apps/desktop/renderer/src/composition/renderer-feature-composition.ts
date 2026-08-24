import {
  completeFeatureHostActivation,
  defineRendererFeatureHost,
  rendererFeatureEventFeedCapability,
  rendererFeatureOperationTransportCapability,
  type RendererFeatureComposition,
  type ComposedRendererMessages,
} from '@setsuna-desktop/feature-core/renderer';
import {
  optionalCapability,
  provideHostCapability,
} from '@setsuna-desktop/feature-core/capability';
import { browserRendererFeature } from '@setsuna-desktop/feature-browser/renderer';
import {
  collaborationRendererStateCapability,
  createNoopCollaborationRendererStateService,
  type CollaborationRendererStateService,
} from '@setsuna-desktop/feature-collaboration/contracts';
import { collaborationRendererFeature } from '@setsuna-desktop/feature-collaboration/renderer';
import { imageGenerationRendererAssetsCapability } from '@setsuna-desktop/feature-image-generation/contracts';
import { imageGenerationRendererFeature } from '@setsuna-desktop/feature-image-generation/renderer';
import { goalRendererFeature } from '@setsuna-desktop/feature-goal/renderer';
import { memoryRendererFeature } from '@setsuna-desktop/feature-memory/renderer';
import { terminalRendererFeature } from '@setsuna-desktop/feature-terminal/renderer';
import { visionRecognitionRendererFeature } from '@setsuna-desktop/feature-vision-recognition/renderer';
import {
  webDavSyncRendererFeature,
  webDavSyncRendererHostCapability,
} from '@setsuna-desktop/feature-webdav-sync/renderer';
import { createDesktopFeatureOperationTransport } from './desktop-feature-operation-transport.js';
import {
  createRendererFeatureViews,
  type RendererFeatureViews,
} from './feature-view-registries.js';
import { RendererFeatureEventHub } from './renderer-feature-event-hub.js';
import { hostMessages } from '../shared/i18n/messages.js';
import type { AppLocale } from '../shared/i18n/I18nProvider.js';

const rendererFeatures = defineRendererFeatureHost({
  required: [browserRendererFeature, terminalRendererFeature],
  optional: [
    collaborationRendererFeature,
    imageGenerationRendererFeature,
    goalRendererFeature,
    memoryRendererFeature,
    visionRecognitionRendererFeature,
    webDavSyncRendererFeature,
  ],
});

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
  const events = new RendererFeatureEventHub();
  const { composition, messages } = await rendererFeatures.activate({
    hostMessages,
    hostCapabilities: [
      provideHostCapability(
        rendererFeatureOperationTransportCapability,
        createDesktopFeatureOperationTransport(runtime),
      ),
      provideHostCapability(
        rendererFeatureEventFeedCapability,
        events,
      ),
      provideHostCapability(
        imageGenerationRendererAssetsCapability,
        Object.freeze({
          read: (assetId: string) => desktop.readImageAsset(assetId),
          copy: (input: { assetId: string; name: string }) => desktop.copyImageToClipboard(input),
          reveal: (input: { assetId: string; name: string }) => desktop.revealImageInFolder(input),
        }),
      ),
      provideHostCapability(
        webDavSyncRendererHostCapability,
        Object.freeze({ bridge: window.setsunaDesktop?.webdavSync ?? null }),
      ),
    ],
  });
  return completeFeatureHostActivation(composition, (host) => {
    const views: RendererFeatureViews = createRendererFeatureViews(host.composition.activations(), events);
    const dependencies = host.composition.resolveHostDependencies({
      collaboration: optionalCapability(
        collaborationRendererStateCapability,
        createNoopCollaborationRendererStateService,
      ),
    });
    return Object.freeze({
      collaboration: dependencies.collaboration,
      composition: host.composition,
      messages,
      views,
    });
  });
}
