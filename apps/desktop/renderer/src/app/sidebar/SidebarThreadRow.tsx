import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { Archive, LoaderCircle, Pencil } from 'lucide-react';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ActionTooltip } from '../../shared/ui/primitives.js';
import { SidebarFloatingMenu } from './SidebarFloatingMenu.js';

export function SidebarThreadRow({
  menuOpen,
  running = false,
  selected,
  thread,
  variant,
  onArchive,
  onRename,
  onSelect,
  onToggleMenu,
}: {
  menuOpen: boolean;
  running?: boolean;
  selected: boolean;
  thread: RuntimeThreadSummary;
  variant: 'global' | 'project';
  onArchive: (thread: RuntimeThreadSummary) => void;
  onRename: (thread: RuntimeThreadSummary) => void;
  onSelect: (threadId: string) => void;
  onToggleMenu: (threadId: string) => void;
}) {
  const { t } = useI18n();
  // 线程列表快照包含整个 runtime 的活动状态；在经过防抖的侧边栏快照尚未更新时，
  // 当前打开线程仍可回退使用显式属性。
  const isRunning = running || Boolean(thread.activeTurnId);
  const rowRef = useRef<HTMLDivElement | null>(null);
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
  const handleSelectKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openContextMenu(rect.left + 20, rect.top + 20);
      return;
    }
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect(thread.id);
  };
  const handleArchiveClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onArchive(thread);
  };
  const menu = (
    <SidebarFloatingMenu anchorPoint={menuAnchorPoint} open={menuOpen} triggerRef={rowRef} onClose={() => onToggleMenu(thread.id)}>
      <button type="button" role="menuitem" onClick={() => onRename(thread)}>
        <Pencil size={13} />
        <span>{t('sidebar.rename')}</span>
      </button>
    </SidebarFloatingMenu>
  );
  const className = ['desktop-agent-session', `desktop-agent-session--${variant}`, selected ? 'is-active' : '', isRunning ? 'is-running' : '']
    .filter(Boolean)
    .join(' ');
  const meta = (
    <span className="desktop-agent-session__meta">
      {isRunning ? (
        <span className="desktop-agent-session__running" aria-label={t('sidebar.chatRunning')} title={t('sidebar.chatRunning')}>
          <LoaderCircle className="is-spinning" size={13} />
        </span>
      ) : null}
      <ActionTooltip title={t('sidebar.archiveChat')}>
        <button
          className="desktop-agent-session__archive-button"
          type="button"
          aria-label={t('sidebar.archiveChat')}
          onClick={handleArchiveClick}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Archive size={14} />
        </button>
      </ActionTooltip>
    </span>
  );

  return (
    <div
      className={className}
      ref={rowRef}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(thread.id)}
      onContextMenu={handleContextMenu}
      onKeyDown={handleSelectKeyDown}
    >
      {/* 将原生标题限制在文本范围内，避免与归档操作提示框重叠。 */}
      <span className="desktop-agent-session__title" title={thread.title}>{thread.title}</span>
      {meta}
      {menu}
    </div>
  );
}
