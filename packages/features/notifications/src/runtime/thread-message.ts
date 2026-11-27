import type { RuntimeEvent, RuntimeThread, StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { NotificationInput } from '../contracts/index.js';
import { notificationPreview } from './turn-completion.js';

type MailboxEvent = Extract<RuntimeEvent, { type: 'mailbox.delivered' }>;

export function isThreadMessageDelivery(event: StoredThreadEvent): event is MailboxEvent {
  return event.type === 'mailbox.delivered' && Boolean(event.payload.threadMessage);
}

export function threadMessageNotification(event: MailboxEvent, thread: RuntimeThread | null): NotificationInput | null {
  if (!event.payload.threadMessage || !thread || thread.archived) return null;
  const sender = notificationPreview(event.payload.threadMessage.from.title, 80) || 'Setsuna';
  const recipient = notificationPreview(thread.title, 80) || 'Setsuna';
  return {
    id: `thread-message:${event.threadId}:${event.payload.id}`,
    threadId: event.threadId,
    title: `${sender} → ${recipient}`,
    body: notificationPreview(event.payload.content, 160),
  };
}
