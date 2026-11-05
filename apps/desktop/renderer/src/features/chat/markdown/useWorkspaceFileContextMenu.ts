import { useCallback, useId, type MouseEvent } from 'react';
import type { WorkspaceFileContextTarget } from '../../workspace/WorkspaceFileContextMenu.js';
import { useMarkdownNavigation } from './MarkdownNavigationProvider.js';

/** The menu owner's target is the source of truth; local hover state cannot track portal dismissal. */
export function useWorkspaceFileContextMenu() {
  const triggerId = useId();
  const { activeFileMenuTriggerId, onOpenWorkspaceFileContextMenu } = useMarkdownNavigation();
  const openContextMenu = useCallback((
    event: MouseEvent<HTMLElement>,
    target: Omit<WorkspaceFileContextTarget, 'triggerId' | 'x' | 'y'>,
  ) => {
    if (event.defaultPrevented || !onOpenWorkspaceFileContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onOpenWorkspaceFileContextMenu({ ...target, triggerId, x: event.clientX, y: event.clientY });
  }, [onOpenWorkspaceFileContextMenu, triggerId]);
  return { contextMenuOpen: activeFileMenuTriggerId === triggerId, openContextMenu };
}
