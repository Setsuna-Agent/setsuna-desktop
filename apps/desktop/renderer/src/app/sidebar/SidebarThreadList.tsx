import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SidebarThreadRow } from './SidebarThreadRow.js';

const SIDEBAR_CONVERSATION_BATCH_SIZE = 20;

export function minimumSidebarVisibleCount<T extends { id: string }>(
  items: T[],
  batchSize: number,
  pinnedIds: Array<string | null | undefined>,
): number {
  return pinnedIds.reduce((minimum, id) => {
    if (!id) return minimum;
    const index = items.findIndex((item) => item.id === id);
    return index < 0 ? minimum : Math.max(minimum, index + 1);
  }, batchSize);
}

export function SidebarThreadList({
  menuThreadId,
  runningThreadId,
  selectedThreadId,
  threads,
  variant,
  onArchive,
  onRename,
  onSelect,
  onToggleMenu,
}: {
  menuThreadId: string | null;
  runningThreadId?: string | null;
  selectedThreadId?: string | null;
  threads: RuntimeThreadSummary[];
  variant: 'global' | 'project';
  onArchive: (thread: RuntimeThreadSummary) => void;
  onRename: (thread: RuntimeThreadSummary) => void;
  onSelect: (threadId: string) => void;
  onToggleMenu: (threadId: string) => void;
}) {
  const { t } = useI18n();
  const minimumVisibleCount = minimumSidebarVisibleCount(
    threads,
    SIDEBAR_CONVERSATION_BATCH_SIZE,
    [selectedThreadId, runningThreadId],
  );
  const [expandedVisibleCount, setExpandedVisibleCount] = useState(SIDEBAR_CONVERSATION_BATCH_SIZE);
  const visibleCount = Math.max(expandedVisibleCount, minimumVisibleCount);
  const visibleThreads = threads.slice(0, visibleCount);
  const remainingCount = threads.length - visibleThreads.length;

  return (
    <div className={variant === 'project' ? 'desktop-agent-session-list' : 'app-sidebar__list'}>
      {visibleThreads.map((thread) => (
        <SidebarThreadRow
          key={thread.id}
          menuOpen={menuThreadId === thread.id}
          running={runningThreadId === thread.id}
          selected={selectedThreadId === thread.id}
          thread={thread}
          variant={variant}
          onArchive={onArchive}
          onRename={onRename}
          onSelect={onSelect}
          onToggleMenu={onToggleMenu}
        />
      ))}
      {remainingCount > 0 ? (
        <button
          className="desktop-agent-thread-list__show-more"
          type="button"
          aria-label={t('sidebar.showMoreLabel', { count: Math.min(SIDEBAR_CONVERSATION_BATCH_SIZE, remainingCount) })}
          onClick={() => setExpandedVisibleCount((current) => Math.min(current + SIDEBAR_CONVERSATION_BATCH_SIZE, threads.length))}
        >
          {t('sidebar.showMore')}
        </button>
      ) : null}
    </div>
  );
}
