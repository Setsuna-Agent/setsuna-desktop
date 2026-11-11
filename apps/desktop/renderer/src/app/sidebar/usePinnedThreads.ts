import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { useCallback, useMemo } from 'react';
import { usePinnedSidebarIds } from './usePinnedSidebarIds.js';

export const PINNED_THREADS_STORAGE_KEY = 'setsuna-pinned-threads-v1';

export function usePinnedThreads(
  projects: WorkspaceProject[],
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>,
  globalThreads: RuntimeThreadSummary[],
) {
  const { ids: pinnedThreadIds, toggle } = usePinnedSidebarIds(PINNED_THREADS_STORAGE_KEY);
  const togglePinnedThread = useCallback((thread: RuntimeThreadSummary) => toggle(thread.id), [toggle]);

  const pinnedThreads = useMemo(() => {
    const availableThreads = new Map([
      ...globalThreads,
      ...projects.flatMap((project) => threadsByProjectId.get(project.id) ?? []),
    ].filter((thread) => !thread.archived).map((thread) => [thread.id, thread]));
    // Only project the current sidebar snapshot. Do not discard saved IDs while
    // threads are loading; pinning never changes a conversation's projectId.
    return [...pinnedThreadIds].flatMap((id) => {
      const thread = availableThreads.get(id);
      return thread ? [thread] : [];
    });
  }, [globalThreads, pinnedThreadIds, projects, threadsByProjectId]);

  return { pinnedThreadIds, pinnedThreads, togglePinnedThread };
}

export type PinnedThreadsState = ReturnType<typeof usePinnedThreads>;
