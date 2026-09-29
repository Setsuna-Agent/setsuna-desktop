import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { readBrowserStorageValue, writeBrowserStorageValue } from '../../shared/preferences/browserStorage.js';

export const PINNED_THREADS_STORAGE_KEY = 'setsuna-pinned-threads-v1';

export function usePinnedThreads(
  projects: WorkspaceProject[],
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>,
  globalThreads: RuntimeThreadSummary[],
) {
  const [pinnedThreadIds, setPinnedThreadIds] = useState(readPinnedThreadIds);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === PINNED_THREADS_STORAGE_KEY || event.key === null) setPinnedThreadIds(readPinnedThreadIds());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const togglePinnedThread = useCallback((thread: RuntimeThreadSummary) => {
    // Read the latest shared value so another window's pins are preserved.
    const current = readPinnedThreadIds();
    const next = current.has(thread.id)
      ? new Set([...current].filter((id) => id !== thread.id))
      : new Set([thread.id, ...current]);
    writeBrowserStorageValue(PINNED_THREADS_STORAGE_KEY, JSON.stringify([...next]));
    setPinnedThreadIds(next);
  }, []);

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

function readPinnedThreadIds(): Set<string> {
  try {
    const value: unknown = JSON.parse(readBrowserStorageValue(PINNED_THREADS_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []);
  } catch {
    return new Set();
  }
}
