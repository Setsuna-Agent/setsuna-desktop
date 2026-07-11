import { useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Archive, LoaderCircle, MoreHorizontal, Pencil } from 'lucide-react';
import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
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
  // Thread-list snapshots carry runtime-wide activity; the explicit prop remains a fallback
  // for the currently open thread while its debounced sidebar snapshot is catching up.
  const isRunning = running || Boolean(thread.activeTurnId);
  const menuTriggerRef = useRef<HTMLSpanElement | null>(null);
  const handleMenuClick = (event: ReactMouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    onToggleMenu(thread.id);
  };
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleMenu(thread.id);
    }
  };
  const stopMenuPointerEvent = (event: ReactMouseEvent<HTMLSpanElement> | ReactPointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
  };
  const handleSelectKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect(thread.id);
  };
  const menu = (
    <SidebarFloatingMenu open={menuOpen} triggerRef={menuTriggerRef} onClose={() => onToggleMenu(thread.id)}>
      <button type="button" role="menuitem" onClick={() => onRename(thread)}>
        <Pencil size={13} />
        <span>重命名</span>
      </button>
      <button type="button" role="menuitem" className="is-danger" onClick={() => onArchive(thread)}>
        <Archive size={13} />
        <span>归档</span>
      </button>
    </SidebarFloatingMenu>
  );
  const className = ['desktop-agent-session', `desktop-agent-session--${variant}`, selected ? 'is-active' : '', isRunning ? 'is-running' : '']
    .filter(Boolean)
    .join(' ');
  const meta = (
    <span className="desktop-agent-session__meta">
      {isRunning ? (
        <span className="desktop-agent-session__running" aria-label="对话进行中" title="对话进行中">
          <LoaderCircle className="is-spinning" size={13} />
        </span>
      ) : (
        <span>{formatRelativeDate(thread.updatedAt)}</span>
      )}
      <span
        className="desktop-agent-session__menu-button"
        ref={menuTriggerRef}
        role="button"
        tabIndex={0}
        aria-label="对话操作"
        aria-expanded={menuOpen}
        onClick={handleMenuClick}
        onMouseDown={stopMenuPointerEvent}
        onPointerDown={stopMenuPointerEvent}
        onKeyDown={handleMenuKeyDown}
      >
        <MoreHorizontal size={13} />
      </span>
    </span>
  );

  if (variant === 'project') {
    return (
      <div
        className={className}
        role="button"
        tabIndex={0}
        title={thread.title}
        onClick={() => onSelect(thread.id)}
        onKeyDown={handleSelectKeyDown}
      >
        <span className="desktop-agent-session__title">{thread.title}</span>
        {meta}
        {menu}
      </div>
    );
  }

  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      title={thread.title}
      onClick={() => onSelect(thread.id)}
      onKeyDown={handleSelectKeyDown}
    >
      <span className="desktop-agent-session__title">{thread.title}</span>
      {meta}
      {menu}
    </div>
  );
}

function formatRelativeDate(value?: string): string {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天`;
  return new Date(value).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}
