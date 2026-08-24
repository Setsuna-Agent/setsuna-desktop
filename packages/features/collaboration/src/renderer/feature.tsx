import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureEventFeedCapability,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import {
  collaborationFeature,
  collaborationLegacySpawnResultCodec,
  collaborationRendererStateCapability,
  collaborationSpawnResultCodec,
  isLegacyCollaborationSpawnResult,
} from '../contracts/index.js';
import { createCollaborationClient } from './client.js';
import { CollaborationSpawnResultView } from './CollaborationSpawnResultView.js';
import { collaborationMessages } from './messages.js';
import { RendererCollaborationStateService } from './service.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
  eventFeed: requiredCapability(rendererFeatureEventFeedCapability),
});

export const collaborationRendererFeature = defineRendererFeature({
  definition: collaborationFeature,
  provides: [declareCapabilityProvider(collaborationRendererStateCapability)],
  dependencies,
  messages: [collaborationMessages],
  setup(context) {
    const service = new RendererCollaborationStateService({
      client: createCollaborationClient(context.dependencies.transport),
      feed: context.dependencies.eventFeed,
      scope: context.scope,
    });
    context.provide(declareCapabilityProvider(collaborationRendererStateCapability), service);
    return {
      toolResultViews: [{
        id: 'collaboration.spawn-result-view',
        resultKind: 'collaboration.spawn-result',
        major: 1,
        payload: collaborationSpawnResultCodec,
        legacy: {
          matches: isLegacyCollaborationSpawnResult,
          payload: collaborationLegacySpawnResultCodec,
        },
        presentation: 'replace',
        workHistoryPresentation: 'persistent',
        render: CollaborationSpawnResultView,
      }],
    };
  },
});
