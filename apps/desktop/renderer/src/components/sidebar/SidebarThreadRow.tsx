import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Archive, LoaderCircle, Pencil } from 'lucide-react';
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
        <span>重命名</span>
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
      ) : null}
      <button
        className="desktop-agent-session__archive-button"
        type="button"
        aria-label="归档对话"
        title="归档对话"
        onClick={handleArchiveClick}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Archive size={13} />
      </button>
    </span>
  );

  return (
    <div
      className={className}
      ref={rowRef}
      role="button"
      tabIndex={0}
      title={thread.title}
      onClick={() => onSelect(thread.id)}
      onContextMenu={handleContextMenu}
      onKeyDown={handleSelectKeyDown}
    >
      <span className="desktop-agent-session__title">{thread.title}</span>
      {meta}
      {menu}
    </div>
  );
}
