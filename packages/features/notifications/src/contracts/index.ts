import { defineCapability } from '@setsuna-desktop/feature-core/capability';
import { defineFeature } from '@setsuna-desktop/feature-core/definition';
import type { RuntimeThread, RuntimeToolDefinition, StoredThreadEvent } from '@setsuna-desktop/contracts';

export const notificationsFeature = defineFeature('notifications');
export const NOTIFICATION_PATH = '/v1/features/notifications/send';
export const notificationChannels = {
  openThread: 'notifications:open-thread',
} as const;

export type NotificationInput = {
  id: string; threadId: string; title: string; body: string;
  /** Automatic turn completions stay quiet while a desktop window is focused. */
  onlyWhenBackground?: boolean;
};
export type NotificationReceipt = { id: string; systemNotification: 'shown' | 'duplicate' | 'suppressed' };
export type NotificationsBridge = {
  onOpenThread(listener: (threadId: string) => void): () => void;
};
export type NotificationsPreloadContribution = { notifications: NotificationsBridge };
export type NotificationToolContext = { threadId: string; toolCallId?: string; readOnly?: boolean; signal?: AbortSignal };
export type NotificationToolService = {
  listTools(): RuntimeToolDefinition[];
  send(value: unknown, context: NotificationToolContext): Promise<{ content: string; preview: string }>;
};
export const notificationToolServiceCapability = defineCapability<NotificationToolService>({
  id: 'notifications.tools', description: 'Model notification tool bound to its source conversation',
});
export type NotificationsRuntimeHost = {
  subscribe(listener: (event: StoredThreadEvent) => void): () => void;
  getThread(threadId: string): Promise<RuntimeThread | null>;
};
export const notificationsRuntimeHostCapability = defineCapability<NotificationsRuntimeHost>({
  id: 'notifications.runtime-host', description: 'Live persisted events and their source conversation',
});

export function readNotificationInput(value: unknown): NotificationInput {
  const input = record(value);
  if (input.onlyWhenBackground !== undefined && typeof input.onlyWhenBackground !== 'boolean') {
    throw new Error('Invalid notification foreground policy.');
  }
  return {
    id: text(input.id, 1024), threadId: text(input.threadId, 256),
    title: text(input.title, 200), body: text(input.body, 5000),
    ...(input.onlyWhenBackground !== undefined ? { onlyWhenBackground: input.onlyWhenBackground as boolean } : {}),
  };
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected notification object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid notification text.');
  return value.trim();
}
