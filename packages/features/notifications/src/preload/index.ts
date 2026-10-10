import { definePreloadFeature } from '@setsuna-desktop/feature-core/preload';
import { ipcRenderer } from 'electron';
import { notificationChannels, notificationsFeature, text,
  type NotificationsBridge, type NotificationsPreloadContribution } from '../contracts/index.js';

export const notificationsPreloadFeature = definePreloadFeature<NotificationsPreloadContribution>({
  definition: notificationsFeature, bridgeKeys: ['notifications'],
  contribute(writer) {
    const bridge: NotificationsBridge = {
      onOpenThread: (listener) => {
        const receive = (_event: unknown, value: unknown) => listener(text(value, 256));
        ipcRenderer.on(notificationChannels.openThread, receive);
        return () => { ipcRenderer.off(notificationChannels.openThread, receive); };
      },
    };
    writer.set('notifications', Object.freeze(bridge));
  },
});
