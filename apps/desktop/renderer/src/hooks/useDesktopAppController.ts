import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useChatTurnActions } from './useChatTurnActions.js';
import { useDesktopNavigation } from './useDesktopNavigation.js';
import { useDesktopPanelResize } from './useDesktopPanelResize.js';
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const {
    handleSidebarResizeStep,
    handleSidebarResizeStart,
    handleTerminalResizeStep,
    handleTerminalResizeStart,
    handleWorkspaceResizeStep,
    handleWorkspaceResizeStart,
    sidebarMaxWidth,
    sidebarMinWidth,
    sidebarWidth,
    terminalMaxHeight,
    terminalHeight,
    terminalMinHeight,
    workspaceMaxWidth,
    workspaceMinWidth,
    workspaceWidth,
  } = useDesktopPanelResize(shellRef);

  const effectiveProjectId = currentThread ? currentThread.projectId ?? null : activeProjectId;
  const effectiveProject = effectiveProjectId ? projects.find((project) => project.id === effectiveProjectId) : undefined;

  const workspacePanels = useDesktopWorkspacePanels({ activeProject: effectiveProject, activeView, setError });
  const {
    bottomPanelVisible,
    closeWorkspaceMenus,
    openFilePanel,
    panelLauncherMenuOpen,
    resetPanelSlots,
    sidePanelVisible,
    workspaceAppMenuOpen,
  } = workspacePanels;

  const projectWorkspace = useProjectWorkspace({
    activeProjectId: effectiveProjectId,
    client,
    onOpenFilePanel: openFilePanel,
    onResetPanels: resetPanelSlots,
  });
  const { resetWorkspacePanels } = projectWorkspace;
  const { globalThreads, threadsByProjectId } = useThreadGroups(threads);

  const navigation = useDesktopNavigation({
    activeProjectId,
    client,
    currentThread,
    globalThreads,
    reloadThreads,
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
    '--app-sidebar-width': activeView === 'settings' || sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
    '--app-topbar-sidebar-width': activeView === 'settings' ? 'var(--desktop-settings-nav-width)' : sidebarCollapsed ? '150px' : `${sidebarWidth}px`,
    '--desktop-settings-nav-width': `${sidebarWidth}px`,
    '--desktop-agent-workspace-width': sidePanelVisible ? `${workspaceWidth}px` : '0px',
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
