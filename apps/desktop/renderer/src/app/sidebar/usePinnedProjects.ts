import type { WorkspaceProject } from '@setsuna-desktop/contracts';
import { useCallback, useMemo } from 'react';
import { usePinnedSidebarIds } from './usePinnedSidebarIds.js';

export const PINNED_PROJECTS_STORAGE_KEY = 'setsuna-pinned-projects-v1';

export function usePinnedProjects(projects: readonly WorkspaceProject[]) {
  const { ids: pinnedProjectIds, toggle } = usePinnedSidebarIds(PINNED_PROJECTS_STORAGE_KEY);
  const togglePinnedProject = useCallback((project: WorkspaceProject) => toggle(project.id), [toggle]);
  const pinnedProjects = useMemo(() => {
    const available = new Map(projects.filter((project) => !project.archivedAt).map((project) => [project.id, project]));
    return [...pinnedProjectIds].flatMap((id) => {
      const project = available.get(id);
      return project ? [project] : [];
    });
  }, [pinnedProjectIds, projects]);
  return { pinnedProjectIds, pinnedProjects, togglePinnedProject };
}

export type PinnedProjectsState = ReturnType<typeof usePinnedProjects>;
