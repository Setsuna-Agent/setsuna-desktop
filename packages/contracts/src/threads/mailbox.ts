import type { RuntimeThreadReference } from './reference.js';

export type RuntimeThreadMessageOrigin = { from: RuntimeThreadReference; replyTo?: string };

export type RuntimeMailboxDelivery = {
  id: string;
  content: string;
  deliveryMode?: 'queue_only' | 'trigger_turn';
  fromAgentId?: string;
  fromThreadId?: string;
  threadMessage?: RuntimeThreadMessageOrigin;
  toAgentId?: string;
  triggerTurn?: boolean;
};

export type RuntimeMailboxDeliveryRecord = RuntimeMailboxDelivery & {
  createdAt: string;
  turnId?: string;
  consumed?: true;
};

export function mailboxMessageId(deliveryId: string): string {
  return `mailbox_${deliveryId}`;
}

const THREAD_MESSAGE_TRANSCRIPT_PREFIX = 'thread_message_';

export function threadMessageTranscriptId(deliveryId: string): string {
  return `${THREAD_MESSAGE_TRANSCRIPT_PREFIX}${deliveryId}`;
}

export function threadMessageReceiptId(transcriptId: string): string | undefined {
  if (!transcriptId.startsWith(THREAD_MESSAGE_TRANSCRIPT_PREFIX)) return undefined;
  return mailboxMessageId(transcriptId.slice(THREAD_MESSAGE_TRANSCRIPT_PREFIX.length));
}
