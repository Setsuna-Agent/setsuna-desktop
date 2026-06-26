import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { DesktopRuntimeClient, RuntimeMessageAttachment, RuntimeThread } from '@setsuna-desktop/contracts';
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
    async (value?: string, options: { attachments?: RuntimeMessageAttachment[]; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string } = {}) => {
      if (activeTurnId) return;
      const input = (value ?? draft).trim();
      const attachments = options.attachments ?? [];
      if (!input && !attachments.length) return;
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
        setDraft('');
        const response = await client.sendTurn(thread.id, {
          attachments,
          input,
          skillIds: options.skillIds,
          thinking: options.thinking === true,
          ...(options.thinking === true && options.thinkingEffort ? { thinkingEffort: options.thinkingEffort } : {}),
        });
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
    setActiveTurnId((current) => (current === turnId ? null : current));
  }, [activeTurnId, client, currentThread, setActiveTurnId]);

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
