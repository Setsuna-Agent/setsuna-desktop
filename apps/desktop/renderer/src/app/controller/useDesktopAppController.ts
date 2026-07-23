import { runtimeDeveloperFeaturesEnabled, type RuntimeReviewTarget } from '@setsuna-desktop/contracts';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SetStateAction,
} from 'react';
import {
  chatComposerTargetIdentity,
  useChatComposerSession,
} from '../../features/chat/hooks/useChatComposerSession.js';
import { useChatTurnActions } from '../../features/chat/hooks/useChatTurnActions.js';
import { useDesktopPanelResize } from '../../features/workspace/hooks/useDesktopPanelResize.js';
import { useDesktopWorkspacePanels } from '../../features/workspace/hooks/useDesktopWorkspacePanels.js';
import { useProjectWorkspace } from '../../features/workspace/hooks/useProjectWorkspace.js';
import { useThreadWorkspace } from '../../features/workspace/hooks/useThreadWorkspace.js';
import { useRuntimeClientState } from '../../services/runtime-client/useRuntimeClientState.js';
import { useIdentityRequestGuard } from '../../shared/hooks/useIdentityRequestGuard.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { useThreadGroups } from '../sidebar/useThreadGroups.js';
import type { ChatSkillSelectionRequest, MainView } from '../types.js';
import { useDesktopNavigation } from './useDesktopNavigation.js';
import { shouldCollapseSidebar, useDesktopSidebarAutoCollapse } from './useDesktopSidebarAutoCollapse.js';
import { useDesktopUpdater } from './useDesktopUpdater.js';
import { useGlobalEscapeMenus } from './useGlobalEscapeMenus.js';

