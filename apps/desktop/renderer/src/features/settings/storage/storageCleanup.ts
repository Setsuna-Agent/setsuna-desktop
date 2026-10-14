import type {
  DesktopRuntimeClient,
  DesktopStorageCleanupCategory,
  SetsunaDesktopBridge,
} from '@setsuna-desktop/contracts';
import { isThreadDeletionCancelled } from '../../../services/runtime-client/runtimeClientErrors.js';
import { isPrimaryConversationThread } from '../../../services/runtime-client/runtimeThreadRelations.js';

export type StorageCleanupSelection = {
  threadIds: string[];
  categories: DesktopStorageCleanupCategory[];
};

export async function cleanStorageSelection(
  client: Pick<DesktopRuntimeClient, 'listThreads' | 'deleteThread'>,
  storage: Pick<SetsunaDesktopBridge['dataRoot'], 'clearStorage'>,
  selection: StorageCleanupSelection,
) {
  const deletedThreadIds: string[] = [];
  const failedThreadIds: string[] = [];
  const selectedIds = [...new Set(selection.threadIds)];
  const threads = selectedIds.length ? (await client.listThreads({ includeArchived: true })).threads : [];
  const current = new Map(threads.map((thread) => [thread.id, thread]));
  for (const id of selectedIds) {
    const thread = current.get(id);
    if (!thread) {
      deletedThreadIds.push(id);
      continue;
    }
    if (thread.activeTurnId || !isPrimaryConversationThread(thread)) {
      failedThreadIds.push(id);
      continue;
    }
    try {
      // This client uses the normal main-process deletion guard, including unsaved editors in
      // other windows. Runtime owns child conversations, shared attachments, and image cleanup.
      await client.deleteThread(id, { onlyIfIdle: true });
      deletedThreadIds.push(id);
    } catch (error) {
      if (isThreadDeletionCancelled(error)) {
        return { deletedThreadIds, failedThreadIds, remainingCategories: selection.categories, cancelled: true };
      }
      failedThreadIds.push(id);
    }
  }
  let remainingCategories = selection.categories;
  try {
    if (selection.categories.length) remainingCategories = (await storage.clearStorage(selection.categories)).failedCategories;
  } catch {
    // Conversation deletion may already have committed. Keep only the unfinished selections
    // for a retry instead of treating a failed cache request as a failed history deletion.
  }
  return { deletedThreadIds, failedThreadIds, remainingCategories, cancelled: false };
}
