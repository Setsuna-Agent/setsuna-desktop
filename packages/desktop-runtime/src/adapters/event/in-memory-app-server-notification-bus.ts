import type { SweNotification } from '@setsuna-desktop/contracts';
import type {
  AppServerNotificationBus,
  AppServerNotificationMetadata,
  AppServerNotificationSubscriber,
} from '../../ports/app-server-notification-bus.js';

export class InMemoryAppServerNotificationBus implements AppServerNotificationBus {
  private readonly subscribers = new Set<AppServerNotificationSubscriber>();

  publish(notification: SweNotification, metadata: AppServerNotificationMetadata = {}): void {
    for (const subscriber of this.subscribers) subscriber(notification, metadata);
  }

  subscribe(subscriber: AppServerNotificationSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}
