import type {
  DesktopRuntimeClient,
  RuntimeUsageQuery,
  RuntimeUsageResponse,
} from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdentityRequestGuard } from '../../shared/hooks/useIdentityRequestGuard.js';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import { reportRuntimeBackgroundFailure } from './runtimeClientErrors.js';

export type RuntimeUsageClient = Pick<DesktopRuntimeClient, 'getUsage'>;

export type RuntimeUsageBootstrapResult = PromiseSettledResult<RuntimeUsageResponse>;

type RuntimeUsageStateOptions = {
  client: RuntimeUsageClient;
  currentThreadId: string | null;
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
 * Owns renderer usage state, including thread request identities.
 */
export function useRuntimeUsageState({
  client,
  currentThreadId,
}: RuntimeUsageStateOptions) {
  const [usage, setUsage] = useState<RuntimeUsageResponse | null>(null);
  const [threadUsage, setThreadUsage] = useState<RuntimeUsageResponse | null>(null);
  const threadUsageRequests = useIdentityRequestGuard(
    currentThreadId ? `thread:${currentThreadId}` : 'thread:none',
  );
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
    if (!currentThreadId) {
      threadUsageRequests.invalidate();
      setThreadUsage(null);
      return undefined;
    }
    setThreadUsage(null);
    void refreshThreadUsage(currentThreadId);
    return () => threadUsageRequests.invalidate();
  }, [currentThreadId, refreshThreadUsage, threadUsageRequests]);

  return {
    applyBootstrapUsage,
    queryUsage,
    refreshThreadUsage,
    refreshUsage,
    threadUsage,
    usage,
  };
}
