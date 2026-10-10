import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeDependencies, defineRuntimeFeature } from '@setsuna-desktop/feature-core/runtime';
import { notificationsFeature, notificationToolServiceCapability, notificationsRuntimeHostCapability } from '../contracts/index.js';
import { NativeNotificationClient } from './native-client.js';
import { NotificationTools } from './tools.js';
import { completedTurnNotification, isNotifiableCompletion } from './turn-completion.js';

const provider = declareCapabilityProvider(notificationToolServiceCapability);
export const notificationsRuntimeFeature = defineRuntimeFeature({
  definition: notificationsFeature,
  dependencies: defineRuntimeDependencies({ host: requiredCapability(notificationsRuntimeHostCapability) }),
  provides: [provider],
  setup(context) {
    const client = NativeNotificationClient.fromEnvironment();
    if (client) context.scope.add(() => client.close());
    context.provide(provider, new NotificationTools(client));
    if (!client) return;
    const host = context.dependencies.host;
    // Observe only live persisted completions; no startup scan, history replay or renderer subscription.
    context.scope.add(host.subscribe((event) => {
      if (!isNotifiableCompletion(event)) return;
      void context.scope.runOperation(async (signal) => {
        const thread = await host.getThread(event.threadId);
        signal.throwIfAborted();
        const input = completedTurnNotification(event, thread);
        if (!input) return;
        await client.send(input, signal);
        context.health.setCondition('turn-notification', null);
      }).catch((error: unknown) => {
        if (context.scope.signal.aborted) return;
        context.health.setCondition('turn-notification', {
          code: 'TURN_NOTIFICATION_FAILED', message: error instanceof Error ? error.message : String(error),
        });
      });
    }));
  },
});
