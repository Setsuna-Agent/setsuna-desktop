import { useEffect, useRef, useState } from 'react';
import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import { useGitConflictTasks, useReviewRendererService, type GitConflictTaskRecord } from '../context.js';
import { useReviewRendererHost } from '../host.js';

const EMPTY_TASKS: readonly GitConflictTaskRecord[] = [];
const NOT_STARTED = { started: false, error: null } as const;

/** Called only after a failed pull/sync. Runtime checks the saved switch and actual unmerged files. */
export function useAutoResolveGitConflicts({ threadId, workspaceRoot, modelSelection }: {
  threadId?: string;
  workspaceRoot: string;
  modelSelection?: RuntimeConfiguredModelReference;
}) {
  const service = useReviewRendererService();
  const { tasks, recordTasks } = useGitConflictTasks();
  const { locale, notifyError, notifySuccess, translate: t } = useReviewRendererHost();
  const identity = `${threadId ?? ''}\0${workspaceRoot}`;
  const [openRequest, setOpenRequest] = useState<{ identity: string; turnId: string } | null>(null);
  const current = useRef(identity);
  current.current = identity;
  useEffect(() => {
    if (!service.available || !workspaceRoot) return;
    const controller = new AbortController();
    void service.readGitConflictHistory({ workspaceRoot }, { signal: controller.signal }).then((history) => {
      if (!controller.signal.aborted) recordTasks(workspaceRoot, history);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) notifyError(t('feature.review.git.conflictHistoryFailed', { error: error instanceof Error ? error.message : String(error) }));
    });
    return () => controller.abort();
  }, [service, workspaceRoot, recordTasks, notifyError, t]);
  const resolveConflicts = async (operation: GitConflictTaskRecord['operation']): Promise<{ started: boolean; error: string | null }> => {
    if (!service.available || current.current !== identity) return NOT_STARTED;
    try {
      if (!threadId) {
        const state = await service.readGitSettings();
        return { started: false, error: state.settings.autoResolveConflicts ? t('feature.review.git.conflictConversationRequired') : null };
      }
      const result = await service.resolveGitConflicts({
        threadId, workspaceRoot, modelSelection, operation,
        language: locale === 'zh-CN' ? 'zh-CN' : 'en-US',
      });
      if (result.started) {
        recordTasks(workspaceRoot, [result]);
        if (current.current === identity) {
          // History hydration only updates records; a live Git action may request opening its progress.
          setOpenRequest({ identity, turnId: result.turnId });
          notifySuccess(t('feature.review.git.conflictStarted'));
        }
      }
      return { started: result.started, error: null };
    } catch (error) {
      return { started: false, error: current.current === identity
        ? t('feature.review.git.conflictStartFailed', { error: error instanceof Error ? error.message : String(error) })
        : null };
    }
  };
  return {
    resolveConflicts,
    conflictTasks: tasks.get(workspaceRoot) ?? EMPTY_TASKS,
    conflictOpenRequest: openRequest?.identity === identity ? openRequest.turnId : null,
  };
}
