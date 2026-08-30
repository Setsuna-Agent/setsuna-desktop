import { useCallback, useMemo, useRef, useState } from 'react';
import {
  shellOverlaySlot,
  shellRouteSlot,
  shellSidebarSlot,
  shellTopbarActionsSlot,
  shellTopbarTitleSlot,
  shellWorkspaceToolbarSlot,
} from '@setsuna-desktop/renderer-contracts/shell';
import {
  BROWSER_HOME_URL,
  type BrowserReloadMode,
} from '@setsuna-desktop/feature-browser/contracts';
import type { SettingsSectionId } from '../../features/settings/settings-types.js';
import {
  WorkspaceAppsFeatureBoundary,
  type WorkspaceAppsTopbarHost,
} from '../../composition/WorkspaceAppsFeatureBoundary.js';
import type { DesktopAppController } from '../controller/useDesktopAppController.js';
import type { ConversationOverviewVisibility } from '../types.js';
import {
  browserShortcutTabId,
  useAppKeyboardShortcuts,
  type AppKeyboardShortcutEvent,
  type AppKeyboardShortcutHandlers,
} from '../controller/useAppKeyboardShortcuts.js';
import { useThreadNavigationHistory } from '../controller/useThreadNavigationHistory.js';
import { AppOverlays } from './AppOverlays.js';
import { AppProjectToolbarTitle } from './AppProjectToolbarTitle.js';
import { AppRouteContent } from './AppRouteContent.js';
import { AppSidebarSurface } from './AppSidebarSurface.js';
import { AppTopbarActions } from './AppTopbarActions.js';
import { AppThreadHistoryNavigation } from './AppThreadHistoryNavigation.js';
import { AppWorkspaceToolbar } from './AppWorkspaceToolbar.js';
import { RuntimeErrorNotice, runtimeErrorNoticeMessage } from './RuntimeErrorNotice.js';
import { ShellFrame } from './ShellFrame.js';
import { useSecondaryRoutePrefetch } from './useSecondaryRoutePrefetch.js';
import {
  RendererOwnedSingleSlot,
  useRendererOwnedSlots,
} from '../../kernel/renderer-plugins/RendererKernelProvider.js';

