import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserSettingsNavigationProvider } from '../../composition/BrowserWorkspaceFeatureBoundary.js';
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
import type { DesktopAppController } from '../controller/useDesktopAppController.js';
import type { ConversationOverviewVisibility } from '../types.js';
import {
  browserShortcutTabId,
  useAppKeyboardShortcuts,
  type AppKeyboardShortcutEvent,
  type AppKeyboardShortcutHandlers,
} from '../controller/useAppKeyboardShortcuts.js';
import { useAppNavigationHistory, type AppNavigationLocation } from '../controller/useAppNavigationHistory.js';
import { useSidebarThreadNavigation } from '../controller/useSidebarThreadNavigation.js';
import { useToast } from '../providers/ToastProvider.js';
import { usePinnedThreads } from '../sidebar/usePinnedThreads.js';
import { useThreadMenu } from '../thread-menu/useThreadMenu.js';
import { AppOverlays } from './AppOverlays.js';
import { AppChatToolbarTitle } from './AppChatToolbarTitle.js';
import { AppRouteContent } from './AppRouteContent.js';
import { AppSidebarSurface } from './AppSidebarSurface.js';
import { AppNavigationRail } from './AppNavigationRail.js';
import { AppTopbarActions } from './AppTopbarActions.js';
import { AppThreadHistoryNavigation } from './AppThreadHistoryNavigation.js';
import { AppWorkspaceToolbar } from './AppWorkspaceToolbar.js';
import { RuntimeErrorNotice, runtimeErrorNoticeMessage } from './RuntimeErrorNotice.js';
import { MissingWorktreeDialog } from '../../features/workspace/MissingWorktreeDialog.js';
import { ShellFrame } from './ShellFrame.js';
import { AppMenuBar } from './AppMenuBar.js';
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
    fileWorkspace,
    activeView,
    chatActions,
    clearCapabilitySelectionRequest,
    composerKey,
    draft,
    draftSkillReferences,
    globalThreads,
    handleSidebarResizeStep,
    handleSidebarResizeStart,
    handleTerminalResizeStep,
    handleTerminalResizeStart,
    handleWorkspaceResizeStep,
    handleWorkspaceResizeStart,
    navigation,
    newThreadDraftId,
    projectWorkspace,
    attachmentStore,
    runtime,
    searchTriggerRef,
    selectSkillForChat,
    selectPluginForChat,
    startPluginAppChat,
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
    capabilitySelectionRequest,
    startCurrentThreadReview,
    terminalMaxHeight,
    terminalHeight,
    terminalMinHeight,
    threadsByProjectId,
    toolbarTitle,
    toggleWorkspaceMaximized,
    workspaceMaxWidth,
    workspaceMaximized,
    workspaceMinWidth,
    workspacePanelReservesLayout,
    workspaceWidth,
    workspacePanels,
  } = controller;
  const [conversationOverviewVisibility, setConversationOverviewVisibility] = useState<ConversationOverviewVisibility>('auto');
  const [conversationOverviewRendered, setConversationOverviewRendered] = useState(false);
  const [selectedCapabilitiesPluginId, setSelectedCapabilitiesPluginId] = useState<string | null>(null);
  const [selectedPluginViewKey, setSelectedPluginViewKey] = useState<string | null>(null);
  // 记录下一次进入设置页时应定位到的分区；普通入口会先清空，避免上一次的直达请求残留。
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSectionId | null>(null);
  const [runtimeActivityOpen, setRuntimeActivityOpen] = useState(false);
  const [focusComposerRequest, setFocusComposerRequest] = useState(0);
  const [findInChatRequest, setFindInChatRequest] = useState(0);
  const consumeFindInChatRequest = useCallback((requestId: number) => {
    setFindInChatRequest((current) => current === requestId ? 0 : current);
  }, []);
  const consumeFocusComposerRequest = useCallback((requestId: number) => {
    setFocusComposerRequest((current) => current === requestId ? 0 : current);
  }, []);
  const runtimeActivityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const themeToggleTriggerRef = useRef<HTMLButtonElement | null>(null);
  const currentThread = runtime.currentThread;
  const toast = useToast();
  const pins = usePinnedThreads(runtime.projects, threadsByProjectId, globalThreads);
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  useEffect(() => setToolbarMenuOpen(false), [activeView, activeProjectId, currentThread?.id]);
  // Both entry points share one pending-fork guard and the target's actual workspace.
  const threadMenu = useThreadMenu({
    client: runtime.client,
    threadId: activeView === 'chat'
      ? navigation.threadActionMenuId ?? (toolbarMenuOpen ? currentThread?.id ?? null : null)
      : null,
    onFork: navigation.forkThreadFromId,
    onDelete: navigation.deleteThread,
    onClose: () => navigation.setThreadActionMenuId(null),
    onError: toast.error,
  });
  const openThreadInNewWindow = useCallback((threadId: string) => {
    void window.setsunaDesktop?.windowControls.openThread(threadId).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  }, [toast]);
  const sidebarNavigation = useSidebarThreadNavigation({
    currentThreadId: currentThread?.id ?? null,
    onOpenThread: navigation.selectThread,
    onError: runtime.setError,
  });
  const historyLocation: AppNavigationLocation = activeView === 'chat'
    ? {
        view: activeView, threadId: currentThread?.id ?? null,
        projectId: currentThread ? currentThread.projectId ?? null : activeProjectId,
        ...(!currentThread && newThreadDraftId ? { draftId: newThreadDraftId } : {}),
      }
    : activeView === 'capabilities'
      ? { view: activeView, pluginId: selectedCapabilitiesPluginId }
      : activeView === 'plugin'
        ? { view: activeView, viewKey: selectedPluginViewKey }
        : { view: activeView };
  const openHistoryLocation = useCallback(async (location: AppNavigationLocation) => {
    if (location.view === 'chat') {
      if (location.threadId) {
        if (currentThread?.id === location.threadId) await navigation.changeView('chat');
        else await navigation.selectThreadInView(location.threadId, 'chat');
      } else if (!currentThread && activeProjectId === location.projectId && newThreadDraftId === (location.draftId ?? null)) {
        await navigation.changeView('chat');
      } else if (location.projectId && runtime.projects.some((project) => project.id === location.projectId)) {
        await navigation.startProjectThread(location.projectId, location.draftId);
      } else {
        await navigation.startGlobalThread(() => location.draftId);
      }
      return;
    }
    if (location.view === 'capabilities') setSelectedCapabilitiesPluginId(location.pluginId);
    if (location.view === 'plugin') setSelectedPluginViewKey(location.viewKey);
    await navigation.changeView(location.view);
  }, [activeProjectId, currentThread, navigation, newThreadDraftId, runtime.projects]);
  const reportHistoryError = useCallback((error: unknown) => {
    runtime.setError(error instanceof Error ? error.message : String(error));
  }, [runtime.setError]);
  const appHistory = useAppNavigationHistory({
    location: historyLocation,
    onNavigate: openHistoryLocation,
    onError: reportHistoryError,
  });
  const visibleRuntimeError = runtimeErrorNoticeMessage(runtime.error, runtime.currentThread);
  const handleToggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), [setSidebarCollapsed]);
  const handleToggleConversationOverview = useCallback(() => {
    if (conversationOverviewRendered) {
      setConversationOverviewVisibility('hidden');
      return;
    }
    setConversationOverviewVisibility('shown');
  }, [conversationOverviewRendered]);
  const openCapabilities = useCallback(() => {
    setSelectedCapabilitiesPluginId(null);
    setActiveView('capabilities');
  }, [setActiveView]);
  const openChat = useCallback(() => setActiveView('chat'), [setActiveView]);
  const openPullRequests = useCallback(() => setActiveView('pull-requests'), [setActiveView]);
  const openAutomation = useCallback(() => setActiveView('automation'), [setActiveView]);
  const openCapabilitiesPlugin = useCallback((pluginId: string) => {
    setSelectedCapabilitiesPluginId(pluginId);
    setActiveView('capabilities');
  }, [setActiveView]);
  const openPluginView = useCallback((viewKey: string) => {
    setSelectedPluginViewKey(viewKey);
    setActiveView('plugin');
  }, [setActiveView]);
  const openSettings = useCallback(() => {
    setSettingsInitialSection(null);
    setActiveView('settings');
  }, [setActiveView]);
  const openModelSettings = useCallback(() => {
    setSettingsInitialSection('model-provider');
    setActiveView('settings');
  }, [setActiveView]);
  const openFilesPanel = useCallback(async () => {
    if (!activeWorkspace?.path) return;
    workspacePanels.closeWorkspaceMenus();
    if (!await projectWorkspace.setFilePreview(null)) return;
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
  const openChangesPanel = useCallback(() => {
    if (!activeWorkspace?.path) return;
    workspacePanels.closeWorkspaceMenus();
    if (!workspacePanels.activateDesktopPanelByType('changes')) {
      workspacePanels.openDesktopPanel('side', 'changes');
    }
    void workspacePanels.loadReviewState();
  }, [activeWorkspace?.path, workspacePanels]);
  const activeBrowserPanelId = workspacePanels.browserPanelInstances.find((instance) => (
    instance.active && instance.panel.browser?.url !== BROWSER_HOME_URL
  ))?.panel.id ?? null;
  const hasActiveBrowserPanel = workspacePanels.browserPanelInstances.some((instance) => instance.active);
  const reloadBrowserPanel = useCallback((
    mode: BrowserReloadMode,
    event?: AppKeyboardShortcutEvent,
  ) => {
    const browserPanelId = browserShortcutTabId(event, activeBrowserPanelId);
    if (!browserPanelId) return;
    void window.setsunaDesktop?.browser.reloadTab(browserPanelId, mode).catch(() => undefined);
  }, [activeBrowserPanelId]);
  const startNewChat = useCallback(() => {
    navigation.startCurrentThread();
  }, [navigation]);
  const shortcutHandlers = useMemo<AppKeyboardShortcutHandlers>(() => ({
    'app.newChat': {
      execute: startNewChat,
    },
    'app.searchChats': {
      execute: () => {
        setActiveView('chat');
        navigation.setSidebarSearchOpen(true);
      },
    },
    'navigation.goBack': {
      enabled: appHistory.canGoBack,
      execute: appHistory.goBack,
    },
    'navigation.goForward': {
      enabled: appHistory.canGoForward,
      execute: appHistory.goForward,
    },
    'navigation.previousChat': {
      enabled: activeView === 'chat' && !sidebarCollapsed,
      execute: sidebarNavigation.goPrevious,
    },
    'navigation.nextChat': {
      enabled: activeView === 'chat' && !sidebarCollapsed,
      execute: sidebarNavigation.goNext,
    },
    'app.addProject': {
      execute: navigation.openCreateProject,
    },
    'app.openSettings': {
      execute: openSettings,
    },
    'app.openCapabilities': {
      execute: openCapabilities,
    },
    'app.openChat': {
      execute: openChat,
    },
    'app.openPullRequests': {
      execute: openPullRequests,
    },
    'app.openAutomation': {
      execute: openAutomation,
    },
    'app.toggleTheme': {
      // Use the same toggle and transition origin as pointer activation.
      execute: () => themeToggleTriggerRef.current?.click(),
    },
    'app.toggleRuntimeActivity': {
      allowInModal: runtimeActivityOpen,
      execute: () => setRuntimeActivityOpen((open) => !open),
    },
    'layout.toggleSidebar': {
      enabled: activeView === 'chat' || activeView === 'capabilities',
      execute: handleToggleSidebar,
    },
    'layout.toggleWorkspace': {
      enabled: activeView === 'chat',
      execute: workspacePanels.toggleSidePanel,
    },
    'layout.toggleTerminal': {
      allowInTerminal: true,
      enabled: activeView === 'chat',
      execute: workspacePanels.toggleBottomPanel,
    },
    'chat.focusComposer': {
      allowInTerminal: true,
      execute: () => {
        setActiveView('chat');
        setFocusComposerRequest((request) => request + 1);
      },
    },
    'chat.find': {
      enabled: activeView === 'chat' && (Boolean(runtime.currentThread?.messages.length) || hasActiveBrowserPanel),
      execute: (event) => {
        const tabId = browserShortcutTabId(event, null);
        if (tabId) {
          void window.setsunaDesktop?.browser.requestFindInPage(tabId).catch(() => undefined);
        } else if (!(event && 'source' in event && event.source?.kind === 'embedded-browser') && runtime.currentThread?.messages.length) {
          setFindInChatRequest((request) => request + 1);
        }
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
    'workspace.openChanges': {
      enabled: activeView === 'chat' && Boolean(activeWorkspace?.path),
      execute: openChangesPanel,
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
    'workspace.closeActiveSidePanel': {
      enabled: activeView === 'chat',
      execute: workspacePanels.closeActiveSidePanel,
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
    hasActiveBrowserPanel,
    navigation,
    openAutomation,
    openCapabilities,
    openChat,
    openPullRequests,
    openChangesPanel,
    openFilesPanel,
    openReviewPanel,
    openSettings,
    reloadBrowserPanel,
    runtime.activeTurnId,
    runtime.currentThread,
    runtimeActivityOpen,
    setActiveView,
    sidebarCollapsed,
    sidebarNavigation.goPrevious,
    sidebarNavigation.goNext,
    appHistory.canGoBack,
    appHistory.canGoForward,
    appHistory.goBack,
    appHistory.goForward,
    startNewChat,
    workspacePanels.toggleBottomPanel,
    workspacePanels.closeActiveSidePanel,
    workspacePanels.conversationDebugEnabled,
    workspacePanels.openBrowserPanel,
    workspacePanels.openDesktopPanel,
    workspacePanels.toggleSidePanel,
  ]);
  useAppKeyboardShortcuts(shortcutHandlers);
  useSecondaryRoutePrefetch();
  const browserSettingsNavigation = useMemo(() => ({
    openSettings: (section: string) => { setSettingsInitialSection(section); setActiveView('settings'); },
    openPage: (url: string) => { workspacePanels.openBrowserPanel(url); setActiveView('chat'); },
  }), [setActiveView, workspacePanels.openBrowserPanel]);

  return (
    <BrowserSettingsNavigationProvider value={browserSettingsNavigation}><ShellFrame
      applicationMenu={<AppMenuBar handlers={shortcutHandlers} />}
      rootRef={shellRef}
      inspectorOpen={workspacePanelReservesLayout}
      style={shellStyle}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={handleToggleSidebar}
      showSidebarToggle={activeView === 'chat' || activeView === 'capabilities'}
      navigationRail={(
        <AppNavigationRail
          onCreateApp={startPluginAppChat}
          onFocusComposer={() => setFocusComposerRequest((request) => request + 1)}
          activeView={activeView}
          activeProjectId={activeProjectId}
          activeThreadId={currentThread?.id}
          selectedPluginViewKey={selectedPluginViewKey}
          runtimeActivityTriggerRef={runtimeActivityTriggerRef}
          themeToggleTriggerRef={themeToggleTriggerRef}
          onOpenChat={openChat}
          onOpenCapabilities={openCapabilities}
          onOpenPullRequests={openPullRequests}
          onOpenAutomation={openAutomation}
          onOpenPluginView={openPluginView}
          onViewPlugin={openCapabilitiesPlugin}
          onOpenRuntimeActivity={() => setRuntimeActivityOpen(true)}
          onOpenSettings={openSettings}
        />
      )}
      navigationActions={(
        <AppThreadHistoryNavigation
          canGoBack={appHistory.canGoBack}
          canGoForward={appHistory.canGoForward}
          onGoBack={appHistory.goBack}
          onGoForward={appHistory.goForward}
        />
      )}
      toolbarTitle={(
        <RendererOwnedSingleSlot
          slot={shellTopbarTitleSlot}
          props={{
            renderDefault: () => activeView === 'chat' && (activeProject || currentThread) ? (
              <AppChatToolbarTitle
                key={currentThread?.id ?? activeProject?.id}
                project={activeProject}
                title={toolbarTitle ?? activeProject?.name}
                menuOpen={toolbarMenuOpen}
                onMenuOpenChange={(open) => {
                  setToolbarMenuOpen(open);
                  if (open) navigation.setThreadActionMenuId(null);
                }}
                menu={{
                  thread: currentThread,
                  pinned: Boolean(currentThread && pins.pinnedThreadIds.has(currentThread.id)),
                  running: Boolean(runtime.activeTurnId || currentThread?.activeTurnId),
                  actions: currentThread ? threadMenu : {
                    ...threadMenu,
                    apps: activeWorkspace?.path ? workspacePanels.workspaceApps : [],
                    openWith: workspacePanels.openWorkspaceInApp,
                  },
                  onRename: navigation.openRenameThread,
                  onTogglePin: pins.togglePinnedThread,
                  onArchive: (thread) => void navigation.archiveThread(thread),
                  onOpenInNewWindow: openThreadInNewWindow,
                }}
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
              ? <AppWorkspaceToolbar projectWorkspace={projectWorkspace} workspacePanels={workspacePanels} workspaceMaximized={workspaceMaximized} onToggleMaximized={toggleWorkspaceMaximized} />
              : undefined,
          }}
        />
      )}
      onNewChat={activeView === 'chat' ? startNewChat : undefined}
      className={shellClassName}
      actions={(
        <RendererOwnedSingleSlot
          slot={shellTopbarActionsSlot}
          props={{
            renderDefault: () => activeView === 'chat' ? (
              <AppTopbarActions
                activeView={activeView}
                bottomPanelVisible={workspacePanels.bottomPanelVisible}
                conversationOverviewAvailable={Boolean(runtime.currentThread)}
                conversationOverviewVisible={conversationOverviewRendered}
                sidePanelVisible={workspacePanels.sidePanelVisible}
                onToggleConversationOverview={handleToggleConversationOverview}
                onToggleSidePanel={workspacePanels.toggleSidePanel}
                onToggleBottomTerminal={workspacePanels.toggleBottomPanel}
              />
            ) : undefined,
          }}
        />
      )}
    >
      <RendererOwnedSingleSlot
        slot={shellSidebarSlot}
        props={{
          renderDefault: () => (
            <AppSidebarSurface
              threadMenu={threadMenu}
              pins={pins}
              onOpenThreadInNewWindow={openThreadInNewWindow}
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
              onResizeStep={handleSidebarResizeStep}
              onResizeStart={handleSidebarResizeStart}
            />
          ),
        }}
      />

      {slots.keyed(shellRouteSlot, activeView, {
        routeId: activeView,
        renderDefault: () => (
          <AppRouteContent
        onSelectConversation={navigation.selectThreadInView}
        starterProjectSelection={{
          projects: runtime.projects,
          onSelectProject: navigation.selectNewThreadProject,
          onCreateProject: navigation.openCreateProject,
        }}
        activeProject={activeProject}
        activeWorkspace={activeWorkspace}
        fileWorkspace={fileWorkspace}
        activeView={activeView}
        selectedCapabilitiesPluginId={selectedCapabilitiesPluginId}
        selectedPluginViewKey={selectedPluginViewKey}
        settingsInitialSection={settingsInitialSection}
        chatActions={chatActions}
        onForkThread={navigation.forkThread}
        composerKey={composerKey}
        attachmentStore={attachmentStore}
        focusComposerRequest={focusComposerRequest}
        findInChatRequest={findInChatRequest}
        onFindInChatRequestConsumed={consumeFindInChatRequest}
        conversationOverviewVisibility={conversationOverviewVisibility}
        draft={draft}
        draftSkillReferences={draftSkillReferences}
        projectWorkspace={projectWorkspace}
        runtime={runtime}
        setActiveView={setActiveView}
        setDraft={setDraft}
        capabilitySelectionRequest={capabilitySelectionRequest}
        startCurrentThreadReview={startCurrentThreadReview}
        workspacePanels={workspacePanels}
        onSelectSkillForChat={selectSkillForChat}
        onSelectPluginForChat={selectPluginForChat}
        onOpenPlugin={openCapabilitiesPlugin}
        onSelectedCapabilitiesPluginIdChange={setSelectedCapabilitiesPluginId}
        onConversationOverviewRenderedChange={setConversationOverviewRendered}
        onFocusComposerRequestConsumed={consumeFocusComposerRequest}
        onOpenModelSettings={openModelSettings}
        onCapabilitySelectionRequestConsumed={clearCapabilitySelectionRequest}
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
        <RuntimeErrorNotice message={visibleRuntimeError} />
      ) : null}

      {activeView === 'chat' && currentThread && controller.worktreeRecovery.open ? (
        <MissingWorktreeDialog
          key={`${currentThread.id}:${currentThread.workspaceId}`}
          threadId={currentThread.id}
          project={activeProject}
          client={runtime.client}
          setCurrentThread={runtime.setCurrentThread}
          reloadThreads={runtime.reloadThreads}
          onClose={controller.worktreeRecovery.dismiss}
        />
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
    </ShellFrame></BrowserSettingsNavigationProvider>
  );
}
