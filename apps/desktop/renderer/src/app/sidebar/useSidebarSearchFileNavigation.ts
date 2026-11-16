import { useCallback, useEffect, useState } from 'react';
import type { ProjectWorkspaceState } from '../../features/workspace/hooks/useProjectWorkspace.js';
import { useLatestRequestGuard } from '../../shared/hooks/useLatestRequestGuard.js';
import type { DesktopNavigationState } from '../controller/useDesktopNavigation.js';
import type { MainView } from '../types.js';
import type { SidebarSearchFileTarget } from './sidebarSearchTypes.js';

export function useSidebarSearchFileNavigation({ activeProjectId, activeView, currentThreadId, workspaceId, navigation, openProjectFile }: {
  activeProjectId: string | null;
  activeView: MainView;
  currentThreadId?: string;
  workspaceId?: string;
  navigation: Pick<DesktopNavigationState, 'changeView' | 'startProjectThread'>;
  openProjectFile: ProjectWorkspaceState['openProjectFile'];
}) {
  const requests = useLatestRequestGuard();
  const [pending, setPending] = useState<SidebarSearchFileTarget | null>(null);
  useEffect(() => {
    if (!pending) return;
    setPending(null);
    // Wait for the new project's hooks to commit; never open through the previous workspace closure.
    if (activeView !== 'chat' || currentThreadId || activeProjectId !== pending.projectId || workspaceId !== pending.projectId) return;
    void openProjectFile(pending.path, pending.line, pending.rootId);
  }, [activeProjectId, activeView, currentThreadId, openProjectFile, pending, workspaceId]);

  return useCallback(async (target: SidebarSearchFileTarget) => {
    const isCurrent = requests.begin();
    setPending(null);
    if (workspaceId === target.projectId && activeView !== 'automation') {
      await navigation.changeView('chat');
      if (isCurrent()) await openProjectFile(target.path, target.line, target.rootId);
      return;
    }
    if (await navigation.startProjectThread(target.projectId) && isCurrent()) setPending(target);
  }, [activeView, navigation, openProjectFile, requests, workspaceId]);
}
