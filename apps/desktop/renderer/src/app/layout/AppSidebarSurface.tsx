import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { PointerEvent as ReactPointerEvent, Ref } from 'react';
import type { DesktopNavigationState } from '../controller/useDesktopNavigation.js';
import { AgentSidebar } from '../sidebar/AgentSidebar.js';
import type { ThreadMenuState } from '../thread-menu/useThreadMenu.js';
import type { PinnedThreadsState } from '../sidebar/usePinnedThreads.js';
import type { MainView } from '../types.js';

export function AppSidebarSurface({
  threadMenu,
  pins,
  activeProjectId,
  activeThreadId,
  runningThreadId,
  activeView,
  globalThreads,
  navigation,
  projects,
  searchTriggerRef,
  sidebarCollapsed,
  threadsByProjectId,
  width,
  maxWidth,
  minWidth,
  onResizeStep,
  onResizeStart,
  onOpenThreadInNewWindow,
}: {
  threadMenu: ThreadMenuState;
  pins: PinnedThreadsState;
  activeProjectId: string | null;
  activeThreadId?: string | null;
  runningThreadId?: string | null;
  activeView: MainView;
  globalThreads: RuntimeThreadSummary[];
  navigation: DesktopNavigationState;
  projects: WorkspaceProject[];
  searchTriggerRef: Ref<HTMLButtonElement>;
  sidebarCollapsed: boolean;
  threadsByProjectId: Map<string, RuntimeThreadSummary[]>;
  width: number;
  maxWidth: number;
  minWidth: number;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOpenThreadInNewWindow: (threadId: string) => void;
}) {
  const { pinnedThreadIds, pinnedThreads, togglePinnedThread } = pins;
  if (activeView !== 'chat') return null;

  return (
    <AgentSidebar
      threadMenu={threadMenu}
      activeProjectId={activeProjectId}
      activeThreadId={activeThreadId}
      collapsed={sidebarCollapsed}
      runningThreadId={runningThreadId}
      activeView="chat"
      collapsedProjectIds={navigation.collapsedProjectIds}
      forceExpandedProjectIds={navigation.forceExpandedProjectIds}
      globalThreads={globalThreads}
      pinnedThreadIds={pinnedThreadIds}
      pinnedThreads={pinnedThreads}
      onToggleThreadPin={togglePinnedThread}
      projectActionMenuId={navigation.projectActionMenuId}
      projects={projects}
      projectsCollapsed={navigation.projectsCollapsed}
      searchOpen={navigation.sidebarSearchOpen}
      searchTriggerRef={searchTriggerRef}
      sessionsCollapsed={navigation.sessionsCollapsed}
      threadActionMenuId={navigation.threadActionMenuId}
      threadsByProjectId={threadsByProjectId}
      width={width}
      maxWidth={maxWidth}
      minWidth={minWidth}
      onArchiveThread={(thread) => void navigation.archiveThread(thread)}
      onArchiveProject={(project) => {
        navigation.setProjectActionMenuId(null);
        void navigation.archiveProject(project);
      }}
      onCreateCurrentThread={() => {
        navigation.startCurrentThread();
      }}
      onCreateGlobalThread={() => {
        navigation.startGlobalThread();
      }}
      onCreateProjectThread={(projectId) => {
        navigation.startProjectThread(projectId);
      }}
      onEnterChatMode={() => void navigation.enterChatMode()}
      onEditProject={navigation.editProject}
      onRemoveProject={(project) => {
        navigation.setProjectActionMenuId(null);
        void navigation.removeProject(project);
      }}
      onResizeStep={onResizeStep}
      onResizeStart={onResizeStart}
      onCreateProject={navigation.openCreateProject}
      onToggleProjectCollapsed={navigation.toggleProjectCollapsed}
      onSelectThread={(threadId) => void navigation.selectThread(threadId)}
      onToggleProjectActions={(projectId) => navigation.setProjectActionMenuId((current) => (current === projectId ? null : projectId))}
      onToggleProjectsCollapsed={() => navigation.setProjectsCollapsed((value) => !value)}
      onToggleSearch={() => navigation.setSidebarSearchOpen((value) => !value)}
      onToggleSessionsCollapsed={() => navigation.setSessionsCollapsed((value) => !value)}
      onToggleThreadActions={(threadId) => navigation.setThreadActionMenuId((current) => (current === threadId ? null : threadId))}
      onOpenThreadInNewWindow={onOpenThreadInNewWindow}
      onRenameThread={navigation.openRenameThread}
    />
  );
}
