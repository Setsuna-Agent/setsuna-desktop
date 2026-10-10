import { Notification } from 'electron';
import type { NotificationInput, NotificationReceipt } from '../contracts/index.js';
import { waitForNotificationDelivery } from './delivery.js';

export class NativeNotifications {
  private readonly active = new Map<string, Notification>();
  private readonly sent = new Set<string>();
  private readonly pending = new Map<string, Promise<void>>();
  constructor(private readonly open: (threadId: string) => void, private readonly report: (error: unknown) => void) {}

  async show(item: NotificationInput, signal?: AbortSignal): Promise<NotificationReceipt['systemNotification']> {
    signal?.throwIfAborted();
    if (this.sent.has(item.id)) return 'duplicate';
    const previous = this.pending.get(item.id);
    if (previous) { await previous; signal?.throwIfAborted(); return 'duplicate'; }
    if (!Notification.isSupported()) throw new Error('System notifications are unavailable on this device.');
    try {
      const notification = new Notification({ title: item.title, body: item.body });
      const release = () => { notification.removeAllListeners(); this.active.delete(item.id); };
      notification.once('click', () => { this.open(item.threadId); release(); });
      // Windows times out the banner while keeping the notification clickable in Action Center.
      notification.on('close', (event) => { if (event.reason !== 'timedOut') release(); });
      this.active.set(item.id, notification);
      const delivery = waitForNotificationDelivery(notification, signal);
      this.pending.set(item.id, delivery);
      await delivery;
      signal?.throwIfAborted();
      this.sent.add(item.id);
      // Bound callback/deduplication retention without deleting the OS notification history.
      if (this.sent.size > 200) {
        const oldest = this.sent.values().next().value!;
        this.active.get(oldest)?.removeAllListeners();
        this.active.delete(oldest);
        this.sent.delete(oldest);
      }
      return 'shown';
    } catch (error) {
      const notification = this.active.get(item.id);
      notification?.removeAllListeners();
      // Withdraw only an unsuccessful/cancelled request; confirmed notifications stay in OS history.
      try { notification?.close(); } catch { /* Preserve the original delivery error. */ }
      this.active.delete(item.id);
      this.sent.delete(item.id);
      if (!signal?.aborted) this.report(error);
      throw error;
    } finally {
      this.pending.delete(item.id);
    }
  }

  dispose(): void {
    for (const notification of this.active.values()) notification.removeAllListeners();
    this.active.clear();
    this.sent.clear();
  }
}
