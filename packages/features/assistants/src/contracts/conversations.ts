import type { AssistantConversation } from './types.js';

/** Prefer the established shared/desktop transcript when upgrading earlier per-source records. */
export function primaryAssistantConversation(conversations: readonly AssistantConversation[], assistantId: string): AssistantConversation | undefined {
  const candidates = conversations.filter((item) => item.assistantId === assistantId && !item.mergedInto);
  return candidates.find((item) => item.source === 'shared') ?? candidates.find((item) => item.source === 'local') ?? candidates[0];
}
