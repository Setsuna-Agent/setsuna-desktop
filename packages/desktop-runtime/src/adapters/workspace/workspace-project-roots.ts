import { workspaceProjectRoots, type WorkspaceProject, type WorkspaceProjectRoot, type WorkspaceProjectRootInput } from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export async function normalizeProjectPath(inputPath: string): Promise<string> {
  if (typeof inputPath !== 'string' || !inputPath.trim()) throw new Error('Project path is required.');
  const trimmed = inputPath.trim();
  const expanded = trimmed.startsWith('~/') ? path.join(homedir(), trimmed.slice(2)) : trimmed;
  const canonical = await realpath(path.resolve(expanded));
  if (!(await stat(canonical)).isDirectory()) throw new Error('Project path must be a directory.');
  return canonical;
}

export async function normalizeProjectRoots(
  input: WorkspaceProjectRootInput[],
  existing?: WorkspaceProject,
): Promise<WorkspaceProjectRoot[]> {
  if (!Array.isArray(input)) throw new Error('Project directories must be an array.');
  const previous = workspaceProjectRoots(existing);
  const roots: WorkspaceProjectRoot[] = [];
  for (const item of input) {
    if (!item || typeof item.path !== 'string') throw new Error('Project directory path is required.');
    const old = previous.find((root) => root.id === item.id && root.path === item.path);
    // An offline directory must not prevent renaming a project or removing another root.
    const directory = old?.path ?? await normalizeProjectPath(item.path);
    if (roots.some((root) => root.path === directory)) continue;
    const id = item.id ?? previous.find((root) => root.path === directory)?.id ?? `root_${randomUUID().replaceAll('-', '')}`;
    if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(id) || roots.some((root) => root.id === id)) throw new Error('Project directory identity is invalid or duplicated.');
    roots.push(old ?? { id, path: directory, gitRoot: await findGitRoot(directory) });
  }
  return roots;
}

export function projectWithRoots(project: WorkspaceProject, roots: WorkspaceProjectRoot[]): WorkspaceProject {
  const next: WorkspaceProject = { ...project, roots, path: roots[0]?.path, gitRoot: roots[0]?.gitRoot };
  if (!next.path) delete next.path;
  if (!next.gitRoot) delete next.gitRoot;
  return next;
}

export async function findGitRoot(startPath: string): Promise<string | undefined> {
  let current = startPath;
  for (;;) {
    try {
      const info = await stat(path.join(current, '.git'));
      if (info.isDirectory() || info.isFile()) return current;
    } catch { /* Continue to the parent when Git metadata is absent. */ }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
