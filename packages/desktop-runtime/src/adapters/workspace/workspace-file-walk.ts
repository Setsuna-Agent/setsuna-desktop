import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { isIgnoredWorkspaceEntryName, isWorkspaceTemporaryDirectoryName } from '@setsuna-desktop/contracts';

type WorkspaceWalkOptions = Readonly<{ signal?: AbortSignal; includeIgnored?: boolean; onReadError?(directory: string, error: unknown): void }>;

export async function walkWorkspaceFiles(root: string, onFile: (filePath: string) => boolean | Promise<boolean>,
  options: WorkspaceWalkOptions = {}): Promise<boolean> {
  options.signal?.throwIfAborted();
  const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    options.onReadError?.(root, error);
    return [];
  });
  for (const entry of entries) {
    // Import staging can change outside the workspace lock until the directory is published.
    const ignored = options.includeIgnored
      ? entry.isDirectory() && isWorkspaceTemporaryDirectoryName(entry.name)
      : isIgnoredWorkspaceEntryName(entry.name);
    if (entry.isSymbolicLink() || ignored) continue;
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!(await walkWorkspaceFiles(absolutePath, onFile, options))) return false;
    } else if (entry.isFile() && !(await onFile(absolutePath))) {
      return false;
    }
  }
  return true;
}
