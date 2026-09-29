import type { DesktopRuntimeClient, ForkThreadInput, RuntimeThreadSummary, WorkspaceStatus } from '@setsuna-desktop/contracts';
import { useConfirm } from '@setsuna-desktop/renderer-ui';
import type { DesktopWorkspaceApp } from '@setsuna-desktop/feature-workspace-apps/contracts';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';

type MenuContext = {
  threadId: string;
  messageId?: string;
  canFork: boolean;
  workspace: WorkspaceStatus;
  apps: readonly DesktopWorkspaceApp[];
};

export function useThreadMenu({ client, threadId, onClose, onFork, onDelete, onError }: {
  client: DesktopRuntimeClient;
  threadId: string | null;
  onClose: () => void;
  onFork: (threadId: string, input: ForkThreadInput) => Promise<void>;
  onDelete: (thread: RuntimeThreadSummary) => Promise<void>;
  onError: (message: string) => unknown;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState<MenuContext | null>(null);
  const pending = useRef(new Set<string>());
  const pendingDeletions = useRef(new Set<string>());
  const [forkingIds, setForkingIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    if (!threadId) return;
    void (async () => {
      try {
        const [thread, workspace] = await Promise.all([
          client.getThread(threadId), client.getWorkspaceStatus({ threadId }),
        ]);
        if (cancelled) return;
        const boundary = thread.messages.at(-1);
        // The menu only retains the persisted fork boundary, not another copy of the transcript.
        const context: MenuContext = { threadId, messageId: boundary?.id, workspace, apps: [],
          canFork: Boolean(boundary && boundary.status !== 'streaming' && !thread.activeTurnId
            && thread.contextCompaction?.status !== 'running') };
        setLoaded(context);
        // Resolve the conversation's workspace, which may be a worktree or a temporary directory.
        const path = workspace.exists && workspace.readable ? workspace.project?.path : undefined;
        const apps = path ? await window.setsunaDesktop?.workspaceApps.list(path) ?? [] : [];
        if (!cancelled) setLoaded({ ...context, apps });
      } catch (error) {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, [client, onError, threadId]);

  const context = loaded?.threadId === threadId ? loaded : null;
  const canFork = Boolean(context?.canFork && threadId && !forkingIds.has(threadId));
  const canCreateWorktree = Boolean(context?.workspace.exists && context.workspace.readable && context.workspace.gitRoot);

  const fork = async (target: ForkThreadInput['target']) => {
    if (!context?.messageId || !canFork || (target === 'worktree' && !canCreateWorktree)) return;
    const id = context.threadId;
    if (pending.current.has(id)) return;
    // Keep this guard above the menu so closing/reopening it cannot start a duplicate fork.
    pending.current.add(id);
    setForkingIds(new Set(pending.current));
    try {
      await onFork(id, { messageId: context.messageId, target });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current.delete(id);
      setForkingIds(new Set(pending.current));
    }
  };

  const openWith = async (appId: string) => {
    const path = context?.workspace.project?.path;
    if (!path || !context?.apps.some((app) => app.id === appId)) return;
    try {
      const opened = await window.setsunaDesktop?.workspaceApps.open(path, appId);
      if (!opened) throw new Error(t('workspace.panels.appUnavailable'));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteThread = async (thread: RuntimeThreadSummary) => {
    if (thread.activeTurnId || pendingDeletions.current.has(thread.id)) return;
    pendingDeletions.current.add(thread.id);
    try {
      // The shared hook outlives the popup, so closing it cannot cancel the confirmation.
      if (!await confirm({
        title: t('sidebar.deleteChatTitle', { title: thread.title || t('settings.archives.untitled') }),
        description: t('settings.archives.irreversible'),
        confirmLabel: t('sidebar.deleteChat'),
        cancelLabel: t('common.cancel'),
        danger: true,
      })) return;
      await onDelete(thread);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      pendingDeletions.current.delete(thread.id);
    }
  };

  return { canFork, canCreateWorktree, apps: context?.apps ?? [], fork, openWith, deleteThread, close: onClose };
}

export type ThreadMenuState = ReturnType<typeof useThreadMenu>;
