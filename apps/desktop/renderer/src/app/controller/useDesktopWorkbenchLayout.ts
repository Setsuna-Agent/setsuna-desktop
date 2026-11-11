import { useCallback, useState, type RefObject, type SetStateAction } from 'react';
import { useDesktopPanelResize } from '../../features/workspace/hooks/useDesktopPanelResize.js';
import { isFeatureConversationView } from '../mainViews.js';
import type { MainView } from '../types.js';
import { shouldCollapseSidebar, useDesktopSidebarAutoCollapse } from './useDesktopSidebarAutoCollapse.js';

/** Coordinates sidebar intent and workspace sizing so each layout change has one owner. */
export function useDesktopWorkbenchLayout(shellRef: RefObject<HTMLDivElement | null>, {
  activeView, bottomPanelVisible, workspaceVisible,
}: {
  activeView: MainView;
  bottomPanelVisible: boolean;
  workspaceVisible: boolean;
}) {
  const [sidebarManuallyCollapsed, setSidebarManuallyCollapsed] = useState(false);
  const [sidebarManuallyExpanded, setSidebarManuallyExpanded] = useState(false);
  const [capabilitiesSidebarCollapsed, setCapabilitiesSidebarCollapsed] = useState(false);
  const resize = useDesktopPanelResize(shellRef, {
    bottomPanelVisible, sidebarManuallyCollapsed, sidebarManuallyExpanded, workspaceVisible,
  });
  const { fitWorkspaceForExpandedSidebar, sidebarWidth, workspaceLayoutWidth, workspaceSinglePane } = resize;
  const sidebarCanExpand = useDesktopSidebarAutoCollapse({
    shellRef,
    sidebarWidth,
    workspaceVisible,
    workspaceWidth: workspaceLayoutWidth,
  });
  const chatSidebarCollapsed = shouldCollapseSidebar({
    canExpand: sidebarCanExpand,
    manuallyCollapsed: sidebarManuallyCollapsed,
    manuallyExpanded: sidebarManuallyExpanded,
  });
  // 插件导航有独立的折叠状态，切换页面不会改写聊天侧栏的偏好。
  const sidebarCollapsed = isFeatureConversationView(activeView) ? workspaceSinglePane
    : activeView === 'capabilities' ? capabilitiesSidebarCollapsed
    : (activeView === 'chat' && workspaceSinglePane) || chatSidebarCollapsed;
  const setSidebarCollapsed = useCallback((value: SetStateAction<boolean>) => {
    if (activeView === 'capabilities') {
      setCapabilitiesSidebarCollapsed(value);
      return;
    }
    const nextCollapsed = typeof value === 'function' ? value(sidebarCollapsed) : value;
    if (nextCollapsed) {
      setSidebarManuallyCollapsed(true);
      setSidebarManuallyExpanded(false);
      return;
    }
    fitWorkspaceForExpandedSidebar();
    setSidebarManuallyCollapsed(false);
    // Keep explicit expansion through the resize it triggers; clearing it restores
    // the wider workspace preference and immediately collapses the sidebar again.
    setSidebarManuallyExpanded(true);
  }, [activeView, fitWorkspaceForExpandedSidebar, sidebarCollapsed]);

  return { ...resize, sidebarCollapsed, setSidebarCollapsed };
}
