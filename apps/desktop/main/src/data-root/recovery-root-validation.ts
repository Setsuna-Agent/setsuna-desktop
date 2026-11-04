import type { Stats } from 'node:fs';

/** Recovery must never open a symlink or treat an unavailable path as a directory. */
export function isPlainDataRootDirectory(stats: Stats | null): boolean {
  return Boolean(stats?.isDirectory() && !stats.isSymbolicLink());
}

/** The Electron default has no ownership marker requirement; custom roots do. */
export function hasExpectedDataRootMarker(
  isDefaultRoot: boolean,
  actualRootId: string | undefined,
  expectedRootId: string | undefined,
): boolean {
  return isDefaultRoot || actualRootId === expectedRootId;
}
