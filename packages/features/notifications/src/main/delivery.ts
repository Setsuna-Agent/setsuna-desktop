import type { Notification } from 'electron';

/** show() only queues a native request; macOS/Windows report its outcome asynchronously. */
export function waitForNotificationDelivery(notification: Notification, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('System notification delivery was not confirmed.')), 8_000);
    timeout.unref();
    const shown = () => finish();
    const failed = (_event: unknown, message: string) => finish(new Error(`System notification failed: ${message}`));
    const aborted = () => finish(signal?.reason ?? new Error('System notification cancelled.'));
    function finish(error?: unknown) {
      clearTimeout(timeout);
      notification.removeListener('show', shown);
      notification.removeListener('failed', failed);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error);
      else resolve();
    }
    notification.once('show', shown);
    notification.once('failed', failed);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) { aborted(); return; }
    try { notification.show(); } catch (error) { finish(error); }
  });
}
