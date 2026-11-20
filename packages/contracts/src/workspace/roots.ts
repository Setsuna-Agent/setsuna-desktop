import type { WorkspaceFileRead, WorkspaceProject, WorkspaceProjectRoot, WorkspaceProjectTarget } from '../workspace.js';

/** Stable legacy identity lets existing projects migrate without invalidating references. */
export function workspaceProjectRoots(project: WorkspaceProject | null | undefined): WorkspaceProjectRoot[] {
  if (project?.roots) return project.roots;
  return project?.path ? [{ id: 'primary', path: project.path, ...(project.gitRoot ? { gitRoot: project.gitRoot } : {}) }] : [];
}

export function workspaceRootName(root: WorkspaceProjectRoot): string {
  return trimTrailingSeparators(root.path).split(/[\\/]/u).at(-1) || root.path;
}

/** Scan once from the end; an unanchored suffix regex can backtrack on long separator runs. */
function trimTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 0 && (value[end - 1] === '/' || value[end - 1] === '\\')) end -= 1;
  return value.slice(0, end);
}

export function workspaceTarget(projectId: string, rootId?: string | null): WorkspaceProjectTarget {
  return rootId ? { projectId, rootId } : projectId;
}

export function workspaceTargetProjectId(target: WorkspaceProjectTarget): string {
  return typeof target === 'string' ? target : target.projectId;
}

export function workspaceTargetRootId(target: WorkspaceProjectTarget): string | undefined {
  return typeof target === 'string' ? undefined : target.rootId;
}

export function workspaceTargetKey(target: WorkspaceProjectTarget): string {
  return JSON.stringify([workspaceTargetProjectId(target), workspaceTargetRootId(target) ?? null]);
}

export function workspaceFileKey(file: Pick<WorkspaceFileRead, 'projectId' | 'rootId' | 'path'>): string {
  return JSON.stringify([file.projectId, file.rootId ?? null, file.path]);
}

/** Identify the same entry when multiple resolved workspace directories contain it. */
export function workspaceFilePathKey(rootPath: string, relativePath: string): string {
  const windows = isWindowsPath(rootPath);
  const separator = rootPath.endsWith('/') || (windows && rootPath.endsWith('\\')) ? '' : '/';
  return comparableWorkspacePath(normalizeReferencePath(`${rootPath}${separator}${relativePath}`, windows));
}

/** A presentation view of one directory; project id and the complete directory catalog stay intact. */
export function workspaceProjectForRoot(project: WorkspaceProject, rootId?: string | null): WorkspaceProject {
  const roots = workspaceProjectRoots(project);
  const root = rootId ? roots.find((candidate) => candidate.id === rootId) : roots[0];
  if (!root) {
    if (rootId) throw new Error(`Workspace directory is no longer associated: ${rootId}`);
    return project;
  }
  return { ...project, path: root.path, gitRoot: root.gitRoot };
}

/** Renderer routing only; filesystem owners still validate canonical paths before access. */
export function resolveWorkspaceFileReference(project: WorkspaceProject, value: string, rootId?: string | null): { root: WorkspaceProjectRoot; path: string } | null {
  const roots = workspaceProjectRoots(project);
  const selected = rootId ? roots.find((root) => root.id === rootId) : roots[0];
  if (!selected) return null;
  const normalized = value.replace(/\\/gu, '/');
  const absolute = normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized);
  const target = normalizeReferencePath(absolute ? normalized : `${selected.path}/${normalized}`);
  const comparable = comparableWorkspacePath(target);
  const ordered = [...roots].sort((left, right) => right.path.length - left.path.length);
  const candidates = absolute ? ordered : [selected, ...ordered.filter((root) => root.id !== selected.id)];
  for (const root of candidates) {
    const prefix = normalizeReferencePath(root.path).replace(/\/$/u, '');
    const base = comparableWorkspacePath(prefix);
    if (comparable === base || comparable.startsWith(`${base}/`)) {
      return { root, path: target.slice(prefix.length).replace(/^\//u, '') || '.' };
    }
  }
  return null;
}

function comparableWorkspacePath(path: string): string {
  return isWindowsPath(path) ? path.toLowerCase() : path;
}

function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:(?:[\\/]|$)/u.test(path) || path.startsWith('//') || path.startsWith('\\\\');
}

function normalizeReferencePath(value: string, acceptBackslash = true): string {
  const normalized = acceptBackslash ? value.replace(/\\/gu, '/') : value;
  const minimum = normalized.startsWith('//') ? 4 : 1;
  const segments: string[] = [];
  for (const part of normalized.split('/')) {
    if (part === '.') continue;
    if (part === '..') {
      if (segments.length > minimum) segments.pop();
    } else if (part || !segments.length || (normalized.startsWith('//') && segments.length === 1)) segments.push(part);
  }
  const path = segments.join('/');
  return acceptBackslash ? trimTrailingSeparators(path) : path;
}
