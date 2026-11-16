import {
  workspaceProjectRoots, workspaceRootName, workspaceTarget,
  type DesktopRuntimeClient, type WorkspaceProject,
} from '@setsuna-desktop/contracts';
import type { SidebarSearchCategory, SidebarWorkspaceSearchResult } from './sidebarSearchTypes.js';

/** Bound directory fan-out and stop scheduling work once the search identity changes. */
export async function searchSidebarWorkspace(
  client: Pick<DesktopRuntimeClient, 'searchProjectEntries' | 'searchProject'>,
  project: WorkspaceProject,
  query: string,
  category: SidebarSearchCategory,
  fileExtensions: string[],
  isCurrent: () => boolean,
): Promise<{ results: SidebarWorkspaceSearchResult[]; errors: unknown[] }> {
  const roots = workspaceProjectRoots(project);
  const results: SidebarWorkspaceSearchResult[][] = roots.map(() => []);
  const errors: unknown[] = [];
  let nextRoot = 0;
  await Promise.all(Array.from({ length: Math.min(3, roots.length) }, async () => {
    while (nextRoot < roots.length && isCurrent()) {
      const index = nextRoot++;
      const root = roots[index];
      const target = workspaceTarget(project.id, root.id);
      const prefix = roots.length > 1 ? `${workspaceRootName(root)}/` : '';
      const [fileResponse, textResponse] = await Promise.allSettled([
        category === 'all' || category === 'files' ? client.searchProjectEntries(target, query, undefined, { filesOnly: true }) : null,
        query && (category === 'all' || category === 'text') ? client.searchProject(target, query, { fileExtensions }) : null,
      ]);
      if (!isCurrent()) return;
      // An unavailable bound directory must not hide matches from the others.
      for (const response of [fileResponse, textResponse]) if (response.status === 'rejected') errors.push(response.reason);
      const files = fileResponse.status === 'fulfilled' ? fileResponse.value : null;
      const text = textResponse.status === 'fulfilled' ? textResponse.value : null;
      results[index] = [
        ...(files?.entries.filter((entry) => entry.kind === 'file').map((entry): SidebarWorkspaceSearchResult => ({
          id: `file:${root.id}:${entry.path}`, kind: 'files', title: entry.name,
          source: `${prefix}${entry.parent}`, target: { projectId: project.id, rootId: root.id, path: entry.path },
        })) ?? []),
        ...(text?.results.map((match): SidebarWorkspaceSearchResult => ({
          id: `text:${root.id}:${match.path}:${match.line}`, kind: 'text', title: match.preview,
          source: `${prefix}${match.path}:${match.line}`,
          target: { projectId: project.id, rootId: root.id, path: match.path, line: match.line },
        })) ?? []),
      ];
    }
  }));
  return { results: results.flat(), errors };
}
