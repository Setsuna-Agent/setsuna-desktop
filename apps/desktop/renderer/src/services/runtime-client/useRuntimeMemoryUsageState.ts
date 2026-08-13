import type {
  DesktopRuntimeClient,
  RuntimeMemoryPreview,
  RuntimeMemoryRecord,
  RuntimeUsageQuery,
  RuntimeUsageResponse,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdentityRequestGuard } from '../../shared/hooks/useIdentityRequestGuard.js';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import { reportRuntimeBackgroundFailure } from './runtimeClientErrors.js';

export type RuntimeMemoryUsageClient = Pick<
  DesktopRuntimeClient,
  'clearMemories' | 'deleteMemory' | 'getUsage' | 'listMemories' | 'previewMemories'
>;

export type RuntimeUsageBootstrapResult = PromiseSettledResult<RuntimeUsageResponse>;

type RuntimeMemoryUsageStateOptions = {
  activeProjectId: string | null;
  client: RuntimeMemoryUsageClient;
  currentThreadId: string | null;
  enabled: boolean;
};

export function fulfilledUsageValue(
  result: RuntimeUsageBootstrapResult,
): RuntimeUsageResponse | undefined {
  return result.status === 'fulfilled' ? result.value : undefined;
}

export function isOwnedRequestCurrent(
  requestedOwnerId: string,
  currentOwnerId: string | null,
  isLatest: boolean,
): boolean {
  return isLatest && requestedOwnerId === currentOwnerId;
}

/**
 * Owns renderer memory and usage state, including project/thread request identities.
 */
export function useRuntimeMemoryUsageState({
  activeProjectId,
  client,
  currentThreadId,
  enabled,
}: RuntimeMemoryUsageStateOptions) {
  const [usage, setUsage] = useState<RuntimeUsageResponse | null>(null);
  const [threadUsage, setThreadUsage] = useState<RuntimeUsageResponse | null>(null);
  const [memories, setMemories] = useState<RuntimeMemoryRecord[]>([]);
  const [memoryPreview, setMemoryPreview] = useState<RuntimeMemoryPreview | null>(null);
  const [memoryPreviewLoading, setMemoryPreviewLoading] = useState(false);
  const memoryListRequests = useIdentityRequestGuard(
    activeProjectId ? `project:${activeProjectId}` : 'project:global',
  );
  const threadUsageRequests = useIdentityRequestGuard(
    currentThreadId ? `thread:${currentThreadId}` : 'thread:none',
  );
  const memoryPreviewRequests = useLatestRequestGuard();
  const usageRequests = useLatestRequestGuard();
  const currentThreadIdRef = useRef(currentThreadId);
  currentThreadIdRef.current = currentThreadId;

  const applyBootstrapUsage = useCallback((result: RuntimeUsageBootstrapResult) => {
    const nextUsage = fulfilledUsageValue(result);
    if (nextUsage) setUsage(nextUsage);
  }, []);

  const refreshUsage = useCallback(async (): Promise<RuntimeUsageResponse | null> => {
    const isLatest = usageRequests.begin();
    try {
      const nextUsage = await client.getUsage();
      if (isLatest()) setUsage(nextUsage);
      return nextUsage;
    } catch (unknownError) {
      if (isLatest()) {
        reportRuntimeBackgroundFailure('usage refresh', unknownError);
      }
      return null;
    }
  }, [client, usageRequests]);

  const queryUsage = useCallback(
    (query: RuntimeUsageQuery): Promise<RuntimeUsageResponse> => client.getUsage(query),
    [client],
  );

  const refreshThreadUsage = useCallback(
    async (threadId: string): Promise<RuntimeUsageResponse | null> => {
      const isLatest = threadUsageRequests.begin();
      try {
        const nextUsage = await client.getUsage({ threadId });
        if (isOwnedRequestCurrent(threadId, currentThreadIdRef.current, isLatest())) {
          setThreadUsage(nextUsage);
        }
        return nextUsage;
      } catch (unknownError) {
        if (isOwnedRequestCurrent(threadId, currentThreadIdRef.current, isLatest())) {
          reportRuntimeBackgroundFailure('thread usage refresh', unknownError);
        }
        return null;
      }
    },
    [client, threadUsageRequests],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const isCurrentRequest = memoryListRequests.begin();
    setMemories([]);
    void client
      .listMemories({ projectId: activeProjectId ?? undefined, limit: 20 })
      .then((result) => {
        if (isCurrentRequest()) setMemories(result.memories);
      })
      .catch((unknownError) => {
        if (isCurrentRequest()) {
          reportRuntimeBackgroundFailure('memory list refresh', unknownError);
        }
      });
    return () => memoryListRequests.invalidate();
  }, [activeProjectId, client, enabled, memoryListRequests]);

  useEffect(() => {
    if (!currentThreadId) {
      threadUsageRequests.invalidate();
      setThreadUsage(null);
      return undefined;
    }
    setThreadUsage(null);
    void refreshThreadUsage(currentThreadId);
    return () => threadUsageRequests.invalidate();
  }, [currentThreadId, refreshThreadUsage, threadUsageRequests]);

  const previewMemories = useCallback(async () => {
    const isLatest = memoryPreviewRequests.begin();
    setMemoryPreviewLoading(true);
    try {
      const preview = await client.previewMemories();
      if (isLatest()) setMemoryPreview(preview);
      return preview;
    } finally {
      if (isLatest()) setMemoryPreviewLoading(false);
    }
  }, [client, memoryPreviewRequests]);

  const deleteMemory = useCallback(
    async (memoryId: string) => {
      const projectId = activeProjectId;
      const isCurrentListRequest = memoryListRequests.begin();
      const isLatestPreviewRequest = memoryPreviewRequests.begin();
      await client.deleteMemory(memoryId);
      const [list, preview] = await Promise.all([
        client.listMemories({ projectId: projectId ?? undefined, limit: 20 }),
        client.previewMemories(),
      ]);
      if (isCurrentListRequest()) setMemories(list.memories);
      if (isLatestPreviewRequest()) setMemoryPreview(preview);
    },
    [activeProjectId, client, memoryListRequests, memoryPreviewRequests],
  );

  const clearMemories = useCallback(async () => {
    const isCurrentListRequest = memoryListRequests.begin();
    const isLatestPreviewRequest = memoryPreviewRequests.begin();
    const list = await client.clearMemories();
    const preview = await client.previewMemories();
    if (isCurrentListRequest()) setMemories(list.memories);
    if (isLatestPreviewRequest()) setMemoryPreview(preview);
  }, [client, memoryListRequests, memoryPreviewRequests]);

  return {
    applyBootstrapUsage,
    clearMemories,
    deleteMemory,
    memories,
    memoryPreview,
    memoryPreviewLoading,
    previewMemories,
    queryUsage,
    refreshThreadUsage,
    refreshUsage,
    threadUsage,
    usage,
  };
}
