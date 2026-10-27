import { Button } from '@setsuna-desktop/renderer-ui';
import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { Archive, ArrowDown, ArrowUp, LoaderCircle, MessageCircleQuestion, Pin, ShieldQuestion } from 'lucide-react';
import { useContext, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ActionTooltip } from '../../shared/ui/primitives.js';
import { SidebarThreadMenu } from './SidebarThreadMenu.js';
import { SidebarMenuOpenContext } from './SidebarMenuContext.js';
import type { ThreadMenuState } from '../thread-menu/useThreadMenu.js';
import { SidebarThreadHoverCard } from './SidebarThreadHoverCard.js';
import { SidebarThreadTitle } from './SidebarThreadTitle.js';
import { SidebarThreadWorktreeBadge } from './SidebarThreadWorktreeBadge.js';
import { SidebarThreadAutomationBadge } from './SidebarThreadAutomationBadge.js';
import { useSidebarThreadDrag } from './useSidebarThreadDrag.js';
import { PullRequestsFeatureThreadBadge } from '../../composition/PullRequestsFeatureBoundary.js';

export function SidebarThreadRow({
  menuOpen,
  threadMenu,
  pinned = false,
  project,
  running = false,
  selected,
  thread,
  variant,
  onArchive,
  onOpenInNewWindow,
  onRename,
  onSelect,
  onToggleMenu,
  onTogglePin,
}: {
  menuOpen: boolean;
  threadMenu: ThreadMenuState;
  pinned?: boolean;
  project?: WorkspaceProject;
  running?: boolean;
  selected: boolean;
  thread: RuntimeThreadSummary;
  variant: 'global' | 'project' | 'pinned';
  onArchive: (thread: RuntimeThreadSummary) => void;
  onOpenInNewWindow: (threadId: string) => void;
  onRename: (thread: RuntimeThreadSummary) => void;
  onSelect: (threadId: string) => void;
  onToggleMenu: (threadId: string) => void;
  onTogglePin: (thread: RuntimeThreadSummary) => void;
}) {
  const { t } = useI18n();
  const threadDrag = useSidebarThreadDrag(thread);
  const sidebarMenuOpen = useContext(SidebarMenuOpenContext);
  const hoverDisabled = sidebarMenuOpen || menuOpen || threadDrag.dragging;
  // 线程列表快照包含整个 runtime 的活动状态；在经过防抖的侧边栏快照尚未更新时，
  // 当前打开线程仍可回退使用显式属性。
  const isRunning = running || Boolean(thread.activeTurnId);
  const activityState = thread.activeTurnId ? thread.activeTurnState : null;
  const activityLabel = t(activityState === 'waiting_for_input' ? 'sidebar.chatWaitingForInput'
    : activityState === 'waiting_for_approval' ? 'sidebar.chatWaitingForApproval' : 'sidebar.chatRunning');
  const [hovered, setHovered] = useState(false);
  const [menuAnchorPoint, setMenuAnchorPoint] = useState({ x: 0, y: 0 });
  const openContextMenu = (x: number, y: number) => {
    setMenuAnchorPoint({ x, y });
    if (!menuOpen) onToggleMenu(thread.id);
  };
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.clientX, event.clientY);
  };
  const handleSelectKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openContextMenu(rect.left + 20, rect.top + 20);
    }
  };
  const handleArchiveClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onArchive(thread);
  };
  const className = [
    'desktop-agent-session',
    `desktop-agent-session--${variant}`,
    selected ? 'is-active' : '',
    isRunning ? 'is-running' : '',
    menuOpen ? 'is-menu-open' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const meta = (
    <span className="desktop-agent-session__meta">
      <ActionTooltip title={t(pinned ? 'sidebar.unpinChat' : 'sidebar.pinChat')}>
        <Button variant="ghost"
          className="desktop-agent-session__pin-button"
          type="button"
          aria-label={t(pinned ? 'sidebar.unpinChat' : 'sidebar.pinChat')}
          aria-pressed={pinned}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin(thread);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Pin className="desktop-agent-session__pin-icon" size={14} strokeWidth={1.5} fill={pinned ? 'currentColor' : 'none'} />
        </Button>
      </ActionTooltip>
      {/* 运行状态与归档操作共用同一位置，进行中不挂载归档按钮。 */}
      {isRunning ? (
        <ActionTooltip title={activityLabel}>
          <span className="desktop-agent-session__running" aria-label={activityLabel} role="status">
            {activityState === 'waiting_for_input' ? <MessageCircleQuestion size={13} />
              : activityState === 'waiting_for_approval' ? <ShieldQuestion size={13} />
                : <LoaderCircle className="is-spinning" size={13} />}
          </span>
        </ActionTooltip>
      ) : (
        <ActionTooltip title={t('sidebar.archiveChat')}>
          <Button variant="ghost"
            className="desktop-agent-session__archive-button"
            type="button"
            aria-label={t('sidebar.archiveChat')}
            onClick={handleArchiveClick}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Archive size={14} />
          </Button>
        </ActionTooltip>
      )}
    </span>
  );

  return (
    <div
      className={className}
      data-dragging={threadDrag.dragging || undefined}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(!hoverDisabled)}
      onMouseLeave={() => setHovered(false)}
    >
      <SidebarThreadHoverCard disabled={menuOpen || threadDrag.dragging} project={project} thread={thread}>
        <Button variant="ghost"
          className="desktop-agent-session__select"
          data-sidebar-thread-id={thread.id}
          type="button"
          draggable
          onDragStart={(event) => {
            setHovered(false);
            threadDrag.onDragStart(event);
          }}
          onDragEnd={threadDrag.onDragEnd}
          onClick={() => onSelect(thread.id)}
          onKeyDown={handleSelectKeyDown}
        >
          <SidebarThreadTitle hovered={hovered && !hoverDisabled} title={thread.title} />
          <SidebarThreadWorktreeBadge thread={thread} />
          <SidebarThreadAutomationBadge thread={thread} />
        </Button>
      </SidebarThreadHoverCard>
      <PullRequestsFeatureThreadBadge threadId={thread.id} />
      {meta}
      {selected ? (
        <span className="desktop-agent-session__navigation-hint" aria-hidden="true">
          <ArrowUp size={14} strokeWidth={1.75} />
          <ArrowDown size={14} strokeWidth={1.75} />
        </span>
      ) : null}
      {menuOpen ? <SidebarThreadMenu anchor={menuAnchorPoint} thread={thread} pinned={pinned} running={isRunning}
        actions={threadMenu} onRename={onRename} onTogglePin={onTogglePin} onArchive={onArchive} onOpenInNewWindow={onOpenInNewWindow} /> : null}
    </div>
  );
}
