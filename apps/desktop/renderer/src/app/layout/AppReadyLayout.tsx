import { useCallback, useMemo, useRef, useState } from 'react';
import { RuntimeActivityTrigger } from '../../features/runtime-activity/RuntimeActivityTrigger.js';
import type { SettingsSectionId } from '../../features/settings/settings-types.js';
import { WorkspaceAppLauncher } from '../../features/workspace/WorkspaceAppLauncher.js';
import type { DesktopAppController } from '../controller/useDesktopAppController.js';
import type { ConversationOverviewVisibility } from '../types.js';
import { useAppKeyboardShortcuts, type AppKeyboardShortcutHandlers } from '../controller/useAppKeyboardShortcuts.js';
import { AppOverlays } from './AppOverlays.js';
import { AppRouteContent } from './AppRouteContent.js';
import { AppSidebarSurface } from './AppSidebarSurface.js';
import { AppTopbarActions } from './AppTopbarActions.js';
import { AppWorkspaceToolbar } from './AppWorkspaceToolbar.js';
import { RuntimeErrorNotice, runtimeErrorNoticeMessage } from './RuntimeErrorNotice.js';
import { ShellFrame } from './ShellFrame.js';

export function AppReadyLayout({ controller }: { controller: DesktopAppController }) {
  const {
    activeProject,
    activeProjectId,
    activeWorkspace,
    activeView,
    chatActions,
    clearSkillSelectionRequest,
    composerKey,
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
    resetComposer,
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
    startCurrentThreadReview,
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
  const [selectedCapabilitiesPluginId, setSelectedCapabilitiesPluginId] = useState<string | null>(null);
  // 记录下一次进入设置页时应定位到的分区；普通入口会先清空，避免上一次的直达请求残留。
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId | null>(null);
  const [runtimeActivityOpen, setRuntimeActivityOpen] = useState(false);
  const [focusComposerRequest, setFocusComposerRequest] = useState(0);
  const consumeFocusComposerRequest = useCallback((requestId: number) => {
    setFocusComposerRequest((current) => current === requestId ? 0 : current);
  }, []);
  const runtimeActivityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const visibleRuntimeError = runtimeErrorNoticeMessage(runtime.error, runtime.currentThread);
  const handleToggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), [setSidebarCollapsed]);
  const handleToggleConversationOverview = useCallback(() => {
    if (conversationOverviewRendered) {
      setConversationOverviewVisibility('hidden');
      return;
    }
    setConversationOverviewVisibility('shown');
    setConversationOverviewShowRequest((value) => value + 1);
  }, [conversationOverviewRendered]);
  const openCapabilities = useCallback(() => {
    setSelectedCapabilitiesPluginId(null);
    setActiveView('capabilities');
  }, [setActiveView]);
  const openCapabilitiesPlugin = useCallback((pluginId: string) => {
    setSelectedCapabilitiesPluginId(pluginId);
    setActiveView('capabilities');
  }, [setActiveView]);
  const openSettings = useCallback(() => {
    setSettingsInitialSection(null);
    setActiveView('settings');
  }, [setActiveView]);
  const openModelSettings = useCallback(() => {
    setSettingsInitialSection('localLlm');
    setActiveView('settings');
  }, [setActiveView]);
  const openFilesPanel = useCallback(() => {
    if (!activeWorkspace?.path) return;
    workspacePanels.closeWorkspaceMenus();
    projectWorkspace.setFilePreview(null);
    if (!workspacePanels.activateDesktopPanelByType('files')) {
      workspacePanels.openDesktopPanel('side', 'files');
    }
  }, [activeWorkspace?.path, projectWorkspace, workspacePanels]);
  const openReviewPanel = useCallback(() => {
    if (!activeWorkspace) return;
    workspacePanels.closeWorkspaceMenus();
    if (!workspacePanels.activateDesktopPanelByType('review')) {
      workspacePanels.openDesktopPanel('side', 'review');
    }
    void workspacePanels.loadReviewState();
  }, [activeWorkspace, workspacePanels]);
  const windowMenuActions = useMemo(
    () => ({
      onNewChat: () => {
        resetComposer();
        navigation.startCurrentThread();
      },
      onOpenCapabilities: openCapabilities,
      onOpenSettings: openSettings,
    }),
    [navigation, openCapabilities, openSettings, resetComposer],
  );
  const shortcutHandlers = useMemo<AppKeyboardShortcutHandlers>(() => ({
    'app.newChat': {
      execute: windowMenuActions.onNewChat,
    },
    'app.searchChats': {
      execute: () => {
        setActiveView('chat');
        navigation.setSidebarSearchOpen(true);
      },
    },
    'app.addProject': {
      execute: navigation.openCreateProject,
    },
    'app.openSettings': {
      execute: windowMenuActions.onOpenSettings,
    },
    'app.openCapabilities': {
      execute: openCapabilities,
    },
    'app.toggleRuntimeActivity': {
      allowInModal: runtimeActivityOpen,
      execute: () => setRuntimeActivityOpen((open) => !open),
    },
    'layout.toggleSidebar': {
      enabled: activeView !== 'settings',
      execute: handleToggleSidebar,
    },
    'layout.toggleWorkspace': {
      enabled: activeView === 'chat',
      execute: workspacePanels.toggleSidePanel,
    },
    'layout.toggleTerminal': {
      allowInTerminal: true,
      enabled: activeView === 'chat',
      execute: workspacePanels.toggleBottomTerminal,
    },
    'chat.focusComposer': {
      allowInTerminal: true,
      execute: () => {
        setActiveView('chat');
        setFocusComposerRequest((request) => request + 1);
      },
    },
    'chat.cancelTurn': {
      allowInModal: true,
      allowInTerminal: true,
      enabled: Boolean(runtime.activeTurnId),
      execute: () => void chatActions.cancelActiveTurn(),
    },
    'chat.toggleOverview': {
      enabled: activeView === 'chat' && Boolean(runtime.currentThread),
      execute: handleToggleConversationOverview,
    },
    'workspace.openFiles': {
      enabled: activeView === 'chat' && Boolean(activeWorkspace?.path),
      execute: openFilesPanel,
    },
    'workspace.openReview': {
      enabled: activeView === 'chat' && Boolean(activeWorkspace),
      execute: openReviewPanel,
    },
  }), [
    activeView,
    activeWorkspace,
    chatActions,
    handleToggleConversationOverview,
    handleToggleSidebar,
    navigation,
    openCapabilities,
    openFilesPanel,
    openReviewPanel,
    runtime.activeTurnId,
    runtime.currentThread,
    runtimeActivityOpen,
    setActiveView,
    windowMenuActions,
    workspacePanels.toggleBottomTerminal,
    workspacePanels.toggleSidePanel,
  ]);
  useAppKeyboardShortcuts(shortcutHandlers);

  return (
    <ShellFrame
      rootRef={shellRef}
      inspectorOpen={workspacePanelReservesLayout}
      style={shellStyle}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={handleToggleSidebar}
      showSidebarToggle={activeView !== 'settings'}
      navigationActions={(
        <RuntimeActivityTrigger
          open={runtimeActivityOpen}
          triggerRef={runtimeActivityTriggerRef}
          onToggle={() => setRuntimeActivityOpen((open) => !open)}
        />
      )}
      toolbarTitle={toolbarTitle}
      workspaceToolbar={activeView === 'chat' ? <AppWorkspaceToolbar projectWorkspace={projectWorkspace} workspacePanels={workspacePanels} /> : undefined}
      menuActions={windowMenuActions}
      className={shellClassName}
      actions={activeView === 'chat' ? (
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
            bottomPanelVisible={workspacePanels.bottomPanelVisible}
            conversationOverviewAvailable={Boolean(runtime.currentThread)}
            conversationOverviewVisible={conversationOverviewRendered}
            sidePanelVisible={workspacePanels.sidePanelVisible}
            onToggleConversationOverview={handleToggleConversationOverview}
            onToggleSidePanel={workspacePanels.toggleSidePanel}
            onToggleBottomTerminal={workspacePanels.toggleBottomTerminal}
          />
        </>
      ) : undefined}
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
        onOpenCapabilities={openCapabilities}
        onOpenSettings={openSettings}
        onResetDraft={resetComposer}
        onResizeStep={handleSidebarResizeStep}
        onResizeStart={handleSidebarResizeStart}
      />

      <AppRouteContent
        activeProject={activeProject}
        activeWorkspace={activeWorkspace}
        activeView={activeView}
        selectedCapabilitiesPluginId={selectedCapabilitiesPluginId}
        settingsInitialSection={settingsInitialSection}
        chatActions={chatActions}
        composerKey={composerKey}
        focusComposerRequest={focusComposerRequest}
        conversationOverviewShowRequest={conversationOverviewShowRequest}
        conversationOverviewVisibility={conversationOverviewVisibility}
        draft={draft}
        projectWorkspace={projectWorkspace}
        runtime={runtime}
        networkProxy={controller.networkProxy}
        setActiveView={setActiveView}
        setDraft={setDraft}
        skillSelectionRequest={skillSelectionRequest}
        startCurrentThreadReview={startCurrentThreadReview}
        updater={controller.updater}
        workspacePanels={workspacePanels}
        onSelectSkillForChat={selectSkillForChat}
        onOpenPlugin={openCapabilitiesPlugin}
        onSelectedCapabilitiesPluginIdChange={setSelectedCapabilitiesPluginId}
        onConversationOverviewRenderedChange={setConversationOverviewRendered}
        onFocusComposerRequestConsumed={consumeFocusComposerRequest}
        onOpenModelSettings={openModelSettings}
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

      {visibleRuntimeError ? (
        <RuntimeErrorNotice message={visibleRuntimeError} onDismiss={() => runtime.setError(null)} />
      ) : null}

      <AppOverlays
        client={runtime.client}
        navigation={navigation}
        projects={runtime.projects}
        runtimeActivityOpen={runtimeActivityOpen}
        runtimeActivityTriggerRef={runtimeActivityTriggerRef}
        searchTriggerRef={searchTriggerRef}
        threads={runtime.threads}
        onActivitiesChanged={runtime.reloadThreads}
        onCloseRuntimeActivity={() => setRuntimeActivityOpen(false)}
        onOpenThread={navigation.selectThread}
      />
    </ShellFrame>
  );
}
