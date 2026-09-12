import type { DesktopRuntimeClient, WorkspaceStatus, WorkspaceStatusQuery } from '@setsuna-desktop/contracts';
import { useMemo } from 'react';
import type { SearchMarkdownWorkspaceEntries } from '../features/chat/markdown/useMarkdownWorkspaceFiles.js';

/** Bind validation to the review's project/task, including archived tasks outside the active workspace. */
export function useReviewWorkspaceEntries(
  client: Pick<DesktopRuntimeClient, 'getWorkspaceStatus' | 'searchProjectEntries'>,
  { projectId, threadId }: WorkspaceStatusQuery,
): SearchMarkdownWorkspaceEntries | undefined {
  return useMemo(() => {
    if (!projectId && !threadId) return undefined;
    let workspace: Promise<WorkspaceStatus> | undefined;
    return async (query = '', parent?: string | null) => {
      let id = projectId;
      if (!id) {
        workspace ??= client.getWorkspaceStatus({ threadId }).catch((error: unknown) => {
          workspace = undefined;
          throw error;
        });
        id = (await workspace).project?.id;
      }
      if (!id) throw new Error('Review workspace is unavailable.');
      return client.searchProjectEntries(id, query, parent);
    };
  }, [client, projectId, threadId]);
}
