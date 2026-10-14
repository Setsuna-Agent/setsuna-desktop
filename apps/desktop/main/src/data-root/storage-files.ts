import {
  DESKTOP_STORAGE_CATEGORY_IDS,
  type DesktopStorageCategory,
  type DesktopStorageUsage,
} from '@setsuna-desktop/contracts';
import { lstat, opendir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { migrationCategory } from './manifest.js';

const CACHE_DIRECTORIES = new Set([
  'cache', 'code cache', 'gpucache', 'shadercache', 'grshadercache',
  'dawncache', 'dawngraphitecache', 'dawnwebgpucache',
]);
const LOG_ROOTS = ['logs', path.join('runtime', 'logs')];

export async function scanDesktopStorage(root: string): Promise<DesktopStorageUsage> {
  const sizes = new Map<DesktopStorageCategory, number>(DESKTOP_STORAGE_CATEGORY_IDS.map((id) => [id, 0]));
  const incomplete = await visitStorageFiles(root, [''], async (_file, relativePath, size) => {
    const category = storageCategory(relativePath);
    sizes.set(category, sizes.get(category)! + size);
  });
  const categories = [...sizes].map(([id, totalBytes]) => ({ id, totalBytes }));
  return { categories, totalBytes: categories.reduce((sum, item) => sum + item.totalBytes, 0), incomplete };
}

export async function clearDesktopLogs(root: string): Promise<void> {
  // Keep directories in place for live writers. Never recursively remove a path supplied by renderer.
  const incomplete = await visitStorageFiles(root, LOG_ROOTS, (file) => unlink(file));
  if (incomplete) throw new Error('Some log files could not be removed.');
}

function storageCategory(relativePath: string): DesktopStorageCategory {
  const parts = relativePath.split(path.sep).map((part) => part.toLowerCase());
  if (parts[0] === 'logs' || (parts[0] === 'runtime' && parts[1] === 'logs')) return 'logs';
  const profileDirectory = parts[0] === 'partitions' ? parts[2] : parts[0];
  if (profileDirectory && CACHE_DIRECTORIES.has(profileDirectory)) return 'cache';
  if (parts[0] === 'runtime' && parts[1] === 'tool-results') return 'conversations';
  if (parts[0] === 'runtime' && parts[1] === 'worktrees') return 'projects_capabilities';
  return migrationCategory(relativePath);
}

async function visitStorageFiles(
  root: string,
  relativeRoots: string[],
  visit: (file: string, relativePath: string, size: number) => Promise<void>,
): Promise<boolean> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Data directory is unavailable.');
  const canonicalRoot = await realpath(root);
  const pending = relativeRoots.map((relative) => path.join(canonicalRoot, relative));
  let incomplete = false;
  while (pending.length) {
    const directory = pending.pop()!;
    try {
      const info = await lstat(directory);
      // A data directory can contain linked workspaces or toolchains. Do not follow them, even
      // when a parent was replaced while scanning. Canonical paths also guard the fixed log roots.
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) {
        incomplete = true;
        continue;
      }
      const entries = await opendir(directory);
      for await (const entry of entries) {
        const file = path.join(directory, entry.name);
        try {
          const stats = await lstat(file);
          if (stats.isDirectory()) pending.push(file);
          else if (stats.isFile()) await visit(file, path.relative(canonicalRoot, file), stats.size);
          // Symlink targets are outside this inventory, including links to user-owned attachments.
        } catch (error) {
          if (!isMissing(error)) incomplete = true;
        }
      }
    } catch (error) {
      if (!isMissing(error)) incomplete = true;
    }
  }
  return incomplete;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}
