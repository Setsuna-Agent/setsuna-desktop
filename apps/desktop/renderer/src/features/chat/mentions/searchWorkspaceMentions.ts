import {
  workspaceProjectRoots, workspaceRootName, workspaceTarget,
  type DesktopRuntimeClient, type WorkspaceEntrySearchItem, type WorkspaceEntrySearchResponse, type WorkspaceProject,
} from '@setsuna-desktop/contracts';

/** Search only on demand, with bounded fan-out across independent source directories. */
export async function searchWorkspaceMentions(
  client: Pick<DesktopRuntimeClient, 'searchProjectEntries'>,
  project: WorkspaceProject | undefined,
  query = '',
  parent?: string | null,
): Promise<WorkspaceEntrySearchResponse> {
  const roots = workspaceProjectRoots(project);
  const empty = { entries: [], query, scanned: 0, truncated: false, workspaceRoot: project?.path ?? '' };
  if (!project || !roots.length) return empty;
  if (roots.length === 1) return client.searchProjectEntries(workspaceTarget(project.id, roots[0].id), query, parent);
  const normalized = query.trim().replace(/\\/gu, '/');
  const scoped = roots.filter((root) => normalized.toLocaleLowerCase().startsWith(`${workspaceRootName(root).toLocaleLowerCase()}/`));
  const selectedRoots = scoped.length ? scoped : normalized ? roots : roots.slice(0, 1);
  const rootEntries: WorkspaceEntrySearchItem[] = scoped.length || parent != null ? [] : roots
    .filter((root) => !normalized || workspaceRootName(root).toLocaleLowerCase().includes(normalized.toLocaleLowerCase()))
    .map((root) => ({ kind: 'directory', name: workspaceRootName(root), path: '.', parent: '', rootId: root.id, rootName: workspaceRootName(root), absolutePath: root.path }));
  const results: WorkspaceEntrySearchResponse[] = [];
  const errors: unknown[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, selectedRoots.length) }, async () => {
    while (index < selectedRoots.length) {
      const root = selectedRoots[index++];
      const rootName = workspaceRootName(root);
      const search = scoped.length ? normalized.slice(rootName.length + 1) : normalized;
      try {
        const result = await client.searchProjectEntries(workspaceTarget(project.id, root.id), search, parent ?? (search ? undefined : ''));
        results.push({ ...result, entries: result.entries.map((entry) => ({
          ...entry, rootId: root.id, rootName,
          absolutePath: `${root.path.replace(/[\\/]+$/u, '')}/${entry.path}`,
          parent: [rootName, entry.parent].filter(Boolean).join('/'),
        })) });
      } catch (error) { errors.push(error); }
    }
  }));
  if (!results.length && errors.length && !rootEntries.length) throw errors[0];
  const entries = [...rootEntries, ...results.flatMap((result) => result.entries)
    .sort((left, right) => `${left.rootName}/${left.path}`.localeCompare(`${right.rootName}/${right.path}`))];
  return {
    ...empty, entries: entries.slice(0, 80), scanned: results.reduce((total, result) => total + result.scanned, 0),
    truncated: entries.length > 80 || results.some((result) => result.truncated),
  };
}
