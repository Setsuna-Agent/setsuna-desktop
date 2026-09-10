import { useConfirm } from '@setsuna-desktop/renderer-ui';
import { ResizeHandle, Button } from '@setsuna-desktop/renderer-ui';
import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import {
  Archive,
  Blocks,
  ChevronDown,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import {
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type RefObject,
  type ReactNode,
} from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { SidebarFloatingMenu } from './SidebarFloatingMenu.js';
import { SidebarThreadList } from './SidebarThreadList.js';
import { SidebarUserMenu } from './SidebarUserMenu.js';

const isProjectActionTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('.desktop-agent-project__actions'));

export function AgentSidebar({
  activeProjectId,
  activeThreadId,
  collapsed = false,
  runningThreadId,
  activeView,
  collapsedProjectIds,
  forceExpandedProjectIds,
  globalThreads,
  projectActionMenuId,
  pluginEntries,
  projects,
  projectsCollapsed,
  searchOpen,
  searchTriggerRef,
  sessionsCollapsed,
  threadActionMenuId,
  threadsByProjectId,
  width,
  maxWidth,
  minWidth,
  onArchiveThread,
  onArchiveProject,
  onCreateCurrentThread,
  onCreateGlobalThread,
  onCreateProjectThread,
  onEnterChatMode,
  onEditProject,
  onOpenCapabilities,
  onOpenRuntimeActivity,
  onOpenSettings,
  onRemoveProject,
  onResizeStep,
  onResizeStart,
  onCreateProject,
  onSelectProject,
  onSelectThread,
  onToggleProjectActions,
  onToggleProjectsCollapsed,
  onToggleSearch,
  onToggleSessionsCollapsed,
  onToggleThreadActions,
  onRenameThread,
  runtimeActivityTriggerRef,
}: {
  activeProjectId: string | null;
  activeThreadId?: string | null;
  collapsed?: boolean;
  runningThreadId?: string | null;
  activeView: 'chat' | 'capabilities';
  collapsedProjectIds: Set<string>;
  forceExpandedProjectIds: Set<string>;
  globalThreads: RuntimeThreadSummary[];
  projectActionMenuId: string | null;
  pluginEntries?: ReactNode;
  projects: WorkspaceProject[];
  projectsCollapsed: boolean;
  searchOpen: boolean;
  searchTriggerRef: Ref<HTMLButtonElement>;
  sessionsCollapsed: boolean;
  threadActionMenuId: string | null;
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>;
  width: number;
  maxWidth: number;
  minWidth: number;
  onArchiveThread: (thread: RuntimeThreadSummary) => void;
  onArchiveProject: (project: WorkspaceProject) => void;
  onCreateCurrentThread: () => void;
  onCreateGlobalThread: () => void;
  onCreateProjectThread: (projectId: string) => void;
  onEnterChatMode: () => void;
  onEditProject: (project: WorkspaceProject) => void;
  onOpenCapabilities: () => void;
  onOpenRuntimeActivity: () => void;
  onOpenSettings: () => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onCreateProject: () => void;
  onSelectProject: (project: WorkspaceProject) => void;
  onSelectThread: (threadId: string) => void;
  onToggleProjectActions: (projectId: string) => void;
  onToggleProjectsCollapsed: () => void;
  onToggleSearch: () => void;
  onToggleSessionsCollapsed: () => void;
  onToggleThreadActions: (threadId: string) => void;
  onRenameThread: (thread: RuntimeThreadSummary) => void;
  runtimeActivityTriggerRef: RefObject<HTMLButtonElement>;
}) {
  const { t } = useI18n();

  return (
    <aside className="app-sidebar desktop-agent-sidebar" aria-hidden={collapsed || undefined}>
      <div className="desktop-agent-sidebar__top-actions">
        <ShortcutTooltip commandId="app.newChat" label={t('app.newChat')} placement="bottom">
          <Button variant="ghost" className="desktop-agent-command" type="button" onClick={onCreateCurrentThread}>
            <Plus className="desktop-agent-command__icon" size={15} />
            <span className="desktop-agent-command__label">{t('app.newChat')}</span>
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip commandId="app.searchChats" label={t('sidebar.search')} placement="bottom">
          <Button variant="ghost" ref={searchTriggerRef} className={`desktop-agent-command ${searchOpen ? 'is-active' : ''}`} type="button" onClick={onToggleSearch}>
            <Search className="desktop-agent-command__icon" size={15} />
            <span className="desktop-agent-command__label">{t('sidebar.search')}</span>
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip commandId="app.openCapabilities" label={t('sidebar.plugins')} placement="bottom">
          <Button variant="ghost" className={`desktop-agent-command ${activeView === 'capabilities' ? 'is-active' : ''}`} type="button" onClick={onOpenCapabilities}>
            <Blocks className="desktop-agent-command__icon" size={15} />
            <span className="desktop-agent-command__label">{t('sidebar.plugins')}</span>
          </Button>
        </ShortcutTooltip>
      </div>
      <div className="desktop-agent-sidebar__body">
        <nav className="desktop-agent-sidebar__plugin-entries" aria-label={t('sidebar.pluginFeatures')}>
          {pluginEntries}
        </nav>
        <ProjectSection
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          runningThreadId={runningThreadId}
          collapsedProjectIds={collapsedProjectIds}
          forceExpandedProjectIds={forceExpandedProjectIds}
          projectActionMenuId={projectActionMenuId}
          projects={projects}
          projectsCollapsed={projectsCollapsed}
          threadActionMenuId={threadActionMenuId}
          threadsByProjectId={threadsByProjectId}
          onArchiveThread={onArchiveThread}
          onArchiveProject={onArchiveProject}
          onCreateProjectThread={onCreateProjectThread}
          onEditProject={onEditProject}
          onRemoveProject={onRemoveProject}
          onRenameThread={onRenameThread}
          onCreateProject={onCreateProject}
          onSelectProject={onSelectProject}
          onSelectThread={onSelectThread}
          onToggleProjectActions={onToggleProjectActions}
          onToggleProjectsCollapsed={onToggleProjectsCollapsed}
          onToggleThreadActions={onToggleThreadActions}
        />
        <GlobalThreadSection
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          runningThreadId={runningThreadId}
          globalThreads={globalThreads}
          sessionsCollapsed={sessionsCollapsed}
          threadActionMenuId={threadActionMenuId}
          onArchiveThread={onArchiveThread}
          onCreateGlobalThread={onCreateGlobalThread}
          onEnterChatMode={onEnterChatMode}
          onRenameThread={onRenameThread}
          onSelectThread={onSelectThread}
          onToggleSessionsCollapsed={onToggleSessionsCollapsed}
          onToggleThreadActions={onToggleThreadActions}
        />
      </div>
      <SidebarUserMenu
        runtimeActivityTriggerRef={runtimeActivityTriggerRef}
        onOpenRuntimeActivity={onOpenRuntimeActivity}
        onOpenSettings={onOpenSettings}
      />
      <ResizeHandle
        className="desktop-agent-sidebar__resize-handle"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidebar.resize')}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        title={t('sidebar.resizeHint')}
        onPointerDown={onResizeStart}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            onResizeStep(-16);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            onResizeStep(16);
          }
        }}
      />
    </aside>
  );
}

