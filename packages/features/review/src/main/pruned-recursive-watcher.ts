import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

export type ReviewDirectoryWatcher = {
  close: () => void;
  on: (event: 'error', listener: (error: Error) => void) => unknown;
};

export type PrunedRecursiveWatchOptions = {
  ignoreDirectories?: (relativePaths: string[]) => Promise<ReadonlySet<string>>;
  shouldDescend?: (relativePath: string) => boolean;
  watchDirectory?: SingleDirectoryWatch;
};

type DirectoryEntry = {
  absolutePath: string;
  relativePath: string;
};

type SingleDirectoryWatch = (
  directoryPath: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => ReviewDirectoryWatcher;

/**
 * Linux does not have a native recursive inotify watch. Node emulates one by
 * watching every descendant, including ignored dependency files. This adapter
 * watches directories only and applies Git-aware pruning before descending.
 */
export async function createPrunedRecursiveWatcher(
  rootPath: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
  options: PrunedRecursiveWatchOptions = {},
): Promise<ReviewDirectoryWatcher> {
  const watcher = new PrunedRecursiveWatcher(rootPath, listener, options);
  await watcher.start();
  return watcher;
}

class PrunedRecursiveWatcher extends EventEmitter implements ReviewDirectoryWatcher {
  private closed = false;
  private reconcilePending = false;
  private reconcileTail = Promise.resolve();
  private readonly rootPath: string;
  private readonly watchers = new Map<string, ReviewDirectoryWatcher>();

  constructor(
    rootPath: string,
    private readonly listener: (eventType: string, filename: string | Buffer | null) => void,
    private readonly options: PrunedRecursiveWatchOptions,
  ) {
    super();
    this.rootPath = path.resolve(rootPath);
    // Watcher errors are advisory; the review surface still refreshes on focus.
    this.on('error', () => undefined);
  }

  async start(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }

  private async reconcile(): Promise<void> {
    if (this.closed) return;
    const seen = new Set<string>();
    let level: DirectoryEntry[] = [{ absolutePath: this.rootPath, relativePath: '' }];

    this.ensureWatcher(level[0]!);
    seen.add(this.rootPath);

    while (level.length && !this.closed) {
      const candidates: DirectoryEntry[] = [];
      for (const directory of level) {
        let entries;
        try {
          entries = await readdir(directory.absolutePath, { withFileTypes: true });
        } catch (error) {
          if (isMissingPathError(error)) continue;
          throw error;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
          const relativePath = joinRelativePath(directory.relativePath, entry.name);
          if (this.options.shouldDescend?.(relativePath) === false) continue;
          candidates.push({
            absolutePath: path.join(directory.absolutePath, entry.name),
            relativePath,
          });
        }
      }

      const ignored = await this.ignoredDirectoryKeys(candidates.map((entry) => entry.relativePath));
      level = candidates.filter((entry) => !ignored.has(normalizedRelativePath(entry.relativePath)));
      for (const directory of level) {
        if (this.closed) return;
        this.ensureWatcher(directory);
        seen.add(path.resolve(directory.absolutePath));
      }
    }

    if (this.closed) return;
    for (const [directoryPath, watcher] of this.watchers) {
      if (seen.has(directoryPath)) continue;
      watcher.close();
      this.watchers.delete(directoryPath);
    }
  }

  private ensureWatcher(directory: DirectoryEntry): void {
    const directoryPath = path.resolve(directory.absolutePath);
    if (this.watchers.has(directoryPath)) return;
    const watchDirectory = this.options.watchDirectory ?? nodeWatchSingleDirectory;
    const watcher = watchDirectory(directoryPath, (eventType, filename) => {
      if (this.closed) return;
      const relativePath = filename === null
        ? null
        : joinRelativePath(directory.relativePath, String(filename));
      this.listener(eventType, relativePath);
      if (relativePath && path.posix.basename(relativePath) === '.gitignore') this.queueReconcile();
      if (eventType === 'rename' && relativePath) {
        this.inspectTopologyChange(path.join(this.rootPath, ...relativePath.split('/')));
      }
    });
    watcher.on('error', (error) => this.emit('error', error));
    this.watchers.set(directoryPath, watcher);
  }

  private inspectTopologyChange(absolutePath: string): void {
    void lstat(absolutePath).then((stats) => {
      if (stats.isDirectory() && !stats.isSymbolicLink()) this.queueReconcile();
    }, (error: unknown) => {
      if (isMissingPathError(error)) {
        if (this.hasWatchedDescendant(absolutePath)) this.queueReconcile();
        return;
      }
      this.emit('error', asError(error));
    });
  }

  private hasWatchedDescendant(absolutePath: string): boolean {
    const prefix = `${path.resolve(absolutePath)}${path.sep}`;
    for (const watchedPath of this.watchers.keys()) {
      if (watchedPath === absolutePath || watchedPath.startsWith(prefix)) return true;
    }
    return false;
  }

  private queueReconcile(): void {
    if (this.closed || this.reconcilePending) return;
    this.reconcilePending = true;
    this.reconcileTail = this.reconcileTail.then(async () => {
      this.reconcilePending = false;
      await this.reconcile();
    }).catch((error: unknown) => {
      this.reconcilePending = false;
      if (!this.closed) this.emit('error', asError(error));
    });
  }

  private async ignoredDirectoryKeys(relativePaths: string[]): Promise<Set<string>> {
    if (!relativePaths.length || !this.options.ignoreDirectories) return new Set();
    const ignored = await this.options.ignoreDirectories(relativePaths);
    return new Set([...ignored].map(normalizedRelativePath));
  }
}

function nodeWatchSingleDirectory(
  directoryPath: string,
  listener: Parameters<SingleDirectoryWatch>[1],
): ReviewDirectoryWatcher {
  return watch(directoryPath, { persistent: false }, listener);
}

function joinRelativePath(parentPath: string, childPath: string): string {
  return normalizedRelativePath(parentPath ? `${parentPath}/${childPath}` : childPath);
}

function normalizedRelativePath(value: string): string {
  return value.split(path.sep).join('/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
