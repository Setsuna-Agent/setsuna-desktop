import { useCallback, useEffect, useState, type RefObject } from 'react';
import { WORKBENCH_MAIN_MIN_WIDTH } from './useDesktopPanelResize.js';

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
  const [canExpand, setCanExpand] = useState(true);
  const syncCanExpand = useCallback(() => {
    setCanExpand(
      canFitDesktopSidebar({
        sidebarWidth,
        viewportWidth: shellRef.current?.clientWidth ?? viewportWidth(),
        workspaceVisible,
        workspaceWidth,
      }),
    );
  }, [shellRef, sidebarWidth, workspaceVisible, workspaceWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let frame = 0;
    const scheduleSync = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncCanExpand();
      });
    };
    syncCanExpand();
    window.addEventListener('resize', scheduleSync);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleSync);
    };
  }, [syncCanExpand]);

  return canExpand;
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
  return availableViewportWidth >= sidebarWidth + reservedWorkspaceWidth + WORKBENCH_MAIN_MIN_WIDTH;
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

function viewportWidth(): number {
  return typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
}
