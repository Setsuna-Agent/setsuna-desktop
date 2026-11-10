import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeDependencies, defineRuntimeFeature, runtimeRouteRegistrarCapability } from '@setsuna-desktop/feature-core/runtime';
import {
  assistantsFeature, assistantsRuntimeHostCapability, assistantsToolServiceCapability, createAssistant,
  deleteAssistant, deleteAssistantSidebarEntry, listAssistants, openAssistantConversation, revealAssistantQqSecret,
  setAssistantQqSecret, updateAssistant, updateAssistantPeer, updateAssistantSidebarEntry,
} from '../contracts/index.js';
import { AssistantsRuntime } from './service.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(assistantsRuntimeHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});

export const assistantsRuntimeFeature = defineRuntimeFeature({
  definition: assistantsFeature, dependencies, provides: [declareCapabilityProvider(assistantsToolServiceCapability)],
  async setup(context) {
    const runtime = new AssistantsRuntime(context.dependencies.host, (error) => {
      context.health.setCondition('background', { code: 'BACKGROUND_FAILED', message: error instanceof Error ? error.message : String(error) });
    });
    await runtime.initialize();
    context.scope.add(() => runtime.dispose());
    const routes = context.dependencies.routes;
    const directory = runtime.directory;
    routes.register(context.scope, listAssistants, () => directory.snapshot());
    routes.register(context.scope, createAssistant, ({ draft }) => directory.create(draft));
    routes.register(context.scope, updateAssistant, ({ assistantId, draft }) => directory.update(assistantId, draft));
    routes.register(context.scope, deleteAssistant, ({ assistantId }) => directory.delete(assistantId));
    routes.register(context.scope, openAssistantConversation, ({ assistantId }) => directory.openConversation(assistantId));
    routes.register(context.scope, updateAssistantSidebarEntry, (input) => runtime.sidebarEntries.update(input));
    routes.register(context.scope, deleteAssistantSidebarEntry, (input) => runtime.sidebarEntries.delete(input));
    routes.register(context.scope, revealAssistantQqSecret, ({ assistantId }) => directory.revealQqSecret(assistantId));
    routes.register(context.scope, setAssistantQqSecret, ({ assistantId, secret }) => directory.setQqSecret(assistantId, secret));
    routes.register(context.scope, updateAssistantPeer, ({ assistantId, peer }) => directory.updatePeer(assistantId, peer));
    context.provide(declareCapabilityProvider(assistantsToolServiceCapability), runtime);
  },
});
