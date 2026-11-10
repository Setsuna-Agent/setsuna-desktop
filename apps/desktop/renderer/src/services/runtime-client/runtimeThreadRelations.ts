import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';

/** Ordinary conversations are listed under the home's projects and global chats. */
export function isPrimaryConversationThread(thread: RuntimeThreadSummary): boolean {
  return !thread.featureId && thread.kind !== 'side' && !thread.parentThreadId;
}

/** Assistant chats use the home route, but have their own single sidebar entry. */
export function isHomeConversationThread(thread: RuntimeThreadSummary): boolean {
  return isPrimaryConversationThread(thread)
    || (thread.featureId === 'assistants' && thread.kind !== 'side' && !thread.parentThreadId);
}
