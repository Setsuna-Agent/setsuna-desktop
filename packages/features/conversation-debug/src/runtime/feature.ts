import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeFeatureSettingsRegistryCapability,
  runtimeRouteRegistrarCapability,
  threadEventReaderCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  DEFAULT_CONVERSATION_DEBUG_SETTINGS,
  conversationDebugControlCapability,
  conversationDebugFeature,
  conversationDebugFeatureSettings,
  conversationDebugLegacySettingsCapability,
  conversationDebugRuntimeHostCapability,
  listConversationDebugEvents,
  listConversationDebugTraces,
  readConversationDebugSettings,
  updateConversationDebugSettings,
} from '../contracts/index.js';
import { RuntimeConversationDebugControl } from './runtime-conversation-debug-control.js';

const dependencies = defineRuntimeDependencies({
  routes: requiredCapability(runtimeRouteRegistrarCapability),
  settings: requiredCapability(runtimeFeatureSettingsRegistryCapability),
  host: requiredCapability(conversationDebugRuntimeHostCapability),
  legacySettings: requiredCapability(conversationDebugLegacySettingsCapability),
  threadEvents: requiredCapability(threadEventReaderCapability),
});

const controlProvider = declareCapabilityProvider(conversationDebugControlCapability);

export const conversationDebugRuntimeFeature = defineRuntimeFeature({
  definition: conversationDebugFeature,
  provides: [controlProvider],
  dependencies,
  settings: [conversationDebugFeatureSettings],
  async setup(context) {
    const preferences = context.dependencies.settings.open(
      conversationDebugFeatureSettings.documents.preferences,
    );
    let initialSettings = DEFAULT_CONVERSATION_DEBUG_SETTINGS;
    let settingsReady = false;
    try {
      if (!await preferences.exists()) {
        await preferences.initialize({ value: await context.dependencies.legacySettings.read() });
      }
      initialSettings = (await preferences.read()).value;
      settingsReady = true;
    } catch {
      context.health.setCondition('settings', {
        code: 'CONVERSATION_DEBUG_SETTINGS_INVALID',
        message: 'Conversation debug settings could not be applied.',
      });
    }

    const control = new RuntimeConversationDebugControl(
      preferences,
      context.dependencies.host,
      initialSettings,
    );
    context.scope.add(preferences.subscribeRuntime(({ value }) => control.applySettings(value)));

    context.dependencies.routes.register(
      context.scope,
      readConversationDebugSettings,
      () => control.readSettings(),
    );
    context.dependencies.routes.register(
      context.scope,
      updateConversationDebugSettings,
      (input) => control.updateSettings(input),
    );
    context.dependencies.routes.register(
      context.scope,
      listConversationDebugEvents,
      async ({ threadId, afterSeq, throughSeq, limit }) => {
        if (!control.enabled()) {
          throw new FeatureOperationFailure({
            code: 'DEBUG_DISABLED',
            message: 'Conversation debug is disabled.',
            retryable: false,
          });
        }
        if (!await context.dependencies.host.threadExists(threadId)) {
          throw new FeatureOperationFailure({
            code: 'THREAD_NOT_FOUND',
            message: 'Thread not found.',
            retryable: false,
          });
        }
        return context.dependencies.threadEvents.readPage(threadId, {
          afterSeq: Number(afterSeq),
          limit: Number(limit),
          throughSeq: Number(throughSeq),
        });
      },
    );
    context.dependencies.routes.register(
      context.scope,
      listConversationDebugTraces,
      async ({ threadId, afterSeq }) => {
        if (!control.enabled()) {
          throw new FeatureOperationFailure({
            code: 'DEBUG_DISABLED',
            message: 'Conversation debug is disabled.',
            retryable: false,
          });
        }
        if (!await context.dependencies.host.threadExists(threadId)) {
          throw new FeatureOperationFailure({
            code: 'THREAD_NOT_FOUND',
            message: 'Thread not found.',
            retryable: false,
          });
        }
        return control.listTraces(threadId, Number(afterSeq));
      },
    );
    context.provide(controlProvider, control);

    if (settingsReady) {
      await context.dependencies.legacySettings.retire();
      context.health.setCondition('settings', null);
    }
  },
});
