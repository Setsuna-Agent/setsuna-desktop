import { defineCapability, requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { defineMainDependencies, defineMainFeature } from '@setsuna-desktop/feature-core/main';
import type { NativeImage } from 'electron';
import { notificationsFeature, NOTIFICATION_PATH, readNotificationInput,
  type NotificationReceipt } from '../contracts/index.js';
import { NativeNotifications } from './native-notifications.js';

export const notificationsMainHostCapability = defineCapability<{
  prepareNotification?(signal: AbortSignal): Promise<NativeImage | string | undefined>;
  isForeground(): boolean;
  openThread(threadId: string): void;
  registerNativeRequest(path: string, handler: (value: unknown, signal: AbortSignal) => Promise<unknown>): () => void;
}>({ id: 'notifications.main-host', description: 'Desktop navigation and authenticated native request registration' });

export const notificationsMainFeature = defineMainFeature({
  definition: notificationsFeature,
  dependencies: defineMainDependencies({ host: requiredCapability(notificationsMainHostCapability) }),
  setup(context) {
    const host = context.dependencies.host;
    const report = (error: unknown) => context.health.setCondition('desktop-notification', {
      code: 'NOTIFICATION_FAILED', message: error instanceof Error ? error.message : String(error),
    });
    let preparation: Promise<NativeImage | string | undefined> | undefined;
    const prepare = () => {
      // Share OS registration across sends, cancel it with the Feature (not one caller),
      // and retry after failure. No preparation runs during Feature activation.
      preparation ??= host.prepareNotification!(context.scope.signal).catch((error: unknown) => {
        preparation = undefined;
        if (!context.scope.signal.aborted) report(error);
        throw error;
      });
      return preparation;
    };
    const native = new NativeNotifications((threadId) => {
      void context.scope.runOperation((signal) => {
        signal.throwIfAborted();
        host.openThread(threadId);
      }).catch(report);
    }, report);
    context.scope.add(() => native.dispose());
    context.scope.add(host.registerNativeRequest(NOTIFICATION_PATH, (value, callerSignal) => (
      context.scope.runOperation(async (signal): Promise<NotificationReceipt> => {
        const input = readNotificationInput(value);
        signal.throwIfAborted();
        if (input.onlyWhenBackground && host.isForeground()) {
          return { id: input.id, systemNotification: 'suppressed' };
        }
        const icon = host.prepareNotification ? await prepare() : undefined;
        signal.throwIfAborted();
        // Registration can outlast a switch back to the application.
        if (input.onlyWhenBackground && host.isForeground()) {
          return { id: input.id, systemNotification: 'suppressed' };
        }
        const systemNotification = await native.show(input, signal, icon);
        context.health.setCondition('desktop-notification', null);
        return { id: input.id, systemNotification };
      }, { signal: callerSignal })
    )));
  },
});
