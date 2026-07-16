import { useCallback, useMemo, useState } from 'react';
import { AppRouteContent } from './AppRouteContent.js';
import { AppSidebarSurface } from './AppSidebarSurface.js';
import { AppTopbarActions } from './AppTopbarActions.js';
import { AppWorkspaceToolbar } from './AppWorkspaceToolbar.js';
import { AppOverlays } from './AppOverlays.js';
import { ShellFrame } from './ShellFrame.js';
import { WorkspaceAppLauncher } from '../workspace/WorkspaceAppLauncher.js';
import type { DesktopAppController } from '../../hooks/useDesktopAppController.js';
import type { ConversationOverviewVisibility } from '../../types/app.js';

export function AppReadyLayout({ controller }: { controller: DesktopAppController }) {
  const {
    activeProject,
    activeProjectId,
    activeWorkspace,
    activeView,
    chatActions,
    clearSkillSelectionRequest,
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
    selectSkillForChat,
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
    skillSelectionRequest,
    terminalMaxHeight,
    terminalHeight,
    terminalMinHeight,
    threadsByProjectId,
    toolbarTitle,
    workspaceMaxWidth,
    workspaceMinWidth,
    workspacePanelReservesLayout,
    workspaceWidth,
    workspacePanels,
  } = controller;
  const [conversationOverviewVisibility, setConversationOverviewVisibility] = useState<ConversationOverviewVisibility>('auto');
  const [conversationOverviewRendered, setConversationOverviewRendered] = useState(false);
  const [conversationOverviewShowRequest, setConversationOverviewShowRequest] = useState(0);
  const handleToggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), [setSidebarCollapsed]);
  const handleToggleConversationOverview = useCallback(() => {
    if (conversationOverviewRendered) {
      setConversationOverviewVisibility('hidden');
      return;
    }
    setConversationOverviewVisibility('shown');
    setConversationOverviewShowRequest((value) => value + 1);
  }, [conversationOverviewRendered]);
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
      inspectorOpen={workspacePanelReservesLayout}
      style={shellStyle}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={handleToggleSidebar}
      showSidebarToggle={activeView !== 'settings'}
      toolbarTitle={toolbarTitle}
      workspaceToolbar={activeView === 'chat' ? <AppWorkspaceToolbar activeProject={activeWorkspace} projectWorkspace={projectWorkspace} workspacePanels={workspacePanels} /> : undefined}
      menuActions={windowMenuActions}
      className={shellClassName}
      actions={
        activeView === 'chat' ? (
          <>
            {activeWorkspace?.path ? (
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
              updater={controller.updater}
              bottomTerminalPanelOpen={workspacePanels.bottomTerminalPanelOpen}
              conversationOverviewAvailable={Boolean(runtime.currentThread)}
              conversationOverviewVisible={conversationOverviewRendered}
              sidePanelVisible={workspacePanels.sidePanelVisible}
              onToggleConversationOverview={handleToggleConversationOverview}
              onToggleSidePanel={workspacePanels.toggleSidePanel}
              onToggleBottomTerminal={workspacePanels.toggleBottomTerminal}
            />
          </>
        ) : undefined
      }
    >
      <AppSidebarSurface
        activeProjectId={activeProjectId}
        activeThreadId={runtime.currentThread?.id}
        runningThreadId={(runtime.activeTurnId || runtime.currentThread?.activeTurnId) ? runtime.currentThread?.id ?? null : null}
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
        activeWorkspace={activeWorkspace}
        activeView={activeView}
        chatActions={chatActions}
        conversationOverviewShowRequest={conversationOverviewShowRequest}
        conversationOverviewVisibility={conversationOverviewVisibility}
        draft={draft}
        projectWorkspace={projectWorkspace}
        runtime={runtime}
        setActiveView={setActiveView}
        setDraft={setDraft}
        skillSelectionRequest={skillSelectionRequest}
        updater={controller.updater}
        workspacePanels={workspacePanels}
        onSelectSkillForChat={selectSkillForChat}
        onConversationOverviewRenderedChange={setConversationOverviewRendered}
        onSelectThread={navigation.selectThread}
        onSkillSelectionRequestConsumed={clearSkillSelectionRequest}
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
