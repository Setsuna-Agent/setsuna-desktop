import {
  declareCapabilityProvider,
  requiredCapability,
} from '@setsuna-desktop/feature-core/capability';
import {
  defineRendererDependencies,
  defineRendererFeature,
  rendererFeatureOperationTransportCapability,
} from '@setsuna-desktop/feature-core/renderer';
import { conversationDebugFeature } from '../contracts/index.js';
import { conversationDebugRendererStateCapability } from './capabilities.js';
import { createConversationDebugClient } from './client.js';
import { conversationDebugMessages } from './messages.js';
import { RuntimeConversationDebugRendererService } from './service.js';
import { ConversationDebugSettingsView } from './ConversationDebugSettingsView.js';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
});

const stateProvider = declareCapabilityProvider(conversationDebugRendererStateCapability);

export const conversationDebugRendererFeature = defineRendererFeature({
  definition: conversationDebugFeature,
  dependencies,
  provides: [stateProvider],
  messages: [conversationDebugMessages],
  setup(context) {
    const service = new RuntimeConversationDebugRendererService(
      createConversationDebugClient(context.dependencies.transport),
    );
    service.start();
    context.scope.add(() => service.dispose());
    context.provide(stateProvider, service);
    return {
      settingsSectionExtensions: [{
        id: 'conversation-debug',
        targetSectionId: 'runtime',
        order: 210,
        render: ({ translate, ui }) => (
          <ConversationDebugSettingsView
            service={service}
            translate={translate}
            ui={ui}
          />
        ),
      }],
    };
  },
});
