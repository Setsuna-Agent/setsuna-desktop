import { useEffect } from 'react';

export function useGlobalEscapeMenus({
  closeNavigationMenus,
  closeWorkspaceMenus,
  panelLauncherMenuOpen,
  projectActionMenuId,
  threadActionMenuId,
  workspaceAppMenuOpen,
}: {
  closeNavigationMenus: () => void;
  closeWorkspaceMenus: () => void;
  panelLauncherMenuOpen: boolean;
  projectActionMenuId: string | null;
  threadActionMenuId: string | null;
  workspaceAppMenuOpen: boolean;
}) {
  useEffect(() => {
    if (!projectActionMenuId && !threadActionMenuId && !workspaceAppMenuOpen && !panelLauncherMenuOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeNavigationMenus();
      closeWorkspaceMenus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeNavigationMenus, closeWorkspaceMenus, panelLauncherMenuOpen, projectActionMenuId, threadActionMenuId, workspaceAppMenuOpen]);
}
