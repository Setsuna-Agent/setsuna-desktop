import { ChevronDown, Boxes, Folder, FolderOpen, FolderPlus, Plus, RefreshCw, Search, MoreHorizontal, Trash2 } from 'lucide-react';
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import { SidebarFloatingMenu } from './SidebarFloatingMenu.js';
import { SidebarThreadRow } from './SidebarThreadRow.js';
import { SidebarUserMenu } from './SidebarUserMenu.js';

const isProjectActionTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest('.desktop-agent-project__actions'));

export function AgentSidebar({
  activeProjectId,
  activeThreadId,
  runningThreadId,
  activeView,
  collapsedProjectIds,
  forceExpandedProjectIds,
  globalThreads,
  projectActionMenuId,
  projects,
  projectsCollapsed,
  searchOpen,
  searchTriggerRef,
  selectingProjectDirectory,
  sessionsCollapsed,
  threadActionMenuId,
  threadsByProjectId,
  width,
  maxWidth,
  minWidth,
  onArchiveThread,
  onCreateCurrentThread,
  onCreateGlobalThread,
  onCreateProjectThread,
  onEnterChatMode,
  onOpenCapabilities,
  onOpenSettings,
  onRemoveProject,
  onResizeStep,
  onResizeStart,
  onSelectDirectory,
  onSelectProject,
  onSelectThread,
  onToggleProjectActions,
  onToggleProjectsCollapsed,
  onToggleSearch,
  onToggleSessionsCollapsed,
  onToggleThreadActions,
  onRenameThread,
}: {
  activeProjectId: string | null;
  activeThreadId?: string | null;
  runningThreadId?: string | null;
  activeView: 'chat' | 'capabilities';
  collapsedProjectIds: Set<string>;
  forceExpandedProjectIds: Set<string>;
  globalThreads: RuntimeThreadSummary[];
  projectActionMenuId: string | null;
  projects: WorkspaceProject[];
  projectsCollapsed: boolean;
  searchOpen: boolean;
  searchTriggerRef: Ref<HTMLButtonElement>;
  selectingProjectDirectory: boolean;
  sessionsCollapsed: boolean;
  threadActionMenuId: string | null;
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>;
  width: number;
  maxWidth: number;
  minWidth: number;
  onArchiveThread: (thread: RuntimeThreadSummary) => void;
  onCreateCurrentThread: () => void;
  onCreateGlobalThread: () => void;
  onCreateProjectThread: (projectId: string) => void;
  onEnterChatMode: () => void;
  onOpenCapabilities: () => void;
  onOpenSettings: () => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSelectDirectory: () => void;
  onSelectProject: (project: WorkspaceProject) => void;
  onSelectThread: (threadId: string) => void;
  onToggleProjectActions: (projectId: string) => void;
  onToggleProjectsCollapsed: () => void;
  onToggleSearch: () => void;
  onToggleSessionsCollapsed: () => void;
  onToggleThreadActions: (threadId: string) => void;
  onRenameThread: (thread: RuntimeThreadSummary) => void;
}) {
  return (
    <aside className="app-sidebar desktop-agent-sidebar">
      <div className="desktop-agent-sidebar__top-actions">
        <button className="desktop-agent-command" type="button" onClick={onCreateCurrentThread}>
          <Plus className="desktop-agent-command__icon" size={15} />
          <span className="desktop-agent-command__label">新对话</span>
        </button>
        <button ref={searchTriggerRef} className={`desktop-agent-command ${searchOpen ? 'is-active' : ''}`} type="button" onClick={onToggleSearch}>
          <Search className="desktop-agent-command__icon" size={15} />
          <span className="desktop-agent-command__label">搜索</span>
        </button>
        <button className={`desktop-agent-command ${activeView === 'capabilities' ? 'is-active' : ''}`} type="button" onClick={onOpenCapabilities}>
          <Boxes className="desktop-agent-command__icon" size={15} />
          <span className="desktop-agent-command__label">能力</span>
        </button>
      </div>
      <div className="desktop-agent-sidebar__body">
        <ProjectSection
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          runningThreadId={runningThreadId}
          collapsedProjectIds={collapsedProjectIds}
          forceExpandedProjectIds={forceExpandedProjectIds}
          projectActionMenuId={projectActionMenuId}
          projects={projects}
          projectsCollapsed={projectsCollapsed}
          selectingProjectDirectory={selectingProjectDirectory}
          threadActionMenuId={threadActionMenuId}
          threadsByProjectId={threadsByProjectId}
          onArchiveThread={onArchiveThread}
          onCreateProjectThread={onCreateProjectThread}
          onRemoveProject={onRemoveProject}
          onRenameThread={onRenameThread}
          onSelectDirectory={onSelectDirectory}
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
      <SidebarUserMenu onOpenSettings={onOpenSettings} />
      <button
        className="desktop-agent-sidebar__resize-handle"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        title="拖拽调整侧栏宽度"
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
  selectingProjectDirectory,
  threadActionMenuId,
  threadsByProjectId,
  onArchiveThread,
  onCreateProjectThread,
  onRemoveProject,
  onRenameThread,
  onSelectDirectory,
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
  selectingProjectDirectory: boolean;
  threadActionMenuId: string | null;
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>;
  onArchiveThread: (thread: RuntimeThreadSummary) => void;
  onCreateProjectThread: (projectId: string) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onRenameThread: (thread: RuntimeThreadSummary) => void;
  onSelectDirectory: () => void;
  onSelectProject: (project: WorkspaceProject) => void;
  onSelectThread: (threadId: string) => void;
  onToggleProjectActions: (projectId: string) => void;
  onToggleProjectsCollapsed: () => void;
  onToggleThreadActions: (threadId: string) => void;
}) {
  return (
    <section className="desktop-agent-sidebar__group">
      <div className="desktop-agent-sidebar__section-head">
        <button className="desktop-agent-sidebar__section-title-button" type="button" onClick={onToggleProjectsCollapsed}>
          <span>项目</span>
          <ChevronDown className={`desktop-agent-sidebar__section-toggle ${projectsCollapsed ? 'is-collapsed' : ''}`} size={13} />
        </button>
        <div className="desktop-agent-sidebar__section-actions">
          <button
            className={`agent-sidebar-icon-button ${selectingProjectDirectory ? 'is-active' : ''}`}
            type="button"
            aria-label="选择项目目录"
            disabled={selectingProjectDirectory}
            title="选择项目目录"
            onClick={onSelectDirectory}
          >
            {selectingProjectDirectory ? <RefreshCw className="is-spinning" size={14} /> : <FolderPlus size={14} />}
          </button>
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
                      className="desktop-agent-project"
                      role="button"
                      tabIndex={0}
                      title={project.path}
                      onClick={(event) => {
                        if (isProjectActionTarget(event.target)) return;
                        onSelectProject(project);
                      }}
                      onKeyDown={(event) => {
                        if (isProjectActionTarget(event.target)) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectProject(project);
                        }
                      }}
                    >
                      {isProjectCollapsed ? <Folder className="desktop-agent-project__icon" size={14} /> : <FolderOpen className="desktop-agent-project__icon" size={14} />}
                      <span className="desktop-agent-project__text">
                        <span className="desktop-agent-project__name">{project.name}</span>
                      </span>
                      <ProjectActionMenu
                        open={projectActionMenuId === project.id}
                        project={project}
                        onCreateProjectThread={onCreateProjectThread}
                        onRemoveProject={onRemoveProject}
                        onToggleProjectActions={onToggleProjectActions}
                      />
                    </div>
                    {shouldShowChildren ? (
                      projectThreads.length ? (
                        <div className="desktop-agent-session-list">
                          {projectThreads.map((thread) => (
                            <SidebarThreadRow
                              key={`${project.id}:${thread.id}`}
                              menuOpen={threadActionMenuId === thread.id}
                              running={runningThreadId === thread.id}
                              selected={isActiveProject && activeThreadId === thread.id}
                              thread={thread}
                              variant="project"
                              onArchive={onArchiveThread}
                              onRename={onRenameThread}
                              onSelect={onSelectThread}
                              onToggleMenu={onToggleThreadActions}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="desktop-agent-sidebar__empty-session">暂无对话</div>
                      )
                    ) : null}
                  </div>
                );
              })
            ) : (
              <button className="desktop-agent-sidebar__empty-project" type="button" disabled={selectingProjectDirectory} onClick={onSelectDirectory}>
                {selectingProjectDirectory ? '正在选择项目目录...' : '选择项目目录'}
              </button>
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
  onCreateProjectThread,
  onRemoveProject,
  onToggleProjectActions,
}: {
  open: boolean;
  project: WorkspaceProject;
  onCreateProjectThread: (projectId: string) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onToggleProjectActions: (projectId: string) => void;
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const toggleMenu = () => onToggleProjectActions(project.id);
  const handleTriggerClick = (event: ReactMouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    toggleMenu();
  };
  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleMenu();
    }
  };
  const stopProjectActionEvent = (
    event: ReactKeyboardEvent<HTMLSpanElement> | ReactMouseEvent<HTMLSpanElement> | ReactPointerEvent<HTMLSpanElement>,
  ) => {
    event.stopPropagation();
  };

  return (
    <span
      className="desktop-agent-project__actions"
      onClick={stopProjectActionEvent}
      onMouseDown={stopProjectActionEvent}
      onPointerDown={stopProjectActionEvent}
      onKeyDown={stopProjectActionEvent}
    >
      <span
        className="desktop-agent-project__action desktop-agent-project__more"
        ref={triggerRef}
        role="button"
        tabIndex={0}
        aria-label="项目操作"
        aria-expanded={open}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        <MoreHorizontal size={14} />
      </span>
      <SidebarFloatingMenu open={open} triggerRef={triggerRef} onClose={toggleMenu}>
        <button type="button" role="menuitem" onClick={() => onCreateProjectThread(project.id)}>
          <Plus size={13} />
          新对话
        </button>
        <button
          type="button"
          role="menuitem"
          className="is-danger"
          onClick={() => {
            const confirmed = window.confirm(`确认从侧栏移除项目「${project.name}」？本地文件不会被删除。`);
            if (confirmed) onRemoveProject(project);
          }}
        >
          <Trash2 size={13} />
          移除
        </button>
      </SidebarFloatingMenu>
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
  return (
    <section className="desktop-agent-sidebar__group desktop-agent-sidebar__group--sessions">
      <div className="desktop-agent-sidebar__section-head">
        <button
          className={`desktop-agent-sidebar__section-title-button ${!activeProjectId ? 'is-active' : ''}`}
          type="button"
          onClick={activeProjectId ? onEnterChatMode : onToggleSessionsCollapsed}
        >
          <span>对话</span>
          <ChevronDown className={`desktop-agent-sidebar__section-toggle ${sessionsCollapsed ? 'is-collapsed' : ''}`} size={13} />
        </button>
        <div className="desktop-agent-sidebar__section-actions">
          <button className="agent-sidebar-icon-button" type="button" aria-label="新对话" onClick={onCreateGlobalThread}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      {!sessionsCollapsed ? (
        <div className="app-sidebar__list">
          {globalThreads.length ? (
            globalThreads.map((thread) => (
              <SidebarThreadRow
                key={thread.id}
                menuOpen={threadActionMenuId === thread.id}
                running={runningThreadId === thread.id}
                selected={!activeProjectId && activeThreadId === thread.id}
                thread={thread}
                variant="global"
                onArchive={onArchiveThread}
                onRename={onRenameThread}
                onSelect={onSelectThread}
                onToggleMenu={onToggleThreadActions}
              />
            ))
          ) : (
            <div className="desktop-agent-sidebar__empty-session">暂无聊天</div>
          )}
        </div>
      ) : null}
    </section>
  );
}
