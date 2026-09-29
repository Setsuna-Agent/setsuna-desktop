import type { DesktopRuntimeClient, RuntimeThread, WorkspaceProject, WorkspaceStatus } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';

type ThreadWorkspaceOptions = {
  client: Pick<DesktopRuntimeClient, 'getWorkspaceStatus'>;
  projectWorkspace?: WorkspaceProject;
  setError?: Dispatch<SetStateAction<string | null>>;
  thread: Pick<RuntimeThread, 'id' | 'projectId' | 'workspaceId'> | null;
};

type ResolvedThreadWorkspace = {
  status: Exclude<ThreadWorkspaceStatus, 'idle'>;
  threadId: string;
  workspaceId?: string | null;
  workspace: WorkspaceProject | null;
};

export type ThreadWorkspaceStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export type ThreadWorkspaceState = {
  status: ThreadWorkspaceStatus;
  workspace?: WorkspaceProject;
};

/** Resolve conversation worktrees and temporary directories independently of project ownership. */
export function useThreadWorkspace({ client, projectWorkspace, setError, thread }: ThreadWorkspaceOptions) {
  const { t } = useI18n();
  const [resolvedWorkspace, setResolvedWorkspace] = useState<ResolvedThreadWorkspace | null>(null);
  const [missingPrompt, setMissingPrompt] = useState<{ isCurrent(): boolean } | null>(null);
  const threadId = thread?.id ?? null;
  const threadProjectId = thread?.projectId ?? null;
  const threadWorkspaceId = thread?.workspaceId ?? null;
  const requests = useIdentityRequestGuard(JSON.stringify([threadId, threadWorkspaceId]));

  useEffect(() => {
    if (!threadId || (threadProjectId && !threadWorkspaceId)) {
      setResolvedWorkspace(null);
      return undefined;
    }

    const isCurrent = requests.begin();
    setResolvedWorkspace({ status: 'loading', threadId, workspaceId: threadWorkspaceId, workspace: null });
    void client.getWorkspaceStatus({ threadId }).then((status) => {
      if (isCurrent()) setResolvedWorkspace({
        ...resolvedWorkspaceStatus(status, Boolean(threadWorkspaceId)), threadId, workspaceId: threadWorkspaceId,
      });
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      setResolvedWorkspace({ status: 'error', threadId, workspaceId: threadWorkspaceId, workspace: null });
      setError?.(error instanceof Error ? error.message : String(error));
    });
    return () => requests.invalidate();
  }, [client, requests, setError, threadId, threadProjectId, threadWorkspaceId]);

  const ensureAvailableForSend = useCallback(async () => {
    if (!threadId || !threadWorkspaceId) return true;
    const isCurrent = requests.begin();
    // Recheck on send: a worktree can disappear while its conversation remains open.
    const status = await client.getWorkspaceStatus({ threadId });
    if (!isCurrent()) return false;
    const resolved = resolvedWorkspaceStatus(status, true);
    setResolvedWorkspace({ ...resolved, threadId, workspaceId: threadWorkspaceId });
    if (resolved.status === 'missing') {
      setMissingPrompt({ isCurrent });
      return false;
    }
    if (resolved.status !== 'ready') throw new Error(t('workspace.error.unavailable'));
    return true;
  }, [client, requests, t, threadId, threadWorkspaceId]);
  const dismissMissingWorktreePrompt = useCallback(() => setMissingPrompt(null), []);
  const state = resolveThreadWorkspaceState({ projectWorkspace, resolvedWorkspace, thread });
  return {
    ...state,
    ensureAvailableForSend,
    missingWorktreePromptOpen: state.status === 'missing' && Boolean(missingPrompt?.isCurrent()),
    dismissMissingWorktreePrompt,
  };
}

export function resolveThreadWorkspaceState({
  projectWorkspace,
  resolvedWorkspace,
  thread,
}: {
  projectWorkspace?: WorkspaceProject;
  resolvedWorkspace: ResolvedThreadWorkspace | null;
  thread: Pick<RuntimeThread, 'id' | 'projectId' | 'workspaceId'> | null;
}): ThreadWorkspaceState {
  const threadProjectId = thread?.projectId ?? null;
  if (!thread) {
    return projectWorkspace
      ? { status: 'ready', workspace: projectWorkspace }
      : { status: 'idle' };
  }
  if (threadProjectId && !thread.workspaceId) {
    return projectWorkspace?.id === threadProjectId
      ? { status: 'ready', workspace: projectWorkspace }
      : { status: 'loading' };
  }
  if (resolvedWorkspace?.threadId !== thread.id
    || (resolvedWorkspace.workspaceId ?? null) !== (thread.workspaceId ?? null)) return { status: 'loading' };
  return resolvedWorkspace.workspace
    ? { status: resolvedWorkspace.status, workspace: resolvedWorkspace.workspace }
    : { status: resolvedWorkspace.status };
}

/** Missing worktrees must not reach file, review or terminal consumers as usable directories. */
export function resolvedWorkspaceStatus(status: WorkspaceStatus, worktree: boolean): Pick<ResolvedThreadWorkspace, 'status' | 'workspace'> {
  if (!status.exists || !status.readable || !status.project?.path) {
    return { status: worktree && !status.exists ? 'missing' : 'error', workspace: null };
  }
  return { status: 'ready', workspace: status.project };
}

export function readyThreadWorkspacePath(
  workspace: WorkspaceProject | null | undefined,
  status: ThreadWorkspaceStatus,
): string | null {
  return status === 'ready' && workspace?.path ? workspace.path : null;
}
