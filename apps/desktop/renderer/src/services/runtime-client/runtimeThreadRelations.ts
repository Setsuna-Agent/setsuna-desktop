import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';

/** Primary conversations exclude transient side chats and child-agent threads. */
export function isPrimaryConversationThread(thread: RuntimeThreadSummary): boolean {
  return thread.kind !== 'side' && !thread.parentThreadId;
}
