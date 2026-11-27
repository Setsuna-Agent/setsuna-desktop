import { declareCapabilityProvider, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineRuntimeDependencies, defineRuntimeFeature } from '@setsuna-desktop/feature-core/runtime';
import { notificationsFeature, notificationToolServiceCapability, notificationsRuntimeHostCapability } from '../contracts/index.js';
import { NativeNotificationClient } from './native-client.js';
import { NotificationTools } from './tools.js';
import { completedTurnNotification, isNotifiableCompletion } from './turn-completion.js';
import { isThreadMessageDelivery, threadMessageNotification } from './thread-message.js';

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
    // Only live persisted events can produce a notification, including when the receiver is inactive.
    context.scope.add(host.subscribe((event) => {
      if (!isNotifiableCompletion(event) && !isThreadMessageDelivery(event)) return;
      void context.scope.runOperation(async (signal) => {
        const thread = await host.getThread(event.threadId);
        signal.throwIfAborted();
        const input = event.type === 'mailbox.delivered'
          ? threadMessageNotification(event, thread)
          : completedTurnNotification(event, thread);
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
