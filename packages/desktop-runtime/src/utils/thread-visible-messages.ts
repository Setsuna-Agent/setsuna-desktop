import { visibleTextOutsideThinkTags, type RuntimeMessage } from '@setsuna-desktop/contracts';

/** Cross-conversation reads expose transcript data, never another turn's internal prompt or reasoning. */
export function isVisibleThreadMessage(message: RuntimeMessage): boolean {
  return (message.role === 'user' || message.role === 'assistant' || message.role === 'tool')
    && message.visibility !== 'model' && !message.promptSource
    && !message.contextCompaction && !message.goalMode && !message.reviewMode && !message.planMode;
}

export function visibleThreadMessageContent(message: RuntimeMessage): string {
  if (message.role !== 'assistant') return message.content;
  return message.streamParts
    ? message.streamParts.filter((part) => part.type === 'content').map((part) => part.content).join('')
    : visibleTextOutsideThinkTags(message.content);
}
