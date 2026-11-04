import { lstatSync } from 'node:fs';
import path from 'node:path';

/**
 * Retired restore transactions may have moved live files into rollback storage.
 * Never open stores, probe writes or replay their journal: recovery must be offline.
 * Even `validated` journals are retained conservatively rather than trusting an
 * obsolete transaction format or deleting the only remaining rollback copy.
 */
export function legacyRestoreStartupError(dataRoot: string): string | undefined {
  const journalPath = path.join(dataRoot, '.webdav-sync-restore.json');
  try {
    lstatSync(journalPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    return `Legacy restore metadata cannot be inspected safely: ${journalPath}. Preserve the data root and rollback files for offline recovery.`;
  }
  // Existence is enough to fail closed: malformed files, directories and symlinks
  // must not bypass protection, and no journal-controlled paths are ever followed.
  return `A legacy restore journal requires offline recovery before this data location can be opened: ${journalPath}. Preserve the data root and rollback files.`;
}
