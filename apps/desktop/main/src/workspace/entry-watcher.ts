import { isIgnoredWorkspaceEntryName, normalizeWorkspaceSearchExtensions, type DesktopWorkspaceEntriesWatchOptions } from '@setsuna-desktop/contracts';
import { watch, type FSWatcher } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Publish changes within the listed directories. Descendant entries are opt-in. */
export async function watchWorkspaceEntries(
  workspaceRoot: string,
  directoryPaths: string[],
  onChange: () => void,
  options: DesktopWorkspaceEntriesWatchOptions = {},
): Promise<() => void> {
  if (typeof workspaceRoot !== 'string' || !path.isAbsolute(workspaceRoot)) {
    throw new Error('Workspace root must be an absolute path.');
  }
  if (!Array.isArray(directoryPaths)) throw new Error('Directory paths are required.');
  const root = await realpath(workspaceRoot);
  const targets = [...new Set(directoryPaths)].map((relativePath) => {
    if (typeof relativePath !== 'string' || path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath)) {
      throw new Error('Directory paths must be relative to the workspace.');
    }
    const target = path.resolve(root, relativePath.replace(/\\/gu, '/'));
    assertWithinWorkspace(root, target);
    return target;
  });
  const includeDescendants = options.recursive === true;
  const contentSuffixes = normalizeWorkspaceSearchExtensions(options.contentExtensions).map((extension) => `.${extension}`);
  const watchers = new Map<string, { directory: string; device: number; inode: number; watcher: FSWatcher }>();
  // Windows handles on descendants can block renaming their parent. One native
  // recursive root handle avoids those locks; filter events to the listed paths.
  const windows = process.platform === 'win32';
  const recursive = includeDescendants || windows;
  const comparablePath = (directory: string) => windows ? directory.toLowerCase() : directory;
  let recursiveWatcher: FSWatcher | undefined;
  let recursiveDirectories: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let refreshing = true;
  let pending = false;
  const changed = () => {
    if (closed) return;
    pending = true;
    if (timer || refreshing) return;
    timer = setTimeout(() => { timer = undefined; void refresh(); }, 150);
  };
  function matchesContent(event: string, filename: string | Buffer | null) {
    if (event !== 'change' || !contentSuffixes.length || !filename) return true;
    const name = filename.toString().toLowerCase();
    return contentSuffixes.some((suffix) => name.endsWith(suffix));
  }
  const close = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    recursiveWatcher?.close();
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
  };

  const reconcile = async (initial = false) => {
    const directories = new Set(targets);
    for (const target of targets) {
      try {
        const directory = await realpath(target);
        assertWithinWorkspace(root, directory);
        const stats = await stat(directory);
        if (closed) return;
        if (recursive) {
          if (stats.isDirectory()) directories.add(directory);
          continue;
        }
        const current = watchers.get(target);
        if (current?.directory === directory && current.device === stats.dev && current.inode === stats.ino) continue;
        current?.watcher.close();
        watchers.delete(target);
        if (!stats.isDirectory()) continue;
        const watcher = watch(directory, { persistent: false }, (event, filename) => {
          if (matchesContent(event, filename)) changed();
        });
        watchers.set(target, { directory, device: stats.dev, inode: stats.ino, watcher });
        watcher.on('error', () => {
          if (watchers.get(target)?.watcher === watcher) {
            watcher.close();
            watchers.delete(target);
          }
          changed();
        });
      } catch (error) {
        watchers.get(target)?.watcher.close();
        watchers.delete(target);
        if (initial && !isMissingDirectory(error)) throw error;
      }
    }
    if (recursive && !closed && targets.length) {
      recursiveDirectories = [...directories].map(comparablePath);
      if (!recursiveWatcher) {
        try {
          const watcher = watch(root, { persistent: false, recursive: true }, (event, filename) => {
            if (!matchesContent(event, filename)) return;
            if (filename) {
              const absolutePath = path.resolve(root, filename.toString());
              if (!isWithinWorkspace(root, absolutePath)) return;
              if (includeDescendants && path.relative(root, absolutePath).split(path.sep).some(isIgnoredWorkspaceEntryName)) return;
              const entry = comparablePath(absolutePath);
              // Ancestor changes can create or replace a requested directory.
              if (!recursiveDirectories.some((directory) => directory === entry
                || directory === path.dirname(entry) || directory.startsWith(`${entry}${path.sep}`)
                || (includeDescendants && isWithinWorkspace(directory, entry)))) return;
            }
            changed();
          });
          recursiveWatcher = watcher;
          watcher.on('error', () => {
            if (recursiveWatcher === watcher) {
              watcher.close();
              recursiveWatcher = undefined;
            }
            changed();
          });
        } catch (error) {
          if (initial) throw error;
        }
      }
    }
  };
  const refresh = async () => {
    refreshing = true;
    pending = false;
    try {
      // fs.watch follows directory inodes. Attach missing/replaced directories before
      // publishing, so subsequent child edits are observed without a UI resubscription.
      await reconcile();
      if (!closed) onChange();
    } finally {
      refreshing = false;
      if (pending) changed();
    }
  };
  try {
    await reconcile(true);
  } catch (error) {
    close();
    throw error;
  } finally {
    refreshing = false;
  }
  if (pending) changed();
  return close;
}

function assertWithinWorkspace(root: string, target: string): void {
  if (!isWithinWorkspace(root, target)) throw new Error('Directory path must stay inside the workspace.');
}

function isWithinWorkspace(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isMissingDirectory(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
