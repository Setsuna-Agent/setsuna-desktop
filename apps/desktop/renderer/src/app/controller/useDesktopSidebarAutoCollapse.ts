import { useEffect, useState, type RefObject } from 'react';
import {
  readWorkbenchWidth,
  WORKBENCH_SPLIT_MAIN_MIN_WIDTH,
  WORKBENCH_MAIN_MIN_WIDTH,
} from '../../features/workspace/hooks/useDesktopPanelResize.js';

const SIDEBAR_AUTO_COLLAPSE_MOBILE_WIDTH = 760;

export function useDesktopSidebarAutoCollapse({
  shellRef,
  sidebarWidth,
  workspaceVisible,
  workspaceWidth,
}: {
  shellRef: RefObject<HTMLDivElement | null>;
  sidebarWidth: number;
  workspaceVisible: boolean;
  workspaceWidth: number;
}): boolean {
  const [workbenchWidth, setWorkbenchWidth] = useState(() => readWorkbenchWidth(shellRef.current));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let frame = 0;
    const syncWorkbenchWidth = () => setWorkbenchWidth(readWorkbenchWidth(shellRef.current));
    const scheduleSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncWorkbenchWidth();
      });
    };
    syncWorkbenchWidth();
    window.addEventListener('resize', scheduleSync);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleSync);
    };
  }, [shellRef]);

  // Derive both sidebars' targets in one render, before the shared grid starts
  // moving; an effect here would retarget the conversation a frame later.
  return canFitDesktopSidebar({
    sidebarWidth,
    // The shell can mount after runtime startup, without a window resize event.
    viewportWidth: shellRef.current ? readWorkbenchWidth(shellRef.current) : workbenchWidth,
    workspaceVisible,
    workspaceWidth,
  });
}

export function canFitDesktopSidebar({
  sidebarWidth,
  viewportWidth: availableViewportWidth,
  workspaceVisible,
  workspaceWidth,
}: {
  sidebarWidth: number;
  viewportWidth: number;
  workspaceVisible: boolean;
  workspaceWidth: number;
}): boolean {
  if (availableViewportWidth <= SIDEBAR_AUTO_COLLAPSE_MOBILE_WIDTH) return false;
  const reservedWorkspaceWidth = workspaceVisible ? workspaceWidth : 0;
  const expandedMainMinWidth = workspaceVisible ? WORKBENCH_SPLIT_MAIN_MIN_WIDTH : WORKBENCH_MAIN_MIN_WIDTH;
  return availableViewportWidth >= sidebarWidth + reservedWorkspaceWidth + expandedMainMinWidth;
}

export function shouldCollapseSidebar({
  canExpand,
  manuallyCollapsed,
  manuallyExpanded,
}: {
  canExpand: boolean;
  manuallyCollapsed: boolean;
  manuallyExpanded: boolean;
}): boolean {
  if (manuallyCollapsed) return true;
  return !canExpand && !manuallyExpanded;
}
