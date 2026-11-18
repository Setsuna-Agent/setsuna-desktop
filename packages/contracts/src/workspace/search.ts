const ignoredWorkspaceEntryNames = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'target', 'release-artifacts']);

export function isIgnoredWorkspaceEntryName(name: string): boolean {
  return ignoredWorkspaceEntryNames.has(name);
}

/** Literal suffixes only: accepting globs here could override workspace ignore rules. */
export function normalizeWorkspaceSearchExtensions(extensions: readonly string[] = []): string[] {
  const normalized = extensions.flatMap((value) => value.split(/[\s,;，；]+/u))
    .filter(Boolean)
    .map((value) => value.replace(/^\*?\./u, '').toLowerCase());
  if (normalized.some((value) => !/^[a-z0-9][a-z0-9._+-]*$/u.test(value))) {
    throw new Error('Invalid file extension.');
  }
  return [...new Set(normalized)];
}
