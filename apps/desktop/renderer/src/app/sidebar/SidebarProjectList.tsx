import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { Button, useConfirm, useNativeDragPreview } from '@setsuna-desktop/renderer-ui';
import { Archive, MoreHorizontal, Pin, Plus, Settings, Trash2 } from 'lucide-react';
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { ThreadMenuState } from '../thread-menu/useThreadMenu.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ProjectIcon } from '../../shared/ui/ProjectIcon.js';
import { SidebarCollapsibleContent } from './SidebarCollapsibleContent.js';
import { SidebarFloatingMenu } from './SidebarFloatingMenu.js';
import { SidebarProjectHoverCard } from './SidebarProjectHoverCard.js';
import { SidebarThreadList } from './SidebarThreadList.js';
import { useSidebarOrder } from './SidebarOrderProvider.js';
import { useSidebarReorder, type SidebarReorder } from './useSidebarReorder.js';

const isProjectActionTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('.desktop-agent-project__actions'));

export type SidebarProjectListProps = {
  pinnedThreadIds: ReadonlySet<string>;
  pinnedProjectIds: ReadonlySet<string>;
  activeProjectId: string | null;
  activeThreadId?: string | null;
  runningThreadId?: string | null;
  collapsedProjectIds: Set<string>;
  forceExpandedProjectIds: Set<string>;
  projectActionMenuId: string | null;
  projects: WorkspaceProject[];
  threadActionMenuId: string | null;
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>;
  onArchiveThread: (thread: RuntimeThreadSummary) => void;
  onArchiveProject: (project: WorkspaceProject) => void;
  onCreateProjectThread: (projectId: string) => void;
  onEditProject: (project: WorkspaceProject) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  threadMenu: ThreadMenuState;
  onOpenThreadInNewWindow: (threadId: string) => void;
  onRenameThread: (thread: RuntimeThreadSummary) => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onToggleProjectActions: (projectId: string) => void;
  onToggleProjectPin: (project: WorkspaceProject) => void;
  onToggleThreadActions: (threadId: string) => void;
  onToggleThreadPin: (thread: RuntimeThreadSummary) => void;
};

export function SidebarProjectList({ projects, ...rowProps }: SidebarProjectListProps) {
  const order = useSidebarOrder('projects', projects);
  const reorder = useSidebarReorder(order.items.map((project) => project.id), order.move);
  return <div className="desktop-agent-sidebar__project-list">
    <div className="project-list sidebar-reorder-list" ref={reorder.rootRef}>
      {order.items.map((project) => <SidebarProjectRow key={project.id} {...rowProps} project={project}
        draggable={projects.length > 1} reorder={reorder} />)}
    </div>
  </div>;
}

