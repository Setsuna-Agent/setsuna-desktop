import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceGitConflictTask } from '../../contracts/index.js';
import type { ReviewClient } from '../client.js';
import { useGitConflictTasks } from '../context.js';
import { errorMessage } from './useGitHistory.js';

export function useArchivedGitConflicts(client: Pick<ReviewClient, 'readArchivedGitConflicts' | 'setGitConflictArchived' | 'deleteGitConflictTask'>) {
  const { updateTask, removeTask } = useGitConflictTasks();
  const [records, setRecords] = useState<readonly WorkspaceGitConflictTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const mutating = useRef(false);
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void client.readArchivedGitConflicts({ signal: controller.signal }).then((entries) => {
      if (!controller.signal.aborted) setRecords(entries);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [client, reload]);

  const runAction = async (task: WorkspaceGitConflictTask, action: 'restore' | 'delete'): Promise<boolean> => {
    if (loading || mutating.current) return false;
    mutating.current = true;
    setPending(true);
    setError(null);
    try {
      const input = { workspaceRoot: task.workspaceRoot, threadId: task.threadId };
      if (action === 'delete') {
        await client.deleteGitConflictTask(input);
        removeTask(task.turnId);
      } else {
        const updated = await client.setGitConflictArchived({ ...input, archived: false });
        updateTask(task.workspaceRoot, updated);
      }
      setRecords((current) => current?.filter((entry) => entry.turnId !== task.turnId) ?? null);
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      mutating.current = false;
      setPending(false);
    }
  };
  return { records, error, pending: pending || loading, retry,
    restore: (task: WorkspaceGitConflictTask) => runAction(task, 'restore'),
    remove: (task: WorkspaceGitConflictTask) => runAction(task, 'delete'),
  };
}
