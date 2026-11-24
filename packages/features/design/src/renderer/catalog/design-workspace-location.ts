import type { DesignWorkspace as DesignScope } from '../../contracts/index.js';

type ProjectFilter = Extract<DesignScope, { projectId: string }> & Readonly<{ projectIds?: never }>;
type MultipleProjectFilter = Readonly<{ projectIds: readonly string[]; projectId?: never; rootId?: never; storageId?: never }>;
export type DesignHomeFilter = ProjectFilter | MultipleProjectFilter;

/** A project selection can stay in the canvas even when there is no draft path. */
export type DesignWorkspaceLocation =
  | (DesignScope & Readonly<{ path?: string; homeFilter?: DesignHomeFilter; projectCanvas?: true; projectIds?: never }>)
  | (MultipleProjectFilter & Readonly<{ path?: never; homeFilter?: never; projectCanvas?: never }>);

export function designHomeFilterForProjects(projectIds: readonly string[]): DesignHomeFilter | null {
  if (projectIds.length > 1) return { projectIds };
  const [projectId] = projectIds;
  return projectId ? { projectId } : null;
}

export function designHomeFilterForLocation(location: DesignWorkspaceLocation | null): DesignHomeFilter | null {
  if (location?.path) return location.homeFilter ?? null;
  if (location?.projectIds) return { projectIds: location.projectIds };
  if (!location?.projectId) return null;
  return { projectId: location.projectId, ...(location.rootId && !location.projectCanvas ? { rootId: location.rootId } : {}) };
}