export function SidebarProjectRow({
  project,
  draggable,
  reorder,
  reorderId = project.id,
  pinnedThreadIds,
  pinnedProjectIds,
  activeProjectId,
  activeThreadId,
  runningThreadId,
  collapsedProjectIds,
  forceExpandedProjectIds,
  projectActionMenuId,
  threadActionMenuId,
  threadsByProjectId,
  onArchiveThread,
  onArchiveProject,
  onCreateProjectThread,
  onEditProject,
  onRemoveProject,
  threadMenu,
  onOpenThreadInNewWindow,
  onRenameThread,
  onToggleProjectCollapsed,
  onSelectThread,
  onToggleProjectActions,
  onToggleProjectPin,
  onToggleThreadActions,
  onToggleThreadPin,
}: Omit<SidebarProjectListProps, 'projects'> & {
  project: WorkspaceProject;
  draggable: boolean;
  reorder: SidebarReorder;
  reorderId?: string;
}) {
  const { t } = useI18n();
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const dragPreview = useNativeDragPreview();
  const projectThreads = threadsByProjectId.get(project.id) ?? [];
  const unpinnedThreads = projectThreads.filter((thread) => !pinnedThreadIds.has(thread.id));
  const isActiveProject = project.id === activeProjectId;
  const isForceExpandedProject = forceExpandedProjectIds.has(project.id);
  const isProjectCollapsed = collapsedProjectIds.has(project.id) && !isForceExpandedProject;
  const shouldShowChildren = !isProjectCollapsed && (isForceExpandedProject || isActiveProject || projectThreads.length > 0);

  return (
    <div className="desktop-agent-project-node" key={project.id} {...reorder.rowProps(reorderId)}>
      <SidebarProjectHoverCard
        disabled={projectActionMenuId === project.id || reorder.dragging}
        project={project}
        threadCount={projectThreads.length}
        onEditProject={onEditProject}
      >
        <div
          className={`desktop-agent-project${projectActionMenuId === project.id ? ' is-menu-open' : ''}`}
          onContextMenu={(event) => {
            if (isProjectActionTarget(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            setMenuPoint({ x: event.clientX, y: event.clientY });
            if (projectActionMenuId !== project.id) onToggleProjectActions(project.id);
          }}
        >
          <Button variant="ghost"
            className="desktop-agent-project__select"
            type="button"
            aria-expanded={!isProjectCollapsed}
            draggable={draggable}
            onDragStart={(event) => {
              reorder.start(event, reorderId);
              dragPreview.start(event);
            }}
            onDragEnd={() => { dragPreview.end(); reorder.end(); }}
            onClick={() => onToggleProjectCollapsed(project.id)}
            onKeyDown={(event) => {
              if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              setMenuPoint({ x: rect.left + 20, y: rect.bottom });
              if (projectActionMenuId !== project.id) onToggleProjectActions(project.id);
            }}
          >
            <ProjectIcon icon={project.icon} open={Boolean(project.path && !isProjectCollapsed)}
              className="desktop-agent-project__icon" />
            <span className="desktop-agent-project__text">
              <span className="desktop-agent-project__name">{project.name}</span>
              {!project.path ? <small>{t('sidebar.projectUnbound')}</small> : null}
            </span>
          </Button>
          <ProjectActionMenu
            anchorPoint={menuPoint ?? undefined}
            open={projectActionMenuId === project.id}
            project={project}
            pinned={pinnedProjectIds.has(project.id)}
            onArchiveProject={onArchiveProject}
            onCreateProjectThread={onCreateProjectThread}
            onEditProject={onEditProject}
            onRemoveProject={onRemoveProject}
            onToggleProjectActions={(projectId) => { setMenuPoint(null); onToggleProjectActions(projectId); }}
            onToggleProjectPin={onToggleProjectPin}
          />
        </div>
      </SidebarProjectHoverCard>
      <SidebarCollapsibleContent open={shouldShowChildren}>
        <div className="desktop-agent-project__children">
          {projectThreads.length ? (
            <SidebarThreadList
              menuThreadId={threadActionMenuId}
              project={project}
              runningThreadId={runningThreadId}
              selectedThreadId={isActiveProject ? activeThreadId : null}
              threads={unpinnedThreads}
              variant="project"
              onArchive={onArchiveThread}
              threadMenu={threadMenu}
              onOpenInNewWindow={onOpenThreadInNewWindow}
              onRename={onRenameThread}
              onSelect={onSelectThread}
              onToggleMenu={onToggleThreadActions}
              onTogglePin={onToggleThreadPin}
            />
          ) : (
            <div className="desktop-agent-sidebar__empty desktop-agent-sidebar__empty--nested">{t('sidebar.emptyChats')}</div>
          )}
        </div>
      </SidebarCollapsibleContent>
    </div>
  );
}

function ProjectActionMenu({
  anchorPoint,
  open,
  project,
  pinned,
  onArchiveProject,
  onCreateProjectThread,
  onEditProject,
  onRemoveProject,
  onToggleProjectActions,
  onToggleProjectPin,
}: {
  anchorPoint?: { x: number; y: number };
  open: boolean;
  project: WorkspaceProject;
  pinned: boolean;
  onArchiveProject: (project: WorkspaceProject) => void;
  onCreateProjectThread: (projectId: string) => void;
  onEditProject: (project: WorkspaceProject) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onToggleProjectActions: (projectId: string) => void;
  onToggleProjectPin: (project: WorkspaceProject) => void;
}) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const confirm = useConfirm();
  const toggleMenu = () => onToggleProjectActions(project.id);
  const handleTriggerClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleMenu();
  };
  const stopProjectActionEvent = (
    event: ReactKeyboardEvent<HTMLSpanElement> | ReactMouseEvent<HTMLSpanElement> | ReactPointerEvent<HTMLSpanElement>,
  ) => {
    event.stopPropagation();
  };
  const stopProjectActionContextMenu = (event: ReactMouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <span
      className="desktop-agent-project__actions"
      onClick={stopProjectActionEvent}
      onMouseDown={stopProjectActionEvent}
      onPointerDown={stopProjectActionEvent}
      onContextMenu={stopProjectActionContextMenu}
      onKeyDown={stopProjectActionEvent}
    >
      <Button variant="ghost"
        className="desktop-agent-project__action desktop-agent-project__more"
        ref={triggerRef}
        type="button"
        aria-label={t('sidebar.projectActions')}
        aria-expanded={open}
        data-overlay-open={open && !anchorPoint ? '' : undefined}
        aria-haspopup="menu"
        onClick={handleTriggerClick}
      >
        <MoreHorizontal size={14} />
      </Button>
      <SidebarFloatingMenu anchorPoint={anchorPoint} open={open} placement="bottom-right" triggerRef={triggerRef} onClose={toggleMenu}>
        <Button variant="ghost" type="button" role="menuitem"
          onClick={() => { toggleMenu(); onToggleProjectPin(project); }}>
          <Pin size={13} fill={pinned ? 'currentColor' : 'none'} />
          {t(pinned ? 'sidebar.unpinProject' : 'sidebar.pinProject')}
        </Button>
        <Button variant="ghost"
          type="button"
          role="menuitem"
          onClick={() => onEditProject(project)}
        >
          <Settings size={13} />
          {t('sidebar.editProject')}
        </Button>
        <Button variant="ghost"
          type="button"
          role="menuitem"
          onClick={async () => {
            toggleMenu();
            const confirmed = await confirm({
              title: t('sidebar.archiveProject'),
              description: t('sidebar.archiveProjectTitle', { project: project.name }),
              confirmLabel: t('sidebar.archiveProject'),
            });
            if (confirmed) onArchiveProject(project);
          }}
        >
          <Archive size={13} />
          {t('sidebar.archiveProject')}
        </Button>
        <Button variant="danger"
          type="button"
          role="menuitem"
          className="is-danger"
          onClick={async () => {
            toggleMenu();
            const confirmed = await confirm({
              title: t('common.remove'),
              description: t('sidebar.removeProjectTitle', { project: project.name }),
              confirmLabel: t('common.remove'),
              danger: true,
            });
            if (confirmed) onRemoveProject(project);
          }}
        >
          <Trash2 size={13} />
          {t('common.remove')}
        </Button>
      </SidebarFloatingMenu>
      <Button variant="ghost"
        className="desktop-agent-project__action desktop-agent-project__new-thread"
        type="button"
        aria-label={t('sidebar.newProjectChat', { project: project.name })}
        title={t('sidebar.newChat')}
        onClick={() => onCreateProjectThread(project.id)}
      >
        <Plus size={14} />
      </Button>
    </span>
  );
}
