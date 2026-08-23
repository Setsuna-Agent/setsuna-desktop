import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { useMemo } from 'react';
import { isPrimaryConversationThread } from '../../services/runtime-client/runtimeThreadRelations.js';

export function useThreadGroups(threads: RuntimeThreadSummary[]) {
  return useMemo(() => {
    // 子代理 child 线程不属于主对话，永远不进入侧栏分组。
    const primaryThreads = threads.filter(isPrimaryConversationThread);
    const globalThreads = primaryThreads.filter((thread) => !thread.projectId);
    const threadsByProjectId = new Map<string, RuntimeThreadSummary[]>();
    for (const thread of primaryThreads) {
      if (!thread.projectId) continue;
      const list = threadsByProjectId.get(thread.projectId) ?? [];
      list.push(thread);
      threadsByProjectId.set(thread.projectId, list);
    }
    return { globalThreads, threadsByProjectId };
  }, [threads]);
}
