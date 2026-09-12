export function normalizeProjectTreePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/?$/, '').replace(/\/+$/, '');
}

export function workspaceEntryParent(entryPath: string): string {
  const normalized = normalizeProjectTreePath(entryPath);
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
}

export function isWorkspaceEntryWithin(entryPath: string, parentPath: string): boolean {
  const normalized = normalizeProjectTreePath(entryPath);
  const parent = normalizeProjectTreePath(parentPath);
  return normalized === parent || normalized.startsWith(`${parent}/`);
}

/** Match complete path segments so renaming src/app never changes src/application. */
export function renamedWorkspaceEntryPath(entryPath: string, previousPath: string, nextPath: string): string {
  const normalized = normalizeProjectTreePath(entryPath);
  const previous = normalizeProjectTreePath(previousPath);
  if (normalized === previous) return nextPath;
  return normalized.startsWith(`${previous}/`) ? `${nextPath}${normalized.slice(previous.length)}` : entryPath;
}

export function workspaceEntryAncestors(entryPath: string): string[] {
  const parts = normalizeProjectTreePath(entryPath).split('/').filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}
