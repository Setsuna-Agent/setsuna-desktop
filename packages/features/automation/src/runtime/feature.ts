import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeDependencies, defineRuntimeFeature, runtimeRouteRegistrarCapability } from '@setsuna-desktop/feature-core/runtime';
import {
  automationFeature, automationRuntimeHostCapability, automationToolServiceCapability,
  createAutomation, createAutomationConversation, deleteAutomation, listAutomations,
  runAutomation, setAutomationStatus, updateAutomation,
} from '../contracts/index.js';
import { AutomationService } from './service.js';
import { AutomationTools } from './tools.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(automationRuntimeHostCapability), routes: requiredCapability(runtimeRouteRegistrarCapability),
});

export const automationRuntimeFeature = defineRuntimeFeature({
  definition: automationFeature, dependencies, provides: [declareCapabilityProvider(automationToolServiceCapability)],
  async setup(context) {
    const service = new AutomationService(context.dependencies.host, (error) => {
      context.health.setCondition('scheduler', { code: 'SCHEDULER_FAILED', message: error instanceof Error ? error.message : String(error) });
    });
    await service.initialize();
    context.scope.add(() => service.dispose());
    const routes = context.dependencies.routes;
    routes.register(context.scope, listAutomations, () => service.snapshot());
    routes.register(context.scope, createAutomationConversation, () => service.createConversation());
    routes.register(context.scope, createAutomation, ({ threadId, draft }) => service.create(threadId, draft));
    routes.register(context.scope, updateAutomation, ({ taskId, draft }) => service.update(taskId, draft));
    routes.register(context.scope, setAutomationStatus, ({ taskId, status }) => service.setStatus(taskId, status));
    routes.register(context.scope, runAutomation, ({ taskId }) => service.run(taskId));
    routes.register(context.scope, deleteAutomation, ({ taskId }) => service.delete(taskId));
    context.provide(declareCapabilityProvider(automationToolServiceCapability), new AutomationTools(service, () => context.dependencies.host.now()));
  },
});
