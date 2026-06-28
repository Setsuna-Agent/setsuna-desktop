import { useCallback, useMemo } from 'react';
import { AppRouteContent } from './AppRouteContent.js';
import { AppSidebarSurface } from './AppSidebarSurface.js';
import { AppTopbarActions } from './AppTopbarActions.js';
import { AppWorkspaceToolbar } from './AppWorkspaceToolbar.js';
import { AppOverlays } from './AppOverlays.js';
import { ShellFrame } from './ShellFrame.js';
import { WorkspaceAppLauncher } from '../workspace/WorkspaceAppLauncher.js';
import type { DesktopAppController } from '../../hooks/useDesktopAppController.js';

export function AppReadyLayout({ controller }: { controller: DesktopAppController }) {
  const {
    activeProject,
    activeProjectId,
    activeView,
    chatActions,
    draft,
    globalThreads,
    handleSidebarResizeStep,
    handleSidebarResizeStart,
    handleTerminalResizeStep,
    handleTerminalResizeStart,
    handleWorkspaceResizeStep,
    handleWorkspaceResizeStart,
    navigation,
    projectWorkspace,
    runtime,
    searchTriggerRef,
    setActiveView,
    setDraft,
    setSidebarCollapsed,
    shellClassName,
    shellRef,
    shellStyle,
    sidebarCollapsed,
    sidebarMaxWidth,
    sidebarMinWidth,
    sidebarWidth,
    terminalMaxHeight,
    terminalHeight,
    terminalMinHeight,
    threadsByProjectId,
    toolbarTitle,
    workspaceMaxWidth,
    workspaceMinWidth,
    workspaceWidth,
    workspacePanels,
  } = controller;
  const handleToggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), [setSidebarCollapsed]);
  const windowMenuActions = useMemo(
    () => ({
      onNewChat: () => {
        setDraft('');
        navigation.startCurrentThread();
      },
      onOpenCapabilities: () => setActiveView('capabilities'),
      onOpenSettings: () => setActiveView('settings'),
    }),
    [navigation, setActiveView, setDraft],
  );

  return (
    <ShellFrame
      rootRef={shellRef}
      inspectorOpen={workspacePanels.sidePanelVisible}
      style={shellStyle}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={handleToggleSidebar}
      toolbarTitle={toolbarTitle}
      workspaceToolbar={<AppWorkspaceToolbar activeProject={activeProject} projectWorkspace={projectWorkspace} workspacePanels={workspacePanels} />}
      menuActions={windowMenuActions}
      className={shellClassName}
      actions={
        <>
          {activeView === 'chat' && activeProject?.path ? (
            <WorkspaceAppLauncher
              selectedWorkspaceApp={workspacePanels.selectedWorkspaceApp}
              workspaceAppMenuOpen={workspacePanels.workspaceAppMenuOpen}
              workspaceApps={workspacePanels.workspaceApps}
              onOpenCurrentWorkspaceApp={() => {
                workspacePanels.closeWorkspaceMenus();
                void workspacePanels.openSelectedWorkspaceApp();
              }}
              onSelectWorkspaceApp={workspacePanels.selectWorkspaceApp}
              onToggleWorkspaceAppMenu={workspacePanels.toggleWorkspaceAppMenu}
            />
          ) : null}
          <AppTopbarActions
            activeView={activeView}
            hasProject={Boolean(activeProject)}
            bottomTerminalPanelOpen={workspacePanels.bottomTerminalPanelOpen}
            sidePanelVisible={workspacePanels.sidePanelVisible}
            onToggleSidePanel={workspacePanels.toggleSidePanel}
            onToggleBottomTerminal={workspacePanels.toggleBottomTerminal}
          />
        </>
      }
    >
      <AppSidebarSurface
        activeProjectId={activeProjectId}
        activeThreadId={runtime.currentThread?.id}
        activeView={activeView}
        globalThreads={globalThreads}
        navigation={navigation}
        projects={runtime.projects}
        searchTriggerRef={searchTriggerRef}
        sidebarCollapsed={sidebarCollapsed}
        threadsByProjectId={threadsByProjectId}
        width={sidebarWidth}
        maxWidth={sidebarMaxWidth}
        minWidth={sidebarMinWidth}
        onOpenCapabilities={() => setActiveView('capabilities')}
        onOpenSettings={() => setActiveView('settings')}
        onResetDraft={() => setDraft('')}
        onResizeStep={handleSidebarResizeStep}
        onResizeStart={handleSidebarResizeStart}
      />

      <AppRouteContent
        activeProject={activeProject}
        activeView={activeView}
        chatActions={chatActions}
        draft={draft}
        projectWorkspace={projectWorkspace}
        runtime={runtime}
        setActiveView={setActiveView}
        setDraft={setDraft}
        workspacePanels={workspacePanels}
        onTerminalResizeStart={handleTerminalResizeStart}
        onTerminalResizeStep={handleTerminalResizeStep}
        terminalHeight={terminalHeight}
        terminalMaxHeight={terminalMaxHeight}
        terminalMinHeight={terminalMinHeight}
        onWorkspaceResizeStart={handleWorkspaceResizeStart}
        onWorkspaceResizeStep={handleWorkspaceResizeStep}
        workspaceMaxWidth={workspaceMaxWidth}
        workspaceMinWidth={workspaceMinWidth}
        workspaceWidth={workspaceWidth}
      />

      <AppOverlays
        client={runtime.client}
        navigation={navigation}
        projects={runtime.projects}
        searchTriggerRef={searchTriggerRef}
        threads={runtime.threads}
      />
    </ShellFrame>
  );
}
