import type { ThreadMenuState } from '../thread-menu/useThreadMenu.js';
import { ResizeHandle, Button } from '@setsuna-desktop/renderer-ui';
import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import {
  ChevronDown,
  FolderPlus,
  Plus,
  Search,
} from 'lucide-react';
import {
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { AppSidebar } from '../../shared/ui/AppSidebar.js';
import { ShortcutTooltip } from '../../shared/ui/ShortcutTooltip.js';
import { SidebarCollapsibleContent } from './SidebarCollapsibleContent.js';
import { SidebarMenuOpenContext } from './SidebarMenuContext.js';
import { SidebarThreadList } from './SidebarThreadList.js';
import { PinnedSection } from './PinnedSection.js';
import { SidebarProjectList, type SidebarProjectListProps } from './SidebarProjectList.js';
import { useSidebarNavigationHint } from './useSidebarNavigationHint.js';
import { SidebarOrderProvider } from './SidebarOrderProvider.js';

export function AgentSidebar({
  activeProjectId,
  activeThreadId,
  assistantEntries,
  collapsed = false,
  runningThreadId,
  activeView,
  collapsedProjectIds,
  forceExpandedProjectIds,
  globalThreads,
  pinnedThreadIds,
  pinnedThreads,
  pinnedProjectIds,
  pinnedProjects,
  projectActionMenuId,
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
  onEditProject,
  onRemoveProject,
  onResizeStep,
  onResizeStart,
  onCreateProject,
  onToggleProjectCollapsed,
  onSelectThread,
  onToggleProjectActions,
  onToggleProjectsCollapsed,
  onToggleSearch,
  onToggleSessionsCollapsed,
  onToggleThreadActions,
  onToggleThreadPin,
  onToggleProjectPin,
  threadMenu,
  onOpenThreadInNewWindow,
  onRenameThread,
}: {
  activeProjectId: string | null;
  activeThreadId?: string | null;
  /** Feature-provided shortcuts in the fixed command area, below new chat. */
  assistantEntries?: ReactNode;
  collapsed?: boolean;
  runningThreadId?: string | null;
  activeView: 'chat' | 'capabilities' | 'pull-requests';
  collapsedProjectIds: Set<string>;
  forceExpandedProjectIds: Set<string>;
  globalThreads: RuntimeThreadSummary[];
  pinnedThreadIds: ReadonlySet<string>;
  pinnedThreads: RuntimeThreadSummary[];
  pinnedProjectIds: ReadonlySet<string>;
  pinnedProjects: WorkspaceProject[];
  projectActionMenuId: string | null;
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
  onEditProject: (project: WorkspaceProject) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onCreateProject: () => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onSelectThread: (threadId: string) => void;
  onToggleProjectActions: (projectId: string) => void;
  onToggleProjectsCollapsed: () => void;
  onToggleSearch: () => void;
  onToggleSessionsCollapsed: () => void;
  onToggleThreadActions: (threadId: string) => void;
  onToggleThreadPin: (thread: RuntimeThreadSummary) => void;
  onToggleProjectPin: (project: WorkspaceProject) => void;
  threadMenu: ThreadMenuState;
  onOpenThreadInNewWindow: (threadId: string) => void;
  onRenameThread: (thread: RuntimeThreadSummary) => void;
}) {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const navigationHint = useSidebarNavigationHint(activeView === 'chat' && !collapsed);
  const menuOpen = Boolean(threadActionMenuId || projectActionMenuId);
  const projectListProps: Omit<SidebarProjectListProps, 'projects'> = {
    pinnedThreadIds, pinnedProjectIds, activeProjectId, activeThreadId, runningThreadId,
    collapsedProjectIds, forceExpandedProjectIds, projectActionMenuId, threadActionMenuId, threadsByProjectId,
    onArchiveThread, onArchiveProject, onCreateProjectThread, onEditProject, onRemoveProject,
    threadMenu, onOpenThreadInNewWindow, onRenameThread, onToggleProjectCollapsed, onSelectThread,
    onToggleProjectActions, onToggleProjectPin, onToggleThreadActions, onToggleThreadPin,
  };

  const sidebar = (
    <AppSidebar
      className="desktop-agent-sidebar"
      aria-hidden={collapsed || undefined}
      data-navigation-hint={navigationHint || undefined}
      data-menu-open={menuOpen || undefined}
      data-scrolled={scrolled || undefined}
    >
      <div className="desktop-agent-sidebar__top-actions">
        <ShortcutTooltip commandId="app.newChat" label={t('app.newChat')} placement="bottom">
          <Button variant="ghost" className="desktop-agent-command" type="button" onClick={onCreateCurrentThread}>
            <Plus className="desktop-agent-command__icon" size={15} />
            <span className="desktop-agent-command__label">{t('app.newChat')}</span>
          </Button>
        </ShortcutTooltip>
        {assistantEntries}
        <ShortcutTooltip commandId="app.searchChats" label={t('sidebar.search')} placement="bottom">
          <Button variant="ghost" ref={searchTriggerRef} className={`desktop-agent-command ${searchOpen ? 'is-active' : ''}`} type="button" onClick={onToggleSearch}>
            <Search className="desktop-agent-command__icon" size={15} />
            <span className="desktop-agent-command__label">{t('sidebar.search')}</span>
          </Button>
        </ShortcutTooltip>
      </div>
      <div
        className="desktop-agent-sidebar__body"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        <PinnedSection
          projectListProps={projectListProps}
          pinnedProjects={pinnedProjects}
          projects={projects}
          threads={pinnedThreads}
        />
        <ProjectSection
          listProps={projectListProps}
          projects={projects.filter((project) => !pinnedProjectIds.has(project.id))}
          projectsCollapsed={projectsCollapsed}
          showEmpty={projects.length === 0}
          onCreateProject={onCreateProject}
          onToggleProjectsCollapsed={onToggleProjectsCollapsed}
        />
        <GlobalThreadSection
          pinnedThreadIds={pinnedThreadIds}
          activeProjectId={activeProjectId}
          activeThreadId={activeThreadId}
          runningThreadId={runningThreadId}
          globalThreads={globalThreads}
          sessionsCollapsed={sessionsCollapsed}
          threadActionMenuId={threadActionMenuId}
          onArchiveThread={onArchiveThread}
          onCreateGlobalThread={onCreateGlobalThread}
          threadMenu={threadMenu}
          onOpenThreadInNewWindow={onOpenThreadInNewWindow}
          onRenameThread={onRenameThread}
          onSelectThread={onSelectThread}
          onToggleSessionsCollapsed={onToggleSessionsCollapsed}
          onToggleThreadActions={onToggleThreadActions}
          onToggleThreadPin={onToggleThreadPin}
        />
      </div>
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
    </AppSidebar>
  );
  return <SidebarOrderProvider>
    <SidebarMenuOpenContext.Provider value={menuOpen}>{sidebar}</SidebarMenuOpenContext.Provider>
  </SidebarOrderProvider>;
}

function ProjectSection({ projects, listProps, projectsCollapsed, showEmpty, onCreateProject, onToggleProjectsCollapsed }: {
  projects: WorkspaceProject[];
  listProps: Omit<SidebarProjectListProps, 'projects'>;
  projectsCollapsed: boolean;
  showEmpty: boolean;
  onCreateProject(): void;
  onToggleProjectsCollapsed(): void;
}) {
  const { t } = useI18n();
  return (
    <section className="desktop-agent-sidebar__group">
      <div className="desktop-agent-sidebar__section-head">
        <Button variant="ghost" className="desktop-agent-sidebar__section-title-button" type="button" aria-expanded={!projectsCollapsed} onClick={onToggleProjectsCollapsed}>
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
      <SidebarCollapsibleContent open={!projectsCollapsed}>
        {projectsCollapsed ? null : projects.length
          ? <SidebarProjectList {...listProps} projects={projects} />
          : showEmpty ? <div className="desktop-agent-sidebar__empty">{t('sidebar.emptyProjects')}</div> : null}
      </SidebarCollapsibleContent>
    </section>
  );
}

function GlobalThreadSection({
  pinnedThreadIds,
  activeProjectId,
  activeThreadId,
  runningThreadId,
  globalThreads,
  sessionsCollapsed,
  threadActionMenuId,
  onArchiveThread,
  onCreateGlobalThread,
  threadMenu,
  onOpenThreadInNewWindow,
  onRenameThread,
  onSelectThread,
  onToggleSessionsCollapsed,
  onToggleThreadActions,
  onToggleThreadPin,
}: {
  pinnedThreadIds: ReadonlySet<string>;
  activeProjectId: string | null;
  activeThreadId?: string | null;
  runningThreadId?: string | null;
  globalThreads: RuntimeThreadSummary[];
  sessionsCollapsed: boolean;
  threadActionMenuId: string | null;
  onArchiveThread: (thread: RuntimeThreadSummary) => void;
  onCreateGlobalThread: () => void;
  threadMenu: ThreadMenuState;
  onOpenThreadInNewWindow: (threadId: string) => void;
  onRenameThread: (thread: RuntimeThreadSummary) => void;
  onSelectThread: (threadId: string) => void;
  onToggleSessionsCollapsed: () => void;
  onToggleThreadActions: (threadId: string) => void;
  onToggleThreadPin: (thread: RuntimeThreadSummary) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="desktop-agent-sidebar__group desktop-agent-sidebar__group--sessions">
      <div className="desktop-agent-sidebar__section-head">
        <Button variant="ghost"
          className={`desktop-agent-sidebar__section-title-button ${!activeProjectId ? 'is-active' : ''}`}
          type="button"
          aria-expanded={!sessionsCollapsed}
          onClick={onToggleSessionsCollapsed}
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
      <SidebarCollapsibleContent open={!sessionsCollapsed}>
        {sessionsCollapsed ? null : globalThreads.length ? (
          <SidebarThreadList
            menuThreadId={threadActionMenuId}
            runningThreadId={runningThreadId}
            selectedThreadId={!activeProjectId ? activeThreadId : null}
            threads={globalThreads.filter((thread) => !pinnedThreadIds.has(thread.id))}
            variant="global"
            onArchive={onArchiveThread}
            threadMenu={threadMenu}
            onOpenInNewWindow={onOpenThreadInNewWindow}
            onRename={onRenameThread}
            onSelect={onSelectThread}
            onToggleMenu={onToggleThreadActions}
            onTogglePin={onToggleThreadPin}
          />
        ) : (
          <div className="app-sidebar__list">
            <div className="desktop-agent-sidebar__empty">{t('sidebar.emptyGlobalChats')}</div>
          </div>
        )}
      </SidebarCollapsibleContent>
    </section>
  );
}
