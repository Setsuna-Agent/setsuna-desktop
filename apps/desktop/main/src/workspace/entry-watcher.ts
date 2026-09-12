import { watch, type FSWatcher } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Watch listed directories, not entire repositories or dependency trees. */
export async function watchWorkspaceEntries(
  workspaceRoot: string,
  directoryPaths: string[],
  onChange: () => void,
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
  const watchers = new Map<string, { directory: string; device: number; inode: number; watcher: FSWatcher }>();
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
  const close = () => {
    closed = true;
    if (timer) clearTimeout(timer);
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
  };

  const reconcile = async (initial = false) => {
    for (const target of targets) {
      try {
        const directory = await realpath(target);
        assertWithinWorkspace(root, directory);
        const stats = await stat(directory);
        if (closed) return;
        const current = watchers.get(target);
        if (current?.directory === directory && current.device === stats.dev && current.inode === stats.ino) continue;
        current?.watcher.close();
        watchers.delete(target);
        if (!stats.isDirectory()) continue;
        const watcher = watch(directory, { persistent: false }, changed);
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
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Directory path must stay inside the workspace.');
  }
}

function isMissingDirectory(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
