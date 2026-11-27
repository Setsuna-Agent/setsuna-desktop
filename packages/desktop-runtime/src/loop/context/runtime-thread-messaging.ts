import { mailboxMessageId, parseThreadMentions, type RuntimeMessage, type RuntimeThread } from '@setsuna-desktop/contracts';
import type { ThreadMessagingScope } from '../../ports/tool-host.js';

export const THREAD_MESSAGE_TOOL_NAME = 'send_thread_message';

export function acceptsThreadMessages(thread: RuntimeThread): boolean {
  return !thread.archived && !thread.parentThreadId && thread.kind !== 'side' && !thread.featureId && !thread.origin;
}

/** Use persisted inputs so excerpts, hook rewrites and model text cannot grant access to a new recipient. */
export function threadMessagingScope(
  messages: readonly RuntimeMessage[], turnId: string, regeneratedInputId?: string,
): ThreadMessagingScope | undefined {
  const recipients = new Set<string>();
  const replies = new Map<string, string>();
  let hasCurrentUserInput = false;
  const mailboxPrefix = mailboxMessageId('');
  for (const message of messages) {
    if (message.role !== 'user' || (message.turnId !== turnId && message.id !== regeneratedInputId)) continue;
    if (message.visibility === 'model' && message.threadMessage && !message.threadMessage.replyTo && message.id.startsWith(mailboxPrefix)) {
      replies.set(message.id.slice(mailboxPrefix.length), message.threadMessage.from.id);
    } else if (isUserInput(message)) {
      hasCurrentUserInput = true;
      for (const { thread } of parseThreadMentions(message.content)) recipients.add(thread.id);
    }
  }
  // A user follow-up can reuse the latest explicit selection. Mailbox-triggered turns
  // without user input can only reply to incoming requests in their own turn.
  if (hasCurrentUserInput && !recipients.size) {
    for (let index = messages.length - 1; index >= 0 && !recipients.size; index -= 1) {
      const message = messages[index]!;
      if (!isUserInput(message)) continue;
      for (const { thread } of parseThreadMentions(message.content)) recipients.add(thread.id);
    }
  }
  return recipients.size || replies.size ? { recipients, replies } : undefined;
}

function isUserInput(message: RuntimeMessage): boolean {
  return message.role === 'user' && message.visibility !== 'model' && !message.promptSource
    && !message.contextCompaction && !message.threadMessage && message.inputKind !== 'subagent_task';
}