function ProjectSection({
  activeProjectId,
  activeThreadId,
  runningThreadId,
  collapsedProjectIds,
  forceExpandedProjectIds,
  projectActionMenuId,
  projects,
  projectsCollapsed,
  threadActionMenuId,
  threadsByProjectId,
  onArchiveThread,
  onArchiveProject,
  onCreateProjectThread,
  onEditProject,
  onRemoveProject,
  onRenameThread,
  onCreateProject,
  onSelectProject,
  onSelectThread,
  onToggleProjectActions,
  onToggleProjectsCollapsed,
  onToggleThreadActions,
}: {
  activeProjectId: string | null;
  activeThreadId?: string | null;
  runningThreadId?: string | null;
  collapsedProjectIds: Set<string>;
  forceExpandedProjectIds: Set<string>;
  projectActionMenuId: string | null;
  projects: WorkspaceProject[];
  projectsCollapsed: boolean;
  threadActionMenuId: string | null;
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>;
  onArchiveThread: (thread: RuntimeThreadSummary) => void;
  onArchiveProject: (project: WorkspaceProject) => void;
  onCreateProjectThread: (projectId: string) => void;
  onEditProject: (project: WorkspaceProject) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onRenameThread: (thread: RuntimeThreadSummary) => void;
  onCreateProject: () => void;
  onSelectProject: (project: WorkspaceProject) => void;
  onSelectThread: (threadId: string) => void;
  onToggleProjectActions: (projectId: string) => void;
  onToggleProjectsCollapsed: () => void;
  onToggleThreadActions: (threadId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="desktop-agent-sidebar__group">
      <div className="desktop-agent-sidebar__section-head">
        <Button variant="ghost" className="desktop-agent-sidebar__section-title-button" type="button" onClick={onToggleProjectsCollapsed}>
          <span>{t('sidebar.projects')}</span>
          <ChevronDown className={`desktop-agent-sidebar__section-toggle ${projectsCollapsed ? 'is-collapsed' : ''}`} size={13} />
        </Button>
        <div className="desktop-agent-sidebar__section-actions">
          <ShortcutTooltip commandId="app.addProject" label={t('sidebar.createProject')}>
            <Button variant="ghost"
              className="agent-sidebar-icon-button"
              type="button"
              aria-label={t('sidebar.createProject')}
              onClick={onCreateProject}
            >
              <FolderPlus size={14} />
            </Button>
          </ShortcutTooltip>
        </div>
      </div>
      {!projectsCollapsed ? (
        <div className="desktop-agent-sidebar__project-list">
          <div className="project-list">
            {projects.length ? (
              projects.map((project) => {
                const projectThreads = threadsByProjectId.get(project.id) ?? [];
                const isActiveProject = project.id === activeProjectId;
                const isForceExpandedProject = forceExpandedProjectIds.has(project.id);
                const isProjectCollapsed = collapsedProjectIds.has(project.id) && !isForceExpandedProject;
                const shouldShowChildren = !isProjectCollapsed && (isForceExpandedProject || isActiveProject || projectThreads.length > 0);

                return (
                  <div className="desktop-agent-project-node" key={project.id}>
                    <div
                      className={`desktop-agent-project${projectActionMenuId === project.id ? ' is-menu-open' : ''}`}
                      title={project.path ?? t('sidebar.projectDirectoryUnbound')}
                      onContextMenu={(event) => {
                        if (isProjectActionTarget(event.target)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (projectActionMenuId !== project.id) onToggleProjectActions(project.id);
                      }}
                    >
                      <Button variant="ghost"
                        className="desktop-agent-project__select"
                        type="button"
                        onClick={() => onSelectProject(project)}
                        onKeyDown={(event) => {
                          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                          event.preventDefault();
                          if (projectActionMenuId !== project.id) onToggleProjectActions(project.id);
                        }}
                      >
                        {project.path && !isProjectCollapsed
                          ? <FolderOpen className="desktop-agent-project__icon" size={14} />
                          : <FolderClosed className="desktop-agent-project__icon" size={14} />}
                        <span className="desktop-agent-project__text">
                          <span className="desktop-agent-project__name">{project.name}</span>
                          {!project.path ? <small>{t('sidebar.projectUnbound')}</small> : null}
                        </span>
                      </Button>
                      <ProjectActionMenu
                        open={projectActionMenuId === project.id}
                        project={project}
                        onArchiveProject={onArchiveProject}
                        onCreateProjectThread={onCreateProjectThread}
                        onEditProject={onEditProject}
                        onRemoveProject={onRemoveProject}
                        onToggleProjectActions={onToggleProjectActions}
                      />
                    </div>
                    {shouldShowChildren ? (
                      projectThreads.length ? (
                        <SidebarThreadList
                          menuThreadId={threadActionMenuId}
                          runningThreadId={runningThreadId}
                          selectedThreadId={isActiveProject ? activeThreadId : null}
                          threads={projectThreads}
                          variant="project"
                          onArchive={onArchiveThread}
                          onRename={onRenameThread}
                          onSelect={onSelectThread}
                          onToggleMenu={onToggleThreadActions}
                        />
                      ) : (
                        <div className="desktop-agent-sidebar__empty-session">{t('sidebar.emptyChats')}</div>
                      )
                    ) : null}
                  </div>
                );
              })
            ) : (
              <Button variant="ghost" className="desktop-agent-sidebar__empty-project" type="button" onClick={onCreateProject}>
                {t('sidebar.createProject')}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ProjectActionMenu({
  open,
  project,
  onArchiveProject,
  onCreateProjectThread,
  onEditProject,
  onRemoveProject,
  onToggleProjectActions,
}: {
  open: boolean;
  project: WorkspaceProject;
  onArchiveProject: (project: WorkspaceProject) => void;
  onCreateProjectThread: (projectId: string) => void;
  onEditProject: (project: WorkspaceProject) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onToggleProjectActions: (projectId: string) => void;
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
        aria-haspopup="menu"
        onClick={handleTriggerClick}
      >
        <MoreHorizontal size={14} />
      </Button>
      <SidebarFloatingMenu open={open} placement="bottom-right" triggerRef={triggerRef} onClose={toggleMenu}>
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

function GlobalThreadSection({
  activeProjectId,
  activeThreadId,
  runningThreadId,
  globalThreads,
  sessionsCollapsed,
  threadActionMenuId,
  onArchiveThread,
  onCreateGlobalThread,
  onEnterChatMode,
  onRenameThread,
  onSelectThread,
  onToggleSessionsCollapsed,
  onToggleThreadActions,
}: {
  activeProjectId: string | null;
  activeThreadId?: string | null;
  runningThreadId?: string | null;
  globalThreads: RuntimeThreadSummary[];
  sessionsCollapsed: boolean;
  threadActionMenuId: string | null;
  onArchiveThread: (thread: RuntimeThreadSummary) => void;
  onCreateGlobalThread: () => void;
  onEnterChatMode: () => void;
  onRenameThread: (thread: RuntimeThreadSummary) => void;
  onSelectThread: (threadId: string) => void;
  onToggleSessionsCollapsed: () => void;
  onToggleThreadActions: (threadId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="desktop-agent-sidebar__group desktop-agent-sidebar__group--sessions">
      <div className="desktop-agent-sidebar__section-head">
        <Button variant="ghost"
          className={`desktop-agent-sidebar__section-title-button ${!activeProjectId ? 'is-active' : ''}`}
          type="button"
          onClick={activeProjectId ? onEnterChatMode : onToggleSessionsCollapsed}
        >
          <span>{t('sidebar.chats')}</span>
          <ChevronDown className={`desktop-agent-sidebar__section-toggle ${sessionsCollapsed ? 'is-collapsed' : ''}`} size={13} />
        </Button>
        <div className="desktop-agent-sidebar__section-actions">
          <Button variant="ghost" className="agent-sidebar-icon-button" type="button" aria-label={t('app.newChat')} onClick={onCreateGlobalThread}>
            <Plus size={14} />
          </Button>
        </div>
      </div>
      {!sessionsCollapsed ? (
        globalThreads.length ? (
          <SidebarThreadList
            menuThreadId={threadActionMenuId}
            runningThreadId={runningThreadId}
            selectedThreadId={!activeProjectId ? activeThreadId : null}
            threads={globalThreads}
            variant="global"
            onArchive={onArchiveThread}
            onRename={onRenameThread}
            onSelect={onSelectThread}
            onToggleMenu={onToggleThreadActions}
          />
        ) : (
          <div className="app-sidebar__list">
            <div className="desktop-agent-sidebar__empty-session">{t('sidebar.emptyGlobalChats')}</div>
          </div>
        )
      ) : null}
    </section>
  );
}
