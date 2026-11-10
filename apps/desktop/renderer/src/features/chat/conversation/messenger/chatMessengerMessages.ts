import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { ChatDisplayItem } from '../chatMessageDisplay.js';
import { visibleMarkdownContent } from '../chatThinkingContent.js';

type AssistantItem = Extract<ChatDisplayItem, { type: 'assistant' }>;

export function messengerReplyContent(message: RuntimeMessage): string {
  if (message.streamParts?.length) {
    return message.streamParts.filter((part) => part.type === 'content').map((part) => part.content).join('');
  }
  return message.streamParts ? message.content : visibleMarkdownContent(message.content);
}

/** Keep the original item and message IDs so edits/deletion still operate on the whole turn. */
export function messengerReplySegments(item: AssistantItem): RuntimeMessage[] {
  // An unclassified stream may still become tool commentary; wait for a confirmed reply.
  return item.segments.filter((message) => message.phase !== 'commentary'
    && (message.phase === 'final_answer' || (message.status !== 'streaming' && !message.toolCalls?.length && !message.toolRuns?.length))
    && Boolean(messengerReplyContent(message).trim() || message.attachments?.length || message.error));
}

export function messengerDisplayItems(items: ChatDisplayItem[]): ChatDisplayItem[] {
  return items.filter((item) => item.type === 'user'
    || (item.type === 'assistant' && messengerReplySegments(item).length > 0));
}

export function messengerItemTimestamp(item: ChatDisplayItem | undefined): string | undefined {
  if (!item) return undefined;
  return item.type === 'assistant'
    ? (messengerReplySegments(item)[0] ?? item.segments[0])?.createdAt
    : item.message.createdAt;
}
