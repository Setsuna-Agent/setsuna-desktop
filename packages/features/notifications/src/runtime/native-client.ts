import { Agent } from 'undici';
import { NOTIFICATION_PATH, record, text, type NotificationInput, type NotificationReceipt } from '../contracts/index.js';

export class NativeNotificationClient {
  private readonly dispatcher: Agent;
  constructor(private readonly baseUrl: string, private readonly token: string) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || !token) {
      throw new Error('Notifications require authenticated loopback HTTP.');
    }
    this.dispatcher = new Agent();
  }
  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): NativeNotificationClient | null {
    const url = env.SETSUNA_DESKTOP_NATIVE_BRIDGE_URL;
    const token = env.SETSUNA_DESKTOP_NATIVE_BRIDGE_TOKEN;
    return url && token ? new NativeNotificationClient(url, token) : null;
  }
  async send(input: NotificationInput, signal?: AbortSignal): Promise<NotificationReceipt> {
    const timeout = AbortSignal.timeout(10_000);
    const response = await fetch(new URL(NOTIFICATION_PATH, this.baseUrl), {
      method: 'POST', redirect: 'error', dispatcher: this.dispatcher,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    } as RequestInit);
    const value = record(await response.json());
    if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'System notification failed.');
    const systemNotification = value.systemNotification;
    if (value.id !== input.id || !['shown', 'duplicate', 'suppressed'].includes(String(systemNotification))) {
      throw new Error('Invalid notification receipt.');
    }
    return { id: text(value.id, 1024), systemNotification: systemNotification as NotificationReceipt['systemNotification'] };
  }
  async close(): Promise<void> { await this.dispatcher.close(); }
}
