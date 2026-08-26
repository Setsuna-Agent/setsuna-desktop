import {
  visibleTextOutsideThinkTags,
  type RuntimeMessage,
} from '@setsuna-desktop/contracts';

/**
 * Legacy messages predate structured stream parts and may still contain
 * provider-only <think> blocks in content. Never replay those blocks across
 * provider or model boundaries.
 */
export function portableAssistantText(message: RuntimeMessage): string {
  return message.streamParts === undefined
    ? visibleTextOutsideThinkTags(message.content)
    : message.content;
}
