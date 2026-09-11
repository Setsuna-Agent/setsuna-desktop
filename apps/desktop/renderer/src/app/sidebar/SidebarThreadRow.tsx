import { Button } from '@setsuna-desktop/renderer-ui';
import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { Archive, LoaderCircle, Pin } from 'lucide-react';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { EditIcon } from '../../shared/ui/EditIcon.js';
import { ActionTooltip } from '../../shared/ui/primitives.js';
import { SidebarFloatingMenu } from './SidebarFloatingMenu.js';
import { SidebarThreadHoverCard } from './SidebarThreadHoverCard.js';
import { SidebarThreadTitle } from './SidebarThreadTitle.js';

export function SidebarThreadRow({
  menuOpen,
  pinned = false,
  projectName,
  running = false,
  selected,
  thread,
  variant,
  onArchive,
  onRename,
  onSelect,
  onToggleMenu,
  onTogglePin,
}: {
  menuOpen: boolean;
  pinned?: boolean;
  projectName?: string;
  running?: boolean;
  selected: boolean;
  thread: RuntimeThreadSummary;
  variant: 'global' | 'project' | 'pinned';
  onArchive: (thread: RuntimeThreadSummary) => void;
  onRename: (thread: RuntimeThreadSummary) => void;
  onSelect: (threadId: string) => void;
  onToggleMenu: (threadId: string) => void;
  onTogglePin: (thread: RuntimeThreadSummary) => void;
}) {
  const { t } = useI18n();
  // 线程列表快照包含整个 runtime 的活动状态；在经过防抖的侧边栏快照尚未更新时，
  // 当前打开线程仍可回退使用显式属性。
  const isRunning = running || Boolean(thread.activeTurnId);
  const rowRef = useRef<HTMLButtonElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>();
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
  const menu = (
    <SidebarFloatingMenu anchorPoint={menuAnchorPoint} open={menuOpen} triggerRef={rowRef} onClose={() => onToggleMenu(thread.id)}>
      <Button variant="ghost" type="button" role="menuitem" onClick={() => onRename(thread)}>
        <EditIcon size={13} />
        <span>{t('sidebar.rename')}</span>
      </Button>
    </SidebarFloatingMenu>
  );
  const className = ['desktop-agent-session', `desktop-agent-session--${variant}`, selected ? 'is-active' : '', isRunning ? 'is-running' : '']
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
      {isRunning ? (
        <ActionTooltip title={t('sidebar.chatRunning')}>
          {/* 进行中的对话不允许归档，hover 时同样保持 loading 指示。 */}
          <span className="desktop-agent-session__running" aria-label={t('sidebar.chatRunning')} role="status">
            <LoaderCircle className="is-spinning" size={13} />
          </span>
        </ActionTooltip>
      ) : null}
      <ActionTooltip title={t('sidebar.archiveChat')}>
        <Button variant="ghost"
          className="desktop-agent-session__archive-button"
          type="button"
          aria-label={t('sidebar.archiveChat')}
          disabled={isRunning}
          onClick={handleArchiveClick}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Archive size={14} />
        </Button>
      </ActionTooltip>
    </span>
  );

  return (
    <div
      className={className}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <SidebarThreadHoverCard disabled={menuOpen} projectName={projectName} thread={thread}>
        <Button variant="ghost"
          className="desktop-agent-session__select"
          ref={rowRef}
          type="button"
          onClick={() => onSelect(thread.id)}
          onKeyDown={handleSelectKeyDown}
        >
          <SidebarThreadTitle hovered={hovered && !menuOpen} title={thread.title} />
        </Button>
      </SidebarThreadHoverCard>
      {meta}
      {menu}
    </div>
  );
}