export function AppReadyLayout({ controller }: { controller: DesktopAppController }) {
  const slots = useRendererOwnedSlots();
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
  const currentThread = runtime.currentThread;
  const threadHistory = useThreadNavigationHistory({
    currentThreadId: currentThread?.id ?? null,
    onOpenThread: navigation.selectThread,
  });
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
    setSettingsInitialSection('model-provider');
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
  const activeBrowserPanelId = workspacePanels.browserPanelInstances.find((instance) => (
    instance.active && instance.panel.browser?.url !== BROWSER_HOME_URL
  ))?.panel.id ?? null;
  const reloadBrowserPanel = useCallback((
    mode: BrowserReloadMode,
    event: AppKeyboardShortcutEvent,
  ) => {
    const browserPanelId = browserShortcutTabId(event, activeBrowserPanelId);
    if (!browserPanelId) return;
    void window.setsunaDesktop?.browser.reloadTab(browserPanelId, mode).catch(() => undefined);
  }, [activeBrowserPanelId]);
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
    'navigation.goBack': {
      enabled: threadHistory.canGoBack,
      execute: threadHistory.goBack,
    },
    'navigation.goForward': {
      enabled: threadHistory.canGoForward,
      execute: threadHistory.goForward,
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
    'workspace.openTerminal': {
      enabled: activeView === 'chat' && Boolean(activeWorkspace?.path),
      execute: () => workspacePanels.openDesktopPanel('side', 'terminal'),
    },
    'workspace.openSideChat': {
      enabled: activeView === 'chat',
      execute: () => workspacePanels.openDesktopPanel('side', 'chat'),
    },
    'workspace.openBrowser': {
      enabled: activeView === 'chat',
      execute: () => workspacePanels.openBrowserPanel(),
    },
    'workspace.openConversationDebug': {
      enabled: activeView === 'chat' && workspacePanels.conversationDebugEnabled,
      execute: () => workspacePanels.openDesktopPanel('side', 'conversation-debug'),
    },
    'browser.reload': {
      enabled: activeView === 'chat' && Boolean(activeBrowserPanelId),
      execute: (event) => reloadBrowserPanel('normal', event),
    },
    'browser.hardReload': {
      enabled: activeView === 'chat' && Boolean(activeBrowserPanelId),
      execute: (event) => reloadBrowserPanel('hard', event),
    },
  }), [
    activeBrowserPanelId,
    activeView,
    activeWorkspace,
    chatActions,
    handleToggleConversationOverview,
    handleToggleSidebar,
    navigation,
    openCapabilities,
    openFilesPanel,
    openReviewPanel,
    reloadBrowserPanel,
    runtime.activeTurnId,
    runtime.currentThread,
    runtimeActivityOpen,
    setActiveView,
    threadHistory.canGoBack,
    threadHistory.canGoForward,
    threadHistory.goBack,
    threadHistory.goForward,
    windowMenuActions,
    workspacePanels.toggleBottomTerminal,
    workspacePanels.conversationDebugEnabled,
    workspacePanels.openBrowserPanel,
    workspacePanels.openDesktopPanel,
    workspacePanels.toggleSidePanel,
  ]);
  useAppKeyboardShortcuts(shortcutHandlers);
  useSecondaryRoutePrefetch();
  const workspaceAppsTopbarHost = useMemo<WorkspaceAppsTopbarHost | null>(() => (
    activeWorkspace?.path ? {
      selectedWorkspaceApp: workspacePanels.selectedWorkspaceApp,
      workspaceAppMenuOpen: workspacePanels.workspaceAppMenuOpen,
      workspaceApps: workspacePanels.workspaceApps,
      openCurrentWorkspaceApp: () => {
        workspacePanels.closeWorkspaceMenus();
        void workspacePanels.openSelectedWorkspaceApp();
      },
      selectWorkspaceApp: workspacePanels.selectWorkspaceApp,
      toggleWorkspaceAppMenu: workspacePanels.toggleWorkspaceAppMenu,
    } : null
  ), [activeWorkspace?.path, workspacePanels]);

  return (
    <ShellFrame
      rootRef={shellRef}
      inspectorOpen={workspacePanelReservesLayout}
      style={shellStyle}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={handleToggleSidebar}
      showSidebarToggle={activeView !== 'settings'}
      navigationActions={activeView !== 'settings' ? (
        <AppThreadHistoryNavigation
          canGoBack={threadHistory.canGoBack}
          canGoForward={threadHistory.canGoForward}
          onGoBack={threadHistory.goBack}
          onGoForward={threadHistory.goForward}
        />
      ) : undefined}
      toolbarTitle={(
        <RendererOwnedSingleSlot
          slot={shellTopbarTitleSlot}
          props={{
            renderDefault: () => activeView === 'chat' && activeProject ? (
              <AppProjectToolbarTitle
                key={activeProject.id}
                project={activeProject}
                title={toolbarTitle ?? activeProject.name}
                archiveThreadDisabled={Boolean(currentThread?.activeTurnId)}
                onArchiveThread={currentThread
                  ? () => void navigation.archiveThread(currentThread)
                  : undefined}
                onRenameThread={currentThread
                  ? () => navigation.openRenameThread(currentThread)
                  : undefined}
              />
            ) : toolbarTitle,
          }}
        />
      )}
      workspaceToolbar={(
        <RendererOwnedSingleSlot
          slot={shellWorkspaceToolbarSlot}
          props={{
            renderDefault: () => activeView === 'chat'
              ? <AppWorkspaceToolbar projectWorkspace={projectWorkspace} workspacePanels={workspacePanels} />
              : undefined,
          }}
        />
      )}
      menuActions={windowMenuActions}
      className={shellClassName}
      actions={(
        <WorkspaceAppsFeatureBoundary host={workspaceAppsTopbarHost}>
          <RendererOwnedSingleSlot
            slot={shellTopbarActionsSlot}
            props={{
              renderDefault: () => activeView === 'chat' ? (
                <AppTopbarActions
                  activeView={activeView}
                  bottomPanelVisible={workspacePanels.bottomPanelVisible}
                  bottomTerminalPanelActive={workspacePanels.bottomTerminalPanelActive}
                  conversationOverviewAvailable={Boolean(runtime.currentThread)}
                  conversationOverviewVisible={conversationOverviewRendered}
                  sidePanelVisible={workspacePanels.sidePanelVisible}
                  onToggleConversationOverview={handleToggleConversationOverview}
                  onToggleSidePanel={workspacePanels.toggleSidePanel}
                  onToggleBottomTerminal={workspacePanels.toggleBottomTerminal}
                />
              ) : undefined,
            }}
          />
        </WorkspaceAppsFeatureBoundary>
      )}
    >
      <RendererOwnedSingleSlot
        slot={shellSidebarSlot}
        props={{
          renderDefault: () => <AppSidebarSurface
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
        onOpenRuntimeActivity={() => setRuntimeActivityOpen(true)}
        onOpenSettings={openSettings}
        onResetDraft={resetComposer}
        onResizeStep={handleSidebarResizeStep}
        onResizeStart={handleSidebarResizeStart}
        runtimeActivityTriggerRef={runtimeActivityTriggerRef}
          />,
        }}
      />

      {slots.keyed(shellRouteSlot, activeView, {
        routeId: activeView,
        renderDefault: () => (
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
        setActiveView={setActiveView}
        setDraft={setDraft}
        skillSelectionRequest={skillSelectionRequest}
        startCurrentThreadReview={startCurrentThreadReview}
        workspacePanels={workspacePanels}
        onSelectSkillForChat={selectSkillForChat}
        onOpenPlugin={openCapabilitiesPlugin}
        onSelectedCapabilitiesPluginIdChange={setSelectedCapabilitiesPluginId}
        onConversationOverviewRenderedChange={setConversationOverviewRendered}
        onFocusComposerRequestConsumed={consumeFocusComposerRequest}
        onOpenModelSettings={openModelSettings}
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
        ),
      })}

      {visibleRuntimeError ? (
        <RuntimeErrorNotice message={visibleRuntimeError} onDismiss={() => runtime.setError(null)} />
      ) : null}

      <RendererOwnedSingleSlot
        slot={shellOverlaySlot}
        props={{
          renderDefault: () => (
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
          ),
        }}
      />
    </ShellFrame>
  );
}
