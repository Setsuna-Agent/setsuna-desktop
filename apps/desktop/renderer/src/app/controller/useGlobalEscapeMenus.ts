import { useEffect } from 'react';

export function useGlobalEscapeMenus({
  closeNavigationMenus,
  closeWorkspaceMenus,
  panelLauncherMenuOpen,
  projectActionMenuId,
  threadActionMenuId,
}: {
  closeNavigationMenus: () => void;
  closeWorkspaceMenus: () => void;
  panelLauncherMenuOpen: boolean;
  projectActionMenuId: string | null;
  threadActionMenuId: string | null;
}) {
  useEffect(() => {
    if (!projectActionMenuId && !threadActionMenuId && !panelLauncherMenuOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeNavigationMenus();
      closeWorkspaceMenus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeNavigationMenus, closeWorkspaceMenus, panelLauncherMenuOpen, projectActionMenuId, threadActionMenuId]);
}
