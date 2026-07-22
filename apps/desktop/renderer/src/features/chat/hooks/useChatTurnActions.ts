import {
  isRuntimeInputMessageAttachment,
  type DesktopRuntimeClient,
  type RuntimeCollaborationMode,
  type RuntimeInputMessageAttachment,
  type RuntimeMessageAttachment,
  type RuntimePlanDecision,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useI18n, type Translate } from '../../../shared/i18n/I18nProvider.js';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';

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
  const sendInput = useCallback(
    async (value?: string, options: { attachments?: RuntimeMessageAttachment[]; collaborationMode?: RuntimeCollaborationMode; goalMode?: boolean; planDecision?: RuntimePlanDecision; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string } = {}) => {
      const input = (value ?? draft).trim();
      const attachments = (options.attachments ?? []).filter(isRuntimeInputMessageAttachment);
      if (!input && !attachments.length && !options.planDecision) return false;
      // 计划决策只能针对已有线程里的 awaiting 计划，没有线程时无从裁决。
      if (options.planDecision && !currentThread) return false;
      const isCurrentRequest = actionRequests.begin();
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
        if (options.goalMode && input) {
          const goal = await client.setThreadGoal(threadId, { objective: input, status: 'active' });
          // 目标轮次由 setThreadGoal 内部启动。重新读取 runtime 任务注册表快照，避免遗漏或重叠的
          // SSE turn.started 事件导致输入框缺少停止操作。
          const goalThread = await client.getThread(threadId);
          if (isCurrentRequest()) {
            terminalTurnIdsRef.current.delete(goalThread.activeTurnId ?? '');
            setCurrentThread((current) => mergeGoalThreadSnapshot(current, goalThread, goal));
            if (goalThread.activeTurnId) setActiveTurnId(goalThread.activeTurnId);
            setDraft('');
          }
          await reloadThreads();
          // 目标执行由 runtime 管理：设置目标会调度首个隐藏目标轮次，之后每次空闲完成都会调度
          // 下一个轮次，直到目标进入终止状态。
          return true;
        }
        if (isCurrentRequest()) setDraft('');
        const startTurn = () => client.sendTurn(threadId, {
          attachments,
          input,
          skillIds: options.skillIds,
          thinking: options.thinking === true,
          ...(options.thinking === true && options.thinkingEffort ? { thinkingEffort: options.thinkingEffort } : {}),
          ...(options.collaborationMode ? { collaborationMode: options.collaborationMode } : {}),
          ...(options.planDecision ? { planDecision: options.planDecision } : {}),
        });
        const response = activeTurnId && !options.planDecision
          ? await steerActiveTurn({
              activeTurnId,
              attachments,
              client,
              input,
              skillIds: options.skillIds,
              thinking: options.thinking,
              thinkingEffort: options.thinkingEffort,
              threadId,
              t,
            })
          : await startTurn();
        if (isCurrentRequest() && !terminalTurnIdsRef.current.has(response.turnId)) {
          setActiveTurnId(response.turnId);
        }
        if (!isCurrentRequest()) void reloadThreads().catch(() => undefined);
        return true;
      } catch (unknownError) {
        if (isCurrentRequest()) {
          setDraft((current) => current || input);
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
        }
        return false;
      }
    },
    [actionRequests, activeProjectId, activeTurnId, claimComposerForThread, client, currentThread, draft, expandProject, reloadThreads, setActiveTurnId, setCurrentThread, setDraft, setError, t, terminalTurnIdsRef],
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

  return { cancelActiveTurn, deleteMessages, editUserMessage, sendInput };
}

export type ChatTurnActions = ReturnType<typeof useChatTurnActions>;

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

export function mergeGoalThreadSnapshot(
  current: RuntimeThread | null,
  snapshot: RuntimeThread,
  goal: NonNullable<RuntimeThread['goal']>,
): RuntimeThread {
  if (!current || current.id !== snapshot.id || snapshot.lastSeq >= current.lastSeq) {
    return { ...snapshot, goal: snapshot.goal ?? goal };
  }
  return {
    ...current,
    goal,
    activeTurnId: snapshot.activeTurnId ?? current.activeTurnId,
  };
}

async function steerActiveTurn({
  activeTurnId,
  attachments,
  client,
  input,
  skillIds,
  thinking,
  thinkingEffort,
  threadId,
  t,
}: {
  activeTurnId: string;
  attachments: RuntimeInputMessageAttachment[];
  client: DesktopRuntimeClient;
  input: string;
  skillIds?: string[];
  thinking?: boolean;
  thinkingEffort?: string;
  threadId: string;
  t: Translate;
}) {
  try {
    return await client.steerTurn(threadId, activeTurnId, {
      attachments,
      expectedTurnId: activeTurnId,
      input,
      skillIds,
      thinking,
      thinkingEffort,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryTurnId = steerMismatchTurnId(message);
    if (retryTurnId) {
      return client.steerTurn(threadId, retryTurnId, {
        attachments,
        expectedTurnId: retryTurnId,
        input,
        skillIds,
        thinking,
        thinkingEffort,
      });
    }
    if (isExpiredSteerError(message)) {
      throw new Error(t('chat.action.turnEnded'));
    }
    throw error;
  }
}

function steerMismatchTurnId(message: string): string | null {
  const match = message.match(/but found `([^`]+)`/);
  return match?.[1] ?? null;
}

function isExpiredSteerError(message: string): boolean {
  return /no active turn to steer|active turn is finishing/i.test(message);
}
