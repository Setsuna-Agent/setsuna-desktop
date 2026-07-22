import type { RuntimeThreadSummary, WorkspaceProject } from '@setsuna-desktop/contracts';
import type { PointerEvent as ReactPointerEvent, Ref } from 'react';
import type { DesktopNavigationState } from '../controller/useDesktopNavigation.js';
import { AgentSidebar } from '../sidebar/AgentSidebar.js';
import type { MainView } from '../types.js';

export function AppSidebarSurface({
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
  onOpenCapabilities,
  onOpenSettings,
  onResetDraft,
  onResizeStep,
  onResizeStart,
}: {
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
  onOpenCapabilities: () => void;
  onOpenSettings: () => void;
  onResetDraft: () => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  if (activeView === 'settings') return null;

  return (
    <AgentSidebar
      activeProjectId={activeProjectId}
      activeThreadId={activeThreadId}
      collapsed={sidebarCollapsed}
      runningThreadId={runningThreadId}
      activeView={activeView === 'capabilities' ? 'capabilities' : 'chat'}
      collapsedProjectIds={navigation.collapsedProjectIds}
      forceExpandedProjectIds={navigation.forceExpandedProjectIds}
      globalThreads={globalThreads}
      projectActionMenuId={navigation.projectActionMenuId}
      projects={projects}
      projectsCollapsed={navigation.projectsCollapsed}
      searchOpen={navigation.sidebarSearchOpen}
      searchTriggerRef={searchTriggerRef}
      selectingProjectDirectory={navigation.selectingProjectDirectory}
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
        onResetDraft();
        navigation.startCurrentThread();
      }}
      onCreateGlobalThread={() => {
        onResetDraft();
        navigation.startGlobalThread();
      }}
      onCreateProjectThread={(projectId) => {
        onResetDraft();
        navigation.startProjectThread(projectId);
      }}
      onEnterChatMode={() => void navigation.enterChatMode()}
      onOpenCapabilities={onOpenCapabilities}
      onOpenSettings={onOpenSettings}
      onRemoveProject={(project) => {
        navigation.setProjectActionMenuId(null);
        void navigation.removeProject(project);
      }}
      onResizeStep={onResizeStep}
      onResizeStart={onResizeStart}
      onSelectDirectory={() => void navigation.selectProjectDirectory()}
      onSelectProject={(project) => void navigation.selectProjectFromSidebar(project)}
      onSelectThread={(threadId) => void navigation.selectThread(threadId)}
      onToggleProjectActions={(projectId) => navigation.setProjectActionMenuId((current) => (current === projectId ? null : projectId))}
      onToggleProjectsCollapsed={() => navigation.setProjectsCollapsed((value) => !value)}
      onToggleSearch={() => navigation.setSidebarSearchOpen((value) => !value)}
      onToggleSessionsCollapsed={() => navigation.setSessionsCollapsed((value) => !value)}
      onToggleThreadActions={(threadId) => navigation.setThreadActionMenuId((current) => (current === threadId ? null : threadId))}
      onRenameThread={navigation.openRenameThread}
    />
  );
}
