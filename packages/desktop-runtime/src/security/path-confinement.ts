import { lstat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolve a path below an already-authorized root while refusing every symbolic
 * link component. This is used for stores where following a user-created link
 * would silently expand the runtime's filesystem capability.
 */
export async function resolveConfinedPathWithoutSymlinks(
  root: string,
  target: string,
  options: { allowMissing?: boolean; label?: string } = {},
): Promise<string> {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const relative = path.relative(rootPath, targetPath);
  const label = options.label ?? 'Path';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its allowed root: ${target}`);
  }

  const rootStats = await lstat(rootPath);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`${label} root must be a real directory: ${rootPath}`);
  }

  let current = rootPath;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error(`${label} refuses symbolic links: ${current}`);
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT') && options.allowMissing !== false) break;
      throw error;
    }
  }
  return targetPath;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
