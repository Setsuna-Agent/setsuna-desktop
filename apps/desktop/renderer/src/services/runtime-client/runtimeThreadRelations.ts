import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';

/** Feature-owned, transient and child-agent chats have their own navigation. */
export function isPrimaryConversationThread(thread: RuntimeThreadSummary): boolean {
  return !thread.featureId && thread.kind !== 'side' && !thread.parentThreadId;
}
