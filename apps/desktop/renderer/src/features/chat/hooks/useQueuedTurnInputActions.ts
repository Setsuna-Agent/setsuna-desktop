import type {
  DesktopRuntimeClient,
  RuntimeQueuedTurnInput,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { IdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';

export type ChatQueuedTurnActions = {
  deleteQueuedTurnInput: (inputId: string) => Promise<boolean>;
  reorderQueuedTurnInputs: (inputIds: string[]) => Promise<boolean>;
  retrieveQueuedTurnInput: (inputId: string) => Promise<RuntimeQueuedTurnInput | null>;
  sendQueuedTurnInputNow: (inputId: string) => Promise<boolean>;
};

export function useQueuedTurnInputActions({
  actionRequests,
  client,
  currentThread,
  reloadThreads,
  setActiveTurnId,
  setCurrentThread,
  setError,
  terminalTurnIdsRef,
}: {
  actionRequests: IdentityRequestGuard;
  client: DesktopRuntimeClient;
  currentThread: RuntimeThread | null;
  reloadThreads: () => Promise<unknown>;
  setActiveTurnId: Dispatch<SetStateAction<string | null>>;
  setCurrentThread: Dispatch<SetStateAction<RuntimeThread | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  terminalTurnIdsRef: MutableRefObject<Set<string>>;
}): ChatQueuedTurnActions {
  const threadId = currentThread?.id ?? null;
  const deleteQueuedTurnInput = useCallback(async (inputId: string) => {
    if (!threadId) return false;
    const isCurrentRequest = actionRequests.begin();
    try {
      if (isCurrentRequest()) setError(null);
      const response = await client.deleteQueuedTurnInput(threadId, inputId);
      if (!response.deleted || !isCurrentRequest()) return false;
      // 服务端已确认删除后先收敛本地快照；随后到达的 SSE 事件会按 seq 幂等覆盖。
      setCurrentThread((current) => current?.id === threadId
        ? {
            ...current,
            queuedTurnInputs: current.queuedTurnInputs?.filter((item) => item.id !== inputId),
          }
        : current);
      return true;
    } catch (unknownError) {
      if (isCurrentRequest()) setError(runtimeActionError(unknownError));
      return false;
    }
  }, [actionRequests, client, setCurrentThread, setError, threadId]);

  const reorderQueuedTurnInputs = useCallback(async (inputIds: string[]) => {
    if (!threadId) return false;
    const isCurrentRequest = actionRequests.begin();
    try {
      if (isCurrentRequest()) setError(null);
      await client.reorderQueuedTurnInputs(threadId, { inputIds });
      // The sequenced SSE event owns queue order, including changes made while this request ran.
      return isCurrentRequest();
    } catch (unknownError) {
      if (isCurrentRequest()) setError(runtimeActionError(unknownError));
      return false;
    }
  }, [actionRequests, client, setError, threadId]);

  const retrieveQueuedTurnInput = useCallback(async (inputId: string) => {
    if (!threadId) return null;
    const isCurrentRequest = actionRequests.begin();
    try {
      if (isCurrentRequest()) setError(null);
      const input = await client.retrieveQueuedTurnInput(threadId, inputId);
      if (isCurrentRequest()) {
        setCurrentThread((current) => current?.id === threadId
          ? { ...current, queuedTurnInputs: current.queuedTurnInputs?.filter((item) => item.id !== inputId) }
          : current);
      }
      // The caller keeps its originating draft callback, even after navigation.
      // Returning the taken input prevents a late response from discarding it.
      return input;
    } catch (unknownError) {
      if (isCurrentRequest()) setError(runtimeActionError(unknownError));
      return null;
    }
  }, [actionRequests, client, setCurrentThread, setError, threadId]);

  const sendQueuedTurnInputNow = useCallback(async (inputId: string) => {
    if (!threadId) return false;
    const isCurrentRequest = actionRequests.begin();
    try {
      if (isCurrentRequest()) setError(null);
      const response = await client.sendQueuedTurnInputNow(threadId, inputId);
      if (
        isCurrentRequest()
        && response.turnId
        && !terminalTurnIdsRef.current.has(response.turnId)
      ) {
        setActiveTurnId(response.turnId);
      }
      await reloadThreads();
      return isCurrentRequest();
    } catch (unknownError) {
      if (isCurrentRequest()) setError(runtimeActionError(unknownError));
      return false;
    }
  }, [actionRequests, client, reloadThreads, setActiveTurnId, setError, terminalTurnIdsRef, threadId]);

  return {
    deleteQueuedTurnInput,
    reorderQueuedTurnInputs,
    retrieveQueuedTurnInput,
    sendQueuedTurnInputNow,
  };
}

function runtimeActionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
