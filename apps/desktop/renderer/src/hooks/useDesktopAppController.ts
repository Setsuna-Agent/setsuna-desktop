import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SetStateAction,
} from 'react';
import { useChatTurnActions } from './useChatTurnActions.js';
import { useDesktopNavigation } from './useDesktopNavigation.js';
import { useDesktopPanelResize } from './useDesktopPanelResize.js';
import { shouldCollapseSidebar, useDesktopSidebarAutoCollapse } from './useDesktopSidebarAutoCollapse.js';
import { useDesktopWorkspacePanels } from './useDesktopWorkspacePanels.js';
import { useDesktopUpdater } from './useDesktopUpdater.js';
import { useGlobalEscapeMenus } from './useGlobalEscapeMenus.js';
import { useProjectWorkspace } from './useProjectWorkspace.js';
import { useRuntimeClientState } from './useRuntimeClientState.js';
import { useThreadGroups } from './useThreadGroups.js';
import type { ChatSkillSelectionRequest, MainView } from '../types/app.js';

export function useDesktopAppController() {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
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

  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);

  const effectiveProjectId = currentThread ? currentThread.projectId ?? null : activeProjectId;
  const effectiveProject = effectiveProjectId ? projects.find((project) => project.id === effectiveProjectId) : undefined;
  const activeWorkspace = effectiveProject ?? runtime.temporaryWorkspace ?? undefined;

  const workspacePanels = useDesktopWorkspacePanels({ activeProject: activeWorkspace, activeView, setError });
  const {
    bottomPanelVisible,
    closeWorkspaceMenus,
    openFilePanel,
    panelLauncherMenuOpen,
    resetPanelSlots,
    sidePanelVisible,
    workspaceAppMenuOpen,
  } = workspacePanels;

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
    bottomPanelVisible,
    workspaceVisible: sidePanelVisible,
  });
  const sidebarCanExpand = useDesktopSidebarAutoCollapse({
    shellRef,
    sidebarWidth,
    workspaceVisible: sidePanelVisible,
    workspaceWidth: workspaceLayoutWidth,
  });
  const sidebarCollapsed = shouldCollapseSidebar({
    canExpand: sidebarCanExpand,
    manuallyCollapsed: sidebarManuallyCollapsed,
    manuallyExpanded: sidebarManuallyExpanded,
  });
  const sidebarReservesLayout = activeView !== 'settings' && !sidebarCollapsed;
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
    onResetProjectPanels: workspacePanels.resetProjectBoundPanels,
    onResetPanels: resetPanelSlots,
  });
  const { resetProjectWorkspacePanels, resetWorkspacePanels } = projectWorkspace;
  const { globalThreads, threadsByProjectId } = useThreadGroups(threads);

  const navigation = useDesktopNavigation({
    activeProjectId,
    client,
    currentThread,
    globalThreads,
    reloadThreads,
    resetProjectWorkspacePanels,
    resetWorkspacePanels,
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

  const chatActions = useChatTurnActions({
    activeProjectId,
    activeTurnId,
    client,
    currentThread,
    draft,
    expandProject: navigation.expandProject,
    reloadThreads,
    setActiveTurnId,
    setActiveView,
    setCurrentThread,
    setDraft,
    setError,
    terminalTurnIdsRef,
  });

  const selectSkillForChat = useCallback((skillId: string) => {
    skillSelectionRequestIdRef.current += 1;
    setActiveView('chat');
    setSkillSelectionRequest({
      skillId,
      requestId: skillSelectionRequestIdRef.current,
    });
  }, []);

  const clearSkillSelectionRequest = useCallback((requestId: number) => {
    setSkillSelectionRequest((current) => (current?.requestId === requestId ? null : current));
  }, []);

  const shellStyle = {
    '--app-sidebar-width': sidebarReservesLayout ? `${sidebarWidth}px` : '0px',
    '--app-topbar-sidebar-width': activeView === 'settings' ? 'var(--desktop-settings-nav-width)' : sidebarReservesLayout ? `${sidebarWidth}px` : '150px',
    '--desktop-agent-sidebar-visual-width': `${sidebarWidth}px`,
    '--desktop-settings-nav-width': `${sidebarWidth}px`,
    '--desktop-agent-workspace-width': sidePanelVisible ? `${workspaceLayoutWidth}px` : '0px',
    '--app-bottom-panel-height': bottomPanelVisible ? `${terminalHeight}px` : '0px',
  } as CSSProperties;

  const shellClassName = [
    activeView === 'settings' ? 'desktop-agent-page--settings-open' : '',
    activeView === 'capabilities' ? 'desktop-agent-page--capabilities-open' : '',
    sidebarCollapsed ? 'desktop-agent-page--sidebar-collapsed' : '',
    bottomPanelVisible ? 'desktop-agent-page--bottom-panel-open' : '',
  ].filter(Boolean).join(' ');

  const toolbarTitle = activeView === 'chat' ? currentThread?.title ?? '新对话' : activeView === 'capabilities' ? '能力' : '设置';

  return {
    activeProject: effectiveProject,
    activeWorkspace,
    activeProjectId,
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
    loadState,
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
    updater,
    workspaceMaxWidth,
    workspaceMinWidth,
    workspacePanels,
    workspaceWidth,
  };
}

export type DesktopAppController = ReturnType<typeof useDesktopAppController>;
