import type { SweNotification } from '@setsuna-desktop/contracts';

export type AppServerNotificationMetadata = {
  connectionId?: string;
};

export type AppServerNotificationSubscriber = (
  notification: SweNotification,
  metadata: AppServerNotificationMetadata,
) => void;

export type AppServerNotificationBus = {
  publish(notification: SweNotification, metadata?: AppServerNotificationMetadata): void;
  subscribe(subscriber: AppServerNotificationSubscriber): () => void;
};
