import type { ThreadMenuState } from '../thread-menu/useThreadMenu.js';
import { Button } from '@setsuna-desktop/renderer-ui';
import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { useMemo, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SidebarThreadRow } from './SidebarThreadRow.js';
import { useSidebarOrder } from './SidebarOrderProvider.js';
import { useSidebarReorder } from './useSidebarReorder.js';

const PROJECT_CONVERSATION_BATCH_SIZE = 5;
const GLOBAL_CONVERSATION_BATCH_SIZE = 20;

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

export function nextSidebarVisibleCount(
  expandedVisibleCount: number,
  minimumVisibleCount: number,
  batchSize: number,
  totalCount: number,
): number {
  return Math.min(Math.max(expandedVisibleCount, minimumVisibleCount) + batchSize, totalCount);
}

export function SidebarThreadList({
  menuThreadId,
  project,
  projectsById,
  runningThreadId,
  selectedThreadId,
  threads,
  variant,
  onArchive,
  threadMenu,
  onOpenInNewWindow,
  onRename,
  onSelect,
  onToggleMenu,
  onTogglePin,
}: {
  menuThreadId: string | null;
  project?: WorkspaceProject;
  projectsById?: ReadonlyMap<string, WorkspaceProject>;
  runningThreadId?: string | null;
  selectedThreadId?: string | null;
  threads: RuntimeThreadSummary[];
  variant: 'global' | 'project' | 'pinned';
  onArchive: (thread: RuntimeThreadSummary) => void;
  threadMenu: ThreadMenuState;
  onOpenInNewWindow: (threadId: string) => void;
  onRename: (thread: RuntimeThreadSummary) => void;
  onSelect: (threadId: string) => void;
  onToggleMenu: (threadId: string) => void;
  onTogglePin: (thread: RuntimeThreadSummary) => void;
}) {
  const { t } = useI18n();
  const batchSize = variant === 'project'
    ? PROJECT_CONVERSATION_BATCH_SIZE
    : GLOBAL_CONVERSATION_BATCH_SIZE;
  // Creation time remains the default until this group is manually reordered.
  const defaultThreads = useMemo(() => variant === 'pinned'
    ? threads
    : [...threads].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [threads, variant]);
  const scope = variant === 'project' ? `threads:project:${project?.id ?? ''}` : `threads:${variant}`;
  const order = useSidebarOrder(scope, defaultThreads);
  const orderedThreads = order.items;
  const reorder = useSidebarReorder(orderedThreads.map((thread) => thread.id), order.move);
  const minimumVisibleCount = minimumSidebarVisibleCount(
    orderedThreads,
    batchSize,
    [selectedThreadId, runningThreadId],
  );
  const [expansion, setExpansion] = useState({ variant, visibleCount: batchSize });
  const expandedVisibleCount = expansion.variant === variant ? expansion.visibleCount : batchSize;
  const visibleCount = Math.max(expandedVisibleCount, minimumVisibleCount);
  const visibleThreads = orderedThreads.slice(0, visibleCount);
  const remainingCount = orderedThreads.length - visibleThreads.length;

  return (
    <div ref={reorder.rootRef} className={`sidebar-reorder-list ${variant === 'project' ? 'desktop-agent-session-list' : 'app-sidebar__list'}`}>
      {visibleThreads.map((thread) => (
        <SidebarThreadRow
          key={thread.id}
          menuOpen={menuThreadId === thread.id}
          project={project ?? (thread.projectId ? projectsById?.get(thread.projectId) : undefined)}
          pinned={variant === 'pinned'}
          running={runningThreadId === thread.id}
          selected={selectedThreadId === thread.id}
          thread={thread}
          reorder={reorder}
          variant={variant}
          onArchive={onArchive}
          threadMenu={threadMenu}
          onOpenInNewWindow={onOpenInNewWindow}
          onRename={onRename}
          onSelect={onSelect}
          onToggleMenu={onToggleMenu}
          onTogglePin={onTogglePin}
        />
      ))}
      {remainingCount > 0 ? (
        <Button variant="ghost"
          className="desktop-agent-thread-list__show-more"
          type="button"
          aria-label={t('sidebar.showMoreLabel', { count: Math.min(batchSize, remainingCount) })}
          onClick={() => setExpansion((current) => ({
            variant,
            visibleCount: nextSidebarVisibleCount(
              current.variant === variant ? current.visibleCount : batchSize,
              minimumVisibleCount,
              batchSize,
              threads.length,
            ),
          }))}
        >
          {t('sidebar.showMore')}
        </Button>
      ) : null}
    </div>
  );
}
