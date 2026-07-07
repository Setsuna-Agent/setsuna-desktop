import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { DesktopRuntimeClient, RuntimeCollaborationMode, RuntimeMessageAttachment, RuntimePlanDecision, RuntimeThread } from '@setsuna-desktop/contracts';
import type { MainView } from '../types/app.js';

export function useChatTurnActions({
  activeProjectId,
  activeTurnId,
  client,
  currentThread,
  draft,
  expandProject,
  reloadThreads,
  setActiveTurnId,
  setActiveView,
  setCurrentThread,
  setDraft,
  setError,
  terminalTurnIdsRef,
}: {
  activeProjectId: string | null;
  activeTurnId: string | null;
  client: DesktopRuntimeClient;
  currentThread: RuntimeThread | null;
  draft: string;
  expandProject: (projectId: string) => void;
  reloadThreads: () => Promise<unknown>;
  setActiveTurnId: Dispatch<SetStateAction<string | null>>;
  setActiveView: Dispatch<SetStateAction<MainView>>;
  setCurrentThread: Dispatch<SetStateAction<RuntimeThread | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  terminalTurnIdsRef: MutableRefObject<Set<string>>;
}) {
  const sendInput = useCallback(
    async (value?: string, options: { attachments?: RuntimeMessageAttachment[]; collaborationMode?: RuntimeCollaborationMode; planDecision?: RuntimePlanDecision; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string } = {}) => {
      const input = (value ?? draft).trim();
      const attachments = options.attachments ?? [];
      if (!input && !attachments.length && !options.planDecision) return;
      // 计划决策只能针对已有线程里的 awaiting 计划，没有线程时无从裁决。
      if (options.planDecision && !currentThread) return;
      try {
        let thread = currentThread;
        if (!thread) {
          thread = await client.createThread({ title: (input || '图片对话').slice(0, 48), projectId: activeProjectId ?? undefined });
          if (activeProjectId) {
            expandProject(activeProjectId);
          }
          setCurrentThread(thread);
          await reloadThreads();
        }
        const threadId = thread.id;
        setDraft('');
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
              threadId,
            })
          : await startTurn();
        if (!terminalTurnIdsRef.current.has(response.turnId)) setActiveTurnId(response.turnId);
      } catch (unknownError) {
        setDraft((current) => current || input);
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    },
    [activeProjectId, activeTurnId, client, currentThread, draft, expandProject, reloadThreads, setActiveTurnId, setCurrentThread, setDraft, setError, terminalTurnIdsRef],
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
      try {
        setError(null);
        const updated = await client.deleteMessages(currentThread.id, { messageIds: ids });
        setCurrentThread(updated);
        await reloadThreads();
      } catch (unknownError) {
        const message = normalizeRuntimeActionError(unknownError, '删除消息失败：当前运行时还没有加载消息删除接口，请重启 Electron 窗口后再试。');
        setError(message);
        throw new Error(message);
      }
    },
    [activeTurnId, client, currentThread, reloadThreads, setCurrentThread, setError],
  );

  const editUserMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!currentThread || activeTurnId) return;
      const nextContent = content.trim();
      if (!nextContent) {
        setError('消息内容不能为空');
        return;
      }
      try {
        setError(null);
        const response = await client.regenerateFromMessage(currentThread.id, messageId, { content: nextContent });
        const updated = await client.getThread(currentThread.id);
        setCurrentThread(updated);
        await reloadThreads();
        if (!terminalTurnIdsRef.current.has(response.turnId)) setActiveTurnId(response.turnId);
      } catch (unknownError) {
        const message = normalizeRuntimeActionError(unknownError, '编辑消息失败：当前运行时还没有加载编辑重跑接口，请重启 Electron 窗口后再试。');
        setError(message);
        throw new Error(message);
      }
    },
    [activeTurnId, client, currentThread, reloadThreads, setActiveTurnId, setCurrentThread, setError, terminalTurnIdsRef],
  );

  const addFileToConversation = useCallback(
    (filePath: string) => {
      const mention = `@${filePath}`;
      setActiveView('chat');
      setDraft((current) => {
        const trimmed = current.trimEnd();
        if (trimmed.includes(mention)) return current;
        return `${trimmed}${trimmed ? '\n' : ''}${mention} `;
      });
    },
    [setActiveView, setDraft],
  );

  return { addFileToConversation, cancelActiveTurn, deleteMessages, editUserMessage, sendInput };
}

export type ChatTurnActions = ReturnType<typeof useChatTurnActions>;

function normalizeRuntimeActionError(error: unknown, notFoundMessage: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return /\bnot found\b/i.test(message) ? notFoundMessage : message;
}

async function steerActiveTurn({
  activeTurnId,
  attachments,
  client,
  input,
  threadId,
}: {
  activeTurnId: string;
  attachments: RuntimeMessageAttachment[];
  client: DesktopRuntimeClient;
  input: string;
  threadId: string;
}) {
  try {
    return await client.steerTurn(threadId, activeTurnId, {
      attachments,
      expectedTurnId: activeTurnId,
      input,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryTurnId = steerMismatchTurnId(message);
    if (retryTurnId) {
      return client.steerTurn(threadId, retryTurnId, {
        attachments,
        expectedTurnId: retryTurnId,
        input,
      });
    }
    if (isExpiredSteerError(message)) {
      throw new Error('当前对话已经结束，未插入引导。请重新发送这条消息。');
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
