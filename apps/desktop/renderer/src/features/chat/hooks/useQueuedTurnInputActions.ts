import type {
  DesktopRuntimeClient,
  QueuedTurnInputEditSession,
  RuntimeInputMessageAttachment,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { IdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';

export type ChatQueuedTurnActions = {
  deleteQueuedTurnInput: (inputId: string) => Promise<boolean>;
  releaseQueuedTurnInputEdit: (
    session: ChatQueuedTurnEditSession,
    options?: { silent?: boolean },
  ) => Promise<boolean>;
  retrieveQueuedTurnInput: (inputId: string) => Promise<ChatQueuedTurnEditSession | null>;
  sendQueuedTurnInputNow: (inputId: string) => Promise<boolean>;
  updateQueuedTurnInput: (
    session: ChatQueuedTurnEditSession,
    input: string,
    attachments: RuntimeInputMessageAttachment[],
  ) => Promise<ChatQueuedTurnUpdateResult>;
};

export type ChatQueuedTurnEditSession = QueuedTurnInputEditSession & {
  threadId: string;
};

export type ChatQueuedTurnUpdateResult = 'released-after-error' | 'retained-after-error' | 'updated';

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
  const releaseSessionWithoutUi = useCallback(async (session: ChatQueuedTurnEditSession) => {
    try {
      await client.releaseQueuedTurnInputEdit(
        session.threadId,
        session.input.id,
        { editToken: session.editToken },
      );
      return true;
    } catch {
      return false;
    }
  }, [client]);

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

  const retrieveQueuedTurnInput = useCallback(async (inputId: string) => {
    if (!threadId) return null;
    const isCurrentRequest = actionRequests.begin();
    try {
      if (isCurrentRequest()) setError(null);
      const session = await client.retrieveQueuedTurnInput(threadId, inputId);
      const ownedSession = { ...session, threadId };
      if (isCurrentRequest()) return ownedSession;

      // 页面切换或其他操作让响应过期时，立即释放刚创建的服务端编辑会话。
      await releaseSessionWithoutUi(ownedSession);
      return null;
    } catch (unknownError) {
      if (isCurrentRequest()) setError(runtimeActionError(unknownError));
      return null;
    }
  }, [actionRequests, client, releaseSessionWithoutUi, setError, threadId]);

  const releaseQueuedTurnInputEdit = useCallback(async (
    session: ChatQueuedTurnEditSession,
    options: { silent?: boolean } = {},
  ) => {
    if (options.silent) return releaseSessionWithoutUi(session);
    const isCurrentRequest = actionRequests.begin();
    try {
      if (isCurrentRequest()) setError(null);
      const response = await client.releaseQueuedTurnInputEdit(
        session.threadId,
        session.input.id,
        { editToken: session.editToken },
      );
      if (
        isCurrentRequest()
        && response.resumed?.turnId
        && !terminalTurnIdsRef.current.has(response.resumed.turnId)
      ) {
        setActiveTurnId(response.resumed.turnId);
      }
      await reloadThreads();
      // released=false 表示该令牌已提交、已释放或已被新会话替代，旧 UI 同样可以安全退出。
      return true;
    } catch (unknownError) {
      if (isCurrentRequest()) setError(runtimeActionError(unknownError));
      return false;
    }
  }, [
    actionRequests,
    client,
    reloadThreads,
    releaseSessionWithoutUi,
    setActiveTurnId,
    setError,
    terminalTurnIdsRef,
  ]);

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

  const updateQueuedTurnInput = useCallback(async (
    session: ChatQueuedTurnEditSession,
    input: string,
    attachments: RuntimeInputMessageAttachment[],
  ): Promise<ChatQueuedTurnUpdateResult> => {
    const isCurrentRequest = actionRequests.begin();
    try {
      if (isCurrentRequest()) setError(null);
      const response = await client.updateQueuedTurnInput(
        session.threadId,
        session.input.id,
        {
          attachments,
          editToken: session.editToken,
          input,
        },
      );
      if (
        isCurrentRequest()
        && response.turnId
        && !terminalTurnIdsRef.current.has(response.turnId)
      ) {
        setActiveTurnId(response.turnId);
      }
      if (isCurrentRequest()) {
        setCurrentThread((current) => {
          if (current?.id !== session.threadId) return current;
          const queuedTurnInputs = response.disposition === 'started'
            ? current.queuedTurnInputs?.filter((item) => item.id !== session.input.id)
            : current.queuedTurnInputs?.map((item) => (
                item.id === session.input.id
                  ? {
                      ...item,
                      attachments: attachments.map((attachment) => ({ ...attachment })),
                      input: input.trim(),
                    }
                  : item
              ));
          return { ...current, queuedTurnInputs };
        });
      }
      await reloadThreads();
      return 'updated';
    } catch (unknownError) {
      if (isCurrentRequest()) setError(runtimeActionError(unknownError));
      // 更新失败时主动释放；若 release 也失败则保留编辑 UI，允许用户重试。
      const released = await releaseSessionWithoutUi(session);
      if (released) await reloadThreads().catch(() => undefined);
      return released ? 'released-after-error' : 'retained-after-error';
    }
  }, [
    actionRequests,
    client,
    reloadThreads,
    releaseSessionWithoutUi,
    setActiveTurnId,
    setCurrentThread,
    setError,
    terminalTurnIdsRef,
  ]);

  return {
    deleteQueuedTurnInput,
    releaseQueuedTurnInputEdit,
    retrieveQueuedTurnInput,
    sendQueuedTurnInputNow,
    updateQueuedTurnInput,
  };
}

function runtimeActionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
