import { useMemo } from 'react';
import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';

export function useThreadGroups(threads: RuntimeThreadSummary[]) {
  return useMemo(() => {
    const globalThreads = threads.filter((thread) => !thread.projectId);
    const threadsByProjectId = new Map<string, RuntimeThreadSummary[]>();
    for (const thread of threads) {
      if (!thread.projectId) continue;
      const list = threadsByProjectId.get(thread.projectId) ?? [];
      list.push(thread);
      threadsByProjectId.set(thread.projectId, list);
    }
    return { globalThreads, threadsByProjectId };
  }, [threads]);
}
