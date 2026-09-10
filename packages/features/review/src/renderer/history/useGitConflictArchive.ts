import { useRef, useState } from 'react';
import { useGitConflictTasks, useReviewRendererService, type GitConflictTaskRecord } from '../context.js';
import { useReviewRendererHost } from '../host.js';
import { errorMessage } from './useGitHistory.js';

export function useGitConflictArchive(workspaceRoot: string) {
  const service = useReviewRendererService();
  const { updateTask } = useGitConflictTasks();
  const { notifyError, translate: t } = useReviewRendererHost();
  const saving = useRef(false);
  const [pending, setPending] = useState(false);

  const archiveTasks = async (tasks: readonly GitConflictTaskRecord[]): Promise<readonly string[]> => {
    if (!service.available || saving.current) return [];
    saving.current = true;
    setPending(true);
    const archivedTurnIds: string[] = [];
    try {
      // Persist each result before hiding it. If a write fails, the remaining
      // records stay visible and can be retried without repeating successful ones.
      for (const task of tasks) {
        if (task.archived) continue;
        const updated = await service.setGitConflictArchived({ workspaceRoot, threadId: task.threadId, archived: true });
        updateTask(workspaceRoot, updated);
        archivedTurnIds.push(task.turnId);
      }
    } catch (error) {
      notifyError(t('feature.review.git.conflictArchiveFailed', { error: errorMessage(error) }));
    } finally {
      saving.current = false;
      setPending(false);
    }
    return archivedTurnIds;
  };
  return { archiveTasks, pending, disabled: pending || !service.available };
}
