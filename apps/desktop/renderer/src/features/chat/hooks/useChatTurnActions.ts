import {
  isRuntimeInputMessageAttachment,
  type DesktopRuntimeClient,
  type RuntimeMessageAttachment,
  type RuntimeSkillReference,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useI18n } from '../../../shared/i18n/I18nProvider.js';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import { isRuntimeTransportFailure } from '../../../services/runtime-client/runtimeClientErrors.js';
import {
  createChatTurnClientId,
  reconcileChatTurnSubmission,
} from './chatTurnSubmission.js';
import { useQueuedTurnInputActions } from './useQueuedTurnInputActions.js';

type ChatTurnSendOptions = {
  attachments?: RuntimeMessageAttachment[];
  goalMode?: boolean;
  skillIds?: string[];
  skillReferences?: RuntimeSkillReference[];
  thinking?: boolean;
  thinkingEffort?: string;
};

export function useChatTurnActions({
  activeProjectId,
  activeTurnId,
  claimComposerForThread,
  client,
  composerKey,
  currentThread,
  draft,
  expandProject,
  reloadThreads,
  setActiveTurnId,
  setCurrentThread,
  setDraft,
  setError,
  terminalTurnIdsRef,
}: {
  activeProjectId: string | null;
  activeTurnId: string | null;
  claimComposerForThread: (threadId: string) => void;
  client: DesktopRuntimeClient;
  composerKey: string;
  currentThread: RuntimeThread | null;
  draft: string;
  expandProject?: (projectId: string) => void;
  reloadThreads: () => Promise<unknown>;
  setActiveTurnId: Dispatch<SetStateAction<string | null>>;
  setCurrentThread: Dispatch<SetStateAction<RuntimeThread | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  terminalTurnIdsRef: MutableRefObject<Set<string>>;
}) {
  const { t } = useI18n();
  const actionRequests = useIdentityRequestGuard(composerKey);
  const queuedTurnActions = useQueuedTurnInputActions({
    actionRequests,
    client,
    currentThread,
    reloadThreads,
    setActiveTurnId,
    setCurrentThread,
    setError,
    terminalTurnIdsRef,
  });
  const sendInput = useCallback(
    async (value?: string, options: ChatTurnSendOptions = {}) => {
      const input = (value ?? draft).trim();
      const attachments = (options.attachments ?? []).filter(isRuntimeInputMessageAttachment);
      if (!input && !attachments.length) return false;
      const isCurrentRequest = actionRequests.begin();
      const clientId = createChatTurnClientId();
      let submissionDispatched = false;
      let submissionThreadId: string | null = null;
      if (isCurrentRequest()) setError(null);
      try {
        let thread = currentThread;
        if (!thread) {
          // 首条消息事件会先投影出本地 fallback；runtime 随后用当前模型生成正式标题。
          thread = await client.createThread({ projectId: activeProjectId ?? undefined });
          claimCreatedChatThreadForSend({
            activeProjectId,
            claimComposerForThread,
            expandProject,
            isCurrentRequest,
            setCurrentThread,
            thread,
          });
          await reloadThreads();
        }
        const threadId = thread.id;
        submissionThreadId = threadId;
        if (isCurrentRequest()) setDraft('');
        const startTurn = () => client.sendTurn(threadId, {
          attachments,
          clientId,
          input,
          skillIds: options.skillIds,
          skillReferences: options.skillReferences,
          thinking: options.thinking === true,
          ...(options.thinking === true && options.thinkingEffort ? { thinkingEffort: options.thinkingEffort } : {}),
        });
        // Goal 无论线程当前是否空闲都先进入同一持久化入口；空闲时 runtime 会立刻
        // 原子消费并启动，忙碌时则保留完整附件、Skill 与 thinking 语义等待调度。
        submissionDispatched = true;
        const response = shouldQueueComposerTurn(activeTurnId, options)
          ? await client.queueTurnInput(threadId, {
              attachments,
              clientId,
              input,
              kind: options.goalMode
                ? 'goal'
                : 'message',
              skillIds: options.skillIds,
              skillReferences: options.skillReferences,
              thinking: options.thinking,
              thinkingEffort: options.thinkingEffort,
            })
          : await startTurn();
        if (isCurrentRequest() && response.turnId && !terminalTurnIdsRef.current.has(response.turnId)) {
          setActiveTurnId(response.turnId);
        }
        if (!isCurrentRequest()) void reloadThreads().catch(() => undefined);
        return true;
      } catch (unknownError) {
        if (
          isCurrentRequest()
          && submissionDispatched
          && submissionThreadId
          && isRuntimeTransportFailure(unknownError)
        ) {
          const reconciled = await reconcileChatTurnSubmission(
            client,
            submissionThreadId,
            clientId,
          );
          if (reconciled && isCurrentRequest()) {
            setCurrentThread((current) => (
              current?.id === reconciled.thread.id
              && current.lastSeq > reconciled.thread.lastSeq
                ? current
                : reconciled.thread
            ));
            const reconciledActiveTurnId = reconciled.thread.activeTurnId;
            if (
              reconciledActiveTurnId
              && !terminalTurnIdsRef.current.has(reconciledActiveTurnId)
            ) {
              setActiveTurnId(reconciledActiveTurnId);
            }
            setError(null);
            void reloadThreads().catch(() => undefined);
            return true;
          }
        }
        if (isCurrentRequest()) {
          setDraft((current) => current || input);
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        }
        return false;
      }
    },
    [actionRequests, activeProjectId, activeTurnId, claimComposerForThread, client, currentThread, draft, expandProject, reloadThreads, setActiveTurnId, setCurrentThread, setDraft, setError, terminalTurnIdsRef],
  );

  const cancelActiveTurn = useCallback(async () => {
    if (!currentThread || !activeTurnId) return;
    const turnId = activeTurnId;
    await client.cancelTurn(currentThread.id, turnId);
    terminalTurnIdsRef.current.add(turnId);
    setActiveTurnId((current) => (current === turnId ? null : current));
  }, [activeTurnId, client, currentThread, setActiveTurnId, terminalTurnIdsRef]);

  const deleteMessages = useCallback(
    async (messageIds: string[]) => {
      if (!currentThread || activeTurnId) return;
      const ids = [...new Set(messageIds.map((id) => id.trim()).filter(Boolean))];
      if (!ids.length) return;
      const isCurrentRequest = actionRequests.begin();
      try {
        setError(null);
        const updated = await client.deleteMessages(currentThread.id, { messageIds: ids });
        if (isCurrentRequest()) setCurrentThread(updated);
        await reloadThreads();
      } catch (unknownError) {
        const message = normalizeRuntimeActionError(unknownError, t('chat.action.deleteUnavailable'));
        if (!isCurrentRequest()) return;
        setError(message);
        throw new Error(message);
      }
    },
    [actionRequests, activeTurnId, client, currentThread, reloadThreads, setCurrentThread, setError, t],
  );

  const editUserMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!currentThread || activeTurnId) return;
      const nextContent = content.trim();
      if (!nextContent) {
        setError(t('chat.action.emptyMessage'));
        return;
      }
      const isCurrentRequest = actionRequests.begin();
      try {
        setError(null);
        const response = await client.regenerateFromMessage(currentThread.id, messageId, { content: nextContent });
        const updated = await client.getThread(currentThread.id);
        if (isCurrentRequest()) setCurrentThread(updated);
        await reloadThreads();
        if (isCurrentRequest() && !terminalTurnIdsRef.current.has(response.turnId)) {
          setActiveTurnId(response.turnId);
        }
      } catch (unknownError) {
        const message = normalizeRuntimeActionError(unknownError, t('chat.action.editUnavailable'));
        if (!isCurrentRequest()) return;
        setError(message);
        throw new Error(message);
      }
    },
    [actionRequests, activeTurnId, client, currentThread, reloadThreads, setActiveTurnId, setCurrentThread, setError, t, terminalTurnIdsRef],
  );

  return {
    cancelActiveTurn,
    deleteMessages,
    editUserMessage,
    ...queuedTurnActions,
    sendInput,
  };
}

export type ChatTurnActions = ReturnType<typeof useChatTurnActions>;

export function shouldQueueComposerTurn(
  activeTurnId: string | null,
  options: Pick<ChatTurnSendOptions, 'goalMode'>,
): boolean {
  return options.goalMode === true || Boolean(activeTurnId);
}

export function claimCreatedChatThreadForSend({
  activeProjectId,
  claimComposerForThread,
  expandProject,
  isCurrentRequest,
  setCurrentThread,
  thread,
}: {
  activeProjectId: string | null;
  claimComposerForThread: (threadId: string) => void;
  expandProject?: (projectId: string) => void;
  isCurrentRequest: () => boolean;
  setCurrentThread: Dispatch<SetStateAction<RuntimeThread | null>>;
  thread: RuntimeThread;
}): boolean {
  if (!isCurrentRequest()) return false;
  // Claim before exposing the runtime thread so a first-turn send does not
  // remount the composer and delete attachments that are about to be consumed.
  claimComposerForThread(thread.id);
  if (activeProjectId) expandProject?.(activeProjectId);
  setCurrentThread(thread);
  return true;
}

function normalizeRuntimeActionError(error: unknown, notFoundMessage: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return /\bnot found\b/i.test(message) ? notFoundMessage : message;
}