export function useDesktopAppController() {
  const { t } = useI18n();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<MainView>('chat');
  const [sidebarManuallyCollapsed, setSidebarManuallyCollapsed] = useState(false);
  const [sidebarManuallyExpanded, setSidebarManuallyExpanded] = useState(false);
  const [skillSelectionRequest, setSkillSelectionRequest] = useState<ChatSkillSelectionRequest | null>(null);
  const skillSelectionRequestIdRef = useRef(0);

  const updater = useDesktopUpdater();
  const runtime = useRuntimeClientState({ activeProjectId, setActiveProjectId });
  const {
    activeTurnId,
    client,
    currentThread,
    loadState,
    projects,
    reloadThreads,
    setActiveTurnId,
    setCurrentThread,
    setError,
    setProjects,
    terminalTurnIdsRef,
    threads,
  } = runtime;
  const chatTargetIdentity = chatComposerTargetIdentity(
    currentThread?.id,
    currentThread ? null : activeProjectId,
  );
  const composerSession = useChatComposerSession(chatTargetIdentity);
  const {
    claimForThread: claimComposerForThread,
    composerKey,
    draft,
    reset: resetComposer,
    setDraft,
  } = composerSession;
  const reviewRequests = useIdentityRequestGuard(composerKey);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);

  const effectiveProjectId = currentThread ? currentThread.projectId ?? null : activeProjectId;
  const effectiveProject = effectiveProjectId ? projects.find((project) => project.id === effectiveProjectId) : undefined;
  const activeWorkspaceState = useThreadWorkspace({ client, projectWorkspace: effectiveProject, setError, thread: currentThread });
  const activeWorkspace = activeWorkspaceState.workspace;

  const workspacePanels = useDesktopWorkspacePanels({
    activeProject: activeWorkspace,
    activeView,
    autoLoadReview: Boolean(currentThread),
    developerFeaturesEnabled: runtime.config
      ? runtimeDeveloperFeaturesEnabled(runtime.config)
      : null,
    setError,
    targetIdentity: chatTargetIdentity,
    workspaceStatus: activeWorkspaceState.status,
  });
  const {
    bottomActivePanel,
    bottomPanelVisible,
    claimForThread: claimWorkspacePanelsForThread,
    closeWorkspaceMenus,
    openFilePanel,
    panelLauncherMenuOpen,
    sideActivePanel,
    sidePanelVisible,
    workspaceAppMenuOpen,
  } = workspacePanels;
  // 设置页会覆盖整个工作台。保留其后的聊天面板轨道，避免返回时所有已保存宽度
  // 都从零重新动画到原有尺寸。
  const workspacePanelReservesLayout = sidePanelVisible || (activeView === 'settings' && Boolean(sideActivePanel));
  const bottomPanelReservesLayout = bottomPanelVisible || (activeView === 'settings' && Boolean(bottomActivePanel));

  const {
    handleSidebarResizeStep,
    handleSidebarResizeStart,
    handleTerminalResizeStep,
    handleTerminalResizeStart,
    handleWorkspaceResizeStep,
    handleWorkspaceResizeStart,
    fitWorkspaceForExpandedSidebar,
    sidebarMaxWidth,
    sidebarMinWidth,
    sidebarWidth,
    terminalMaxHeight,
    terminalHeight,
    terminalMinHeight,
    workspaceLayoutWidth,
    workspaceMaxWidth,
    workspaceMinWidth,
    workspaceWidth,
  } = useDesktopPanelResize(shellRef, {
    bottomPanelVisible: bottomPanelReservesLayout,
    workspaceVisible: workspacePanelReservesLayout,
  });
  const sidebarCanExpand = useDesktopSidebarAutoCollapse({
    shellRef,
    sidebarWidth,
    workspaceVisible: workspacePanelReservesLayout,
    workspaceWidth: workspaceLayoutWidth,
  });
  const sidebarCollapsed = shouldCollapseSidebar({
    canExpand: sidebarCanExpand,
    manuallyCollapsed: sidebarManuallyCollapsed,
    manuallyExpanded: sidebarManuallyExpanded,
  });
  const sidebarReservesLayout = !sidebarCollapsed;
  const setSidebarCollapsed = useCallback((value: SetStateAction<boolean>) => {
    const nextCollapsed = typeof value === 'function' ? value(sidebarCollapsed) : value;
    if (nextCollapsed) {
      setSidebarManuallyCollapsed(true);
      setSidebarManuallyExpanded(false);
      return;
    }
    fitWorkspaceForExpandedSidebar();
    setSidebarManuallyCollapsed(false);
    setSidebarManuallyExpanded(true);
  }, [fitWorkspaceForExpandedSidebar, sidebarCollapsed]);

  useEffect(() => {
    setSidebarManuallyExpanded(false);
  }, [sidebarCanExpand]);

  const projectWorkspace = useProjectWorkspace({
    activeProjectId: activeWorkspace?.id ?? null,
    client,
    onOpenFilePanel: openFilePanel,
  });
  const { globalThreads, threadsByProjectId } = useThreadGroups(threads);

  const navigation = useDesktopNavigation({
    activeProjectId,
    client,
    currentThread,
    globalThreads,
    reloadThreads,
    resetNewThreadWorkspacePanels: workspacePanels.resetNewThreadPanelSession,
    resetProjectWorkspaceState: projectWorkspace.resetProjectWorkspaceState,
    resetThreadWorkspacePanels: workspacePanels.resetThreadPanelSession,
    setActiveProjectId,
    setActiveView,
    setCurrentThread,
    setError,
    setProjects,
    threadsByProjectId,
  });

  useGlobalEscapeMenus({
    closeNavigationMenus: navigation.closeNavigationMenus,
    closeWorkspaceMenus,
    panelLauncherMenuOpen,
    projectActionMenuId: navigation.projectActionMenuId,
    threadActionMenuId: navigation.threadActionMenuId,
    workspaceAppMenuOpen,
  });

  const claimConversationSessionForThread = useCallback((threadId: string) => {
    claimComposerForThread(threadId);
    claimWorkspacePanelsForThread(threadId);
  }, [claimComposerForThread, claimWorkspacePanelsForThread]);

  const chatActions = useChatTurnActions({
    activeProjectId,
    activeTurnId,
    claimComposerForThread: claimConversationSessionForThread,
    client,
    composerKey,
    currentThread,
    draft,
    expandProject: navigation.expandProject,
    reloadThreads,
    setActiveTurnId,
    setCurrentThread,
    setDraft,
    setError,
    terminalTurnIdsRef,
  });

  const selectSkillForChat = useCallback((skillId: string) => {
    skillSelectionRequestIdRef.current += 1;
    setActiveView('chat');
    setSkillSelectionRequest({
      composerKey,
      skillId,
      requestId: skillSelectionRequestIdRef.current,
    });
  }, [composerKey]);

  const clearSkillSelectionRequest = useCallback((requestId: number) => {
    setSkillSelectionRequest((current) => (current?.requestId === requestId ? null : current));
  }, []);

  const startCurrentThreadReview = useCallback((target: RuntimeReviewTarget) => {
    const isCurrentRequest = reviewRequests.begin();
    return runtime.startCurrentThreadReview(target, {
      claimComposerForThread: claimConversationSessionForThread,
      isCurrentRequest,
    });
  }, [claimConversationSessionForThread, reviewRequests, runtime]);

  const shellSidebarState = resolveShellSidebarState(activeView, sidebarCollapsed);
  const shellStyle = {
    '--app-sidebar-width': shellSidebarState.reservesLayout ? `${sidebarWidth}px` : '0px',
    '--app-topbar-sidebar-width': activeView === 'settings' ? 'var(--desktop-settings-nav-width)' : sidebarReservesLayout ? `${sidebarWidth}px` : 'var(--app-topbar-collapsed-sidebar-width)',
    '--desktop-agent-sidebar-visual-width': `${sidebarWidth}px`,
    '--desktop-settings-nav-width': `${sidebarWidth}px`,
    '--desktop-agent-workspace-width': workspacePanelReservesLayout ? `${workspaceLayoutWidth}px` : '0px',
    '--app-bottom-panel-height': bottomPanelReservesLayout ? `${terminalHeight}px` : '0px',
  } as CSSProperties;

  const shellClassName = [
    activeView === 'settings' ? 'desktop-agent-page--settings-open' : '',
    activeView === 'capabilities' ? 'desktop-agent-page--capabilities-open' : '',
    shellSidebarState.collapsed ? 'desktop-agent-page--sidebar-collapsed' : '',
    bottomPanelVisible ? 'desktop-agent-page--bottom-panel-open' : '',
  ].filter(Boolean).join(' ');

  const toolbarTitle = activeView === 'chat' ? currentThread?.title ?? t('app.newChat') : undefined;

  return {
    activeProject: effectiveProject,
    activeWorkspace,
    activeProjectId,
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
    loadState,
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
    updater,
    workspacePanelReservesLayout,
    workspaceMaxWidth,
    workspaceMinWidth,
    workspacePanels,
    workspaceWidth,
  };
}

export function resolveShellSidebarState(activeView: MainView, sidebarCollapsed: boolean) {
  // 设置导航是共享 workbench 的侧栏，但不继承聊天侧栏的折叠状态。
  const settingsOpen = activeView === 'settings';
  return {
    collapsed: !settingsOpen && sidebarCollapsed,
    reservesLayout: settingsOpen || !sidebarCollapsed,
  };
}

export type DesktopAppController = ReturnType<typeof useDesktopAppController>;
