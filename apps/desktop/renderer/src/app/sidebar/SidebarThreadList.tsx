import type { RuntimeThreadSummary } from '@setsuna-desktop/contracts';
import { useEffect, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SidebarThreadRow } from './SidebarThreadRow.js';

const PROJECT_CONVERSATION_BATCH_SIZE = 5;
const GLOBAL_CONVERSATION_BATCH_SIZE = 20;

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
  const batchSize = variant === 'project'
    ? PROJECT_CONVERSATION_BATCH_SIZE
    : GLOBAL_CONVERSATION_BATCH_SIZE;
  const [visibleCount, setVisibleCount] = useState(batchSize);
  useEffect(() => {
    setVisibleCount(batchSize);
  }, [batchSize]);
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
          aria-label={t('sidebar.showMoreLabel', { count: Math.min(batchSize, remainingCount) })}
          onClick={() => setVisibleCount((current) => Math.min(current + batchSize, threads.length))}
        >
          {t('sidebar.showMore')}
        </button>
      ) : null}
    </div>
  );
}
