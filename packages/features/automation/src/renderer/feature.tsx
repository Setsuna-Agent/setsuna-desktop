import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRendererDependencies, defineRendererFeature, rendererFeatureOperationTransportCapability } from '@setsuna-desktop/feature-core/renderer';
import { registerChatToolResult } from '@setsuna-desktop/renderer-contracts/chat';
import { automationFeature, automationTaskCodec } from '../contracts/index.js';
import { automationClientCapability, createAutomationClient } from './client.js';
import { automationMessages } from './messages.js';
import { TaskResultCard } from './TaskResultCard.js';
import { automationRendererHostCapability } from './host.js';
import './automation.css';

const dependencies = defineRendererDependencies({
  transport: requiredCapability(rendererFeatureOperationTransportCapability),
  host: requiredCapability(automationRendererHostCapability),
});
export const automationRendererFeature = defineRendererFeature({
  definition: automationFeature, dependencies, messages: [automationMessages], provides: [declareCapabilityProvider(automationClientCapability)],
  setup(context) {
    const client = createAutomationClient(context.dependencies.transport);
    context.provide(declareCapabilityProvider(automationClientCapability), client);
    registerChatToolResult(context.ui, {
      id: 'automation.task-card', resultKind: 'automation.task', major: 1, payload: automationTaskCodec,
      sourceToolNames: ['manage_automation'], presentation: 'replace', placement: 'assistant-timeline',
      render: (props) => <TaskResultCard {...props} client={client} ModelPicker={context.dependencies.host.ModelPicker} />,
    });
  },
});
