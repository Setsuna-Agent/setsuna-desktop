import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import type { MenuItem } from '@setsuna-desktop/renderer-ui';
import { AppWindow, Archive, GitFork, Pin, PinOff, Split, Trash2 } from 'lucide-react';
import { workspaceOpenWithMenu } from '../../composition/workspace-apps-feature-adapter.js';
import type { Translate } from '../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../shared/ui/EditIcon.js';
import type { ThreadMenuState } from './useThreadMenu.js';

export type ThreadMenuOptions = {
  thread: RuntimeThreadSummary | null;
  pinned: boolean;
  running: boolean;
  actions: ThreadMenuState;
  onRename: (thread: RuntimeThreadSummary) => void;
  onTogglePin: (thread: RuntimeThreadSummary) => void;
  onArchive: (thread: RuntimeThreadSummary) => void;
  onOpenInNewWindow: (threadId: string) => void;
};

/** Toolbar and sidebar actions share ordering, availability and submenu contents. */
export function threadMenuItems({ thread, pinned, running, actions, onRename, onTogglePin, onArchive, onOpenInNewWindow }: ThreadMenuOptions, t: Translate): MenuItem[] {
  return [
    { key: 'rename', label: t('sidebar.rename'), icon: <EditIcon size={14} />, disabled: !thread,
      onClick: () => { if (thread) onRename(thread); } },
    { key: 'pin', label: t(pinned ? 'sidebar.unpinChat' : 'sidebar.pinChat'), disabled: !thread,
      icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
      onClick: () => { if (thread) onTogglePin(thread); } },
    { key: 'archive', label: t('sidebar.archiveChat'), icon: <Archive size={14} />, disabled: !thread || running,
      onClick: () => { if (thread) onArchive(thread); } },
    { key: 'delete', label: t('sidebar.deleteChat'), icon: <Trash2 size={14} />, danger: true, disabled: !thread || running,
      onClick: () => { if (thread) void actions.deleteThread(thread); } },
    { key: 'fork-divider', type: 'divider' },
    { key: 'fork', label: t('sidebar.fork'), icon: <GitFork size={14} />, disabled: !thread || running || !actions.canFork, children: [
      { key: 'fork-workspace', label: t('chat.fork.workspace'), icon: <Split size={14} />,
        onClick: () => { void actions.fork('workspace'); } },
      { key: 'fork-worktree', label: t('chat.fork.worktree'), icon: <Split size={14} />,
        disabled: !actions.canCreateWorktree, tooltip: !actions.canCreateWorktree ? t('chat.fork.requiresGit') : undefined,
        onClick: () => { void actions.fork('worktree'); } },
    ] },
    { key: 'open-divider', type: 'divider' },
    workspaceOpenWithMenu({ label: t('workspace.fileMenu.openWith'), apps: actions.apps,
      onOpen: (appId) => { void actions.openWith(appId); } }),
    { key: 'new-window', label: t('sidebar.openInNewWindow'), icon: <AppWindow size={14} />, disabled: !thread,
      onClick: () => { if (thread) onOpenInNewWindow(thread.id); } },
  ];
}
