import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button, useListChangeLayout } from '@setsuna-desktop/renderer-ui';
import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { SidebarCollapsibleContent } from './SidebarCollapsibleContent.js';
import { SidebarProjectRow, type SidebarProjectListProps } from './SidebarProjectList.js';
import { SidebarThreadRow } from './SidebarThreadRow.js';
import { minimumSidebarVisibleCount, nextSidebarVisibleCount } from './SidebarThreadList.js';
import { useSidebarOrder } from './SidebarOrderProvider.js';
import { useSidebarReorder } from './useSidebarReorder.js';

type PinnedItem = { id: string } & (
  | { kind: 'thread'; thread: RuntimeThreadSummary }
  | { kind: 'project'; project: WorkspaceProject }
);
const BATCH_SIZE = 20;

export function PinnedSection({ projects, pinnedProjects, threads, projectListProps }: {
  projects: WorkspaceProject[];
  pinnedProjects: WorkspaceProject[];
  threads: RuntimeThreadSummary[];
  projectListProps: Omit<SidebarProjectListProps, 'projects'>;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedCount, setExpandedCount] = useState(BATCH_SIZE);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  // Keep the existing pinned-chat order until the user saves a mixed order.
  const previousThreadOrder = useSidebarOrder('threads:pinned', threads);
  const items = useMemo<PinnedItem[]>(() => [
    ...previousThreadOrder.items.map((thread): PinnedItem => ({ id: `thread:${thread.id}`, kind: 'thread', thread })),
    ...pinnedProjects.map((project): PinnedItem => ({ id: `project:${project.id}`, kind: 'project', project })),
  ], [previousThreadOrder.items, pinnedProjects]);
  const order = useSidebarOrder('pinned', items);
  const reorder = useSidebarReorder(order.items.map((item) => item.id), order.move);
  const minimumCount = minimumSidebarVisibleCount(order.items, BATCH_SIZE, [
    projectListProps.activeThreadId && `thread:${projectListProps.activeThreadId}`,
    projectListProps.runningThreadId && `thread:${projectListProps.runningThreadId}`,
    projectListProps.activeProjectId && `project:${projectListProps.activeProjectId}`,
  ]);
  const visibleItems = order.items.slice(0, Math.max(expandedCount, minimumCount));
  useListChangeLayout(reorder.rootRef, {
    layoutKey: visibleItems.map((item) => item.id).join('\n'),
    changeKey: items.map((item) => item.id).sort().join('\n'),
    enabled: !reorder.dragging,
  });
  if (!items.length) return null;

  return (
    <section className="desktop-agent-sidebar__group" aria-label={t('sidebar.pinned')}>
      <div className="desktop-agent-sidebar__section-head">
        <Button variant="ghost"
          className="desktop-agent-sidebar__section-title-button"
          type="button"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <span>{t('sidebar.pinned')}</span>
          <ChevronDown className={`desktop-agent-sidebar__section-toggle ${collapsed ? 'is-collapsed' : ''}`} size={13} />
        </Button>
      </div>
      <SidebarCollapsibleContent open={!collapsed}>
        <div className="sidebar-reorder-list app-sidebar__list" ref={reorder.rootRef}>
          {visibleItems.map((item) => item.kind === 'project' ? (
            <SidebarProjectRow key={item.id} {...projectListProps} project={item.project}
              draggable={items.length > 1} reorder={reorder} reorderId={item.id} />
          ) : (
            <SidebarThreadRow key={item.id}
              thread={item.thread}
              project={item.thread.projectId ? projectsById.get(item.thread.projectId) : undefined}
              pinned variant="pinned" reorder={reorder} reorderId={item.id}
              menuOpen={projectListProps.threadActionMenuId === item.thread.id}
              selected={projectListProps.activeThreadId === item.thread.id}
              running={projectListProps.runningThreadId === item.thread.id}
              threadMenu={projectListProps.threadMenu}
              onArchive={projectListProps.onArchiveThread}
              onOpenInNewWindow={projectListProps.onOpenThreadInNewWindow}
              onRename={projectListProps.onRenameThread}
              onSelect={projectListProps.onSelectThread}
              onToggleMenu={projectListProps.onToggleThreadActions}
              onTogglePin={projectListProps.onToggleThreadPin}
            />
          ))}
          {visibleItems.length < items.length ? (
            <Button variant="ghost" className="desktop-agent-thread-list__show-more" type="button"
              onClick={() => setExpandedCount((count) => nextSidebarVisibleCount(count, minimumCount, BATCH_SIZE, items.length))}>
              {t('sidebar.showMore')}
            </Button>
          ) : null}
        </div>
      </SidebarCollapsibleContent>
    </section>
  );
}
