import type { DesktopRuntimeClient, RuntimeThread, WorkspaceProject } from '@setsuna-desktop/contracts';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

type ThreadWorkspaceOptions = {
  client: Pick<DesktopRuntimeClient, 'getWorkspaceStatus'>;
  projectWorkspace?: WorkspaceProject;
  setError?: Dispatch<SetStateAction<string | null>>;
  thread: Pick<RuntimeThread, 'id' | 'projectId'> | null;
};

type ResolvedTemporaryWorkspace = {
  status: Exclude<ThreadWorkspaceStatus, 'idle'>;
  threadId: string;
  workspace: WorkspaceProject | null;
};

export type ThreadWorkspaceStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ThreadWorkspaceState = {
  status: ThreadWorkspaceStatus;
  workspace?: WorkspaceProject;
};

/** Resolve a global thread's isolated workspace while preserving project-bound thread semantics. */
export function useThreadWorkspace({ client, projectWorkspace, setError, thread }: ThreadWorkspaceOptions): ThreadWorkspaceState {
  const [temporaryWorkspace, setTemporaryWorkspace] = useState<ResolvedTemporaryWorkspace | null>(null);
  const threadId = thread?.id ?? null;
  const threadProjectId = thread?.projectId ?? null;

  useEffect(() => {
    if (!threadId || threadProjectId) {
      setTemporaryWorkspace(null);
      return undefined;
    }

    let cancelled = false;
    setTemporaryWorkspace({ status: 'loading', threadId, workspace: null });
    void client.getWorkspaceStatus({ threadId }).then((status) => {
      if (!cancelled) setTemporaryWorkspace({ status: 'ready', threadId, workspace: status.project ?? null });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setTemporaryWorkspace({ status: 'error', threadId, workspace: null });
      setError?.(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [client, setError, threadId, threadProjectId]);

  return resolveThreadWorkspaceState({ projectWorkspace, temporaryWorkspace, thread });
}

export function resolveThreadWorkspaceState({
  projectWorkspace,
  temporaryWorkspace,
  thread,
}: {
  projectWorkspace?: WorkspaceProject;
  temporaryWorkspace: ResolvedTemporaryWorkspace | null;
  thread: Pick<RuntimeThread, 'id' | 'projectId'> | null;
}): ThreadWorkspaceState {
  const threadProjectId = thread?.projectId ?? null;
  if (!thread) {
    return projectWorkspace
      ? { status: 'ready', workspace: projectWorkspace }
      : { status: 'idle' };
  }
  if (threadProjectId) {
    return projectWorkspace?.id === threadProjectId
      ? { status: 'ready', workspace: projectWorkspace }
      : { status: 'loading' };
  }
  if (temporaryWorkspace?.threadId !== thread.id) return { status: 'loading' };
  return temporaryWorkspace.workspace
    ? { status: temporaryWorkspace.status, workspace: temporaryWorkspace.workspace }
    : { status: temporaryWorkspace.status };
}

export function readyThreadWorkspacePath(
  workspace: WorkspaceProject | null | undefined,
  status: ThreadWorkspaceStatus,
): string | null {
  return status === 'ready' && workspace?.path ? workspace.path : null;
}
