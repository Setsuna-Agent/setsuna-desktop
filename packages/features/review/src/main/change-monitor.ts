import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import {
  createPrunedRecursiveWatcher,
  type PrunedRecursiveWatchOptions,
  type ReviewDirectoryWatcher,
} from './pruned-recursive-watcher.js';
import { resolveDesktopReviewRepository } from './state.js';

type ReviewChangeListener = () => void;
type WatchDirectory = (
  directoryPath: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
  options?: PrunedRecursiveWatchOptions,
) => Promise<ReviewDirectoryWatcher> | ReviewDirectoryWatcher;
type VisiblePathResolver = (gitRoot: string, paths: string[]) => Promise<boolean>;

type MonitorEntry = {
  gitMetadataDirty: boolean;
  gitRoot: string;
  listeners: Set<ReviewChangeListener>;
  maxTimer: ReturnType<typeof setTimeout> | null;
  pendingPaths: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  unknownWorktreeChange: boolean;
  watchers: ReviewDirectoryWatcher[];
};

const DEFAULT_CHANGE_DEBOUNCE_MS = 300;
const CHANGE_DEBOUNCE_MAX_WAIT_MULTIPLIER = 4;
const FILE_TRANSACTION_SIBLING_PATTERN = /(^|\/)\.setsuna-(?:stage|backup)-\d+-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Watches the active Git worktree independently from whether the review panel
 * is mounted. Events are only invalidations; the renderer keeps ownership of
 * the selected comparison ref and requests the matching review snapshot.
 */
export class DesktopReviewChangeMonitor {
  private readonly entries = new Map<string, MonitorEntry>();
  private readonly pendingEntries = new Map<string, Promise<MonitorEntry>>();
  private closed = false;

  constructor(
    private readonly debounceMs = DEFAULT_CHANGE_DEBOUNCE_MS,
    private readonly watchDirectory: WatchDirectory = nodeWatchDirectory,
    private readonly resolveVisiblePath: VisiblePathResolver = hasNonIgnoredPath,
  ) {}

  async subscribe(workspaceRoot: string, listener: ReviewChangeListener): Promise<() => void> {
    const repository = await resolveDesktopReviewRepository(workspaceRoot);
    if (this.closed) return () => undefined;
    if (!repository.gitRoot || !repository.gitDirectory || !repository.gitCommonDirectory) return () => undefined;
    const key = normalizedPathKey(repository.gitRoot);
    const entry = await this.getOrCreateEntry(
      key,
      repository.gitRoot,
      [repository.gitDirectory, repository.gitCommonDirectory],
    );
    if (this.closed) return () => undefined;
    entry.listeners.add(listener);
    return () => {
      const current = this.entries.get(key);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size) return;
      this.closeEntry(current);
      this.entries.delete(key);
    };
  }

  close(): void {
    this.closed = true;
    this.pendingEntries.clear();
    for (const entry of this.entries.values()) this.closeEntry(entry);
    this.entries.clear();
  }

  private async getOrCreateEntry(key: string, gitRoot: string, gitDirectories: string[]): Promise<MonitorEntry> {
    const existing = this.entries.get(key);
    if (existing) return existing;
    let pending = this.pendingEntries.get(key);
    if (!pending) {
      pending = this.createAndStoreEntry(key, gitRoot, gitDirectories);
      this.pendingEntries.set(key, pending);
    }
    try {
      return await pending;
    } finally {
      if (this.pendingEntries.get(key) === pending) this.pendingEntries.delete(key);
    }
  }

  private async createAndStoreEntry(key: string, gitRoot: string, gitDirectories: string[]): Promise<MonitorEntry> {
    const created = await this.createEntry(gitRoot, gitDirectories);
    if (this.closed) {
      this.closeEntry(created);
      return created;
    }
    const existing = this.entries.get(key);
    if (existing) {
      this.closeEntry(created);
      return existing;
    }
    this.entries.set(key, created);
    return created;
  }

  private async createEntry(gitRoot: string, gitDirectories: string[]): Promise<MonitorEntry> {
    const entry: MonitorEntry = {
      gitMetadataDirty: false,
      gitRoot,
      listeners: new Set(),
      maxTimer: null,
      pendingPaths: new Set(),
      timer: null,
      unknownWorktreeChange: false,
      watchers: [],
    };
    try {
      entry.watchers.push(await this.watchDirectory(gitRoot, (_eventType, filename) => {
        const relativePath = normalizedWatchPath(filename);
        if (relativePath && pathIsInsideGitMetadata(relativePath)) return;
        // Local file mutations use short-lived sibling files to commit related
        // writes atomically. They are implementation details, not review files.
        if (relativePath && isFileTransactionSibling(relativePath)) return;
        if (relativePath) entry.pendingPaths.add(relativePath);
        else entry.unknownWorktreeChange = true;
        this.schedule(entry);
      }, {
        ignoreDirectories: async (relativePaths) => await ignoredGitPaths(gitRoot, relativePaths) ?? new Set(),
        shouldDescend: (relativePath) => !pathIsInsideGitMetadata(relativePath),
      }));
      for (const gitDirectory of uniquePaths(gitDirectories)) {
        entry.watchers.push(await this.watchDirectory(gitDirectory, (_eventType, filename) => {
          const relativePath = normalizedWatchPath(filename);
          if (relativePath && !isRelevantGitMetadataPath(relativePath)) return;
          entry.gitMetadataDirty = true;
          this.schedule(entry);
        }, { shouldDescend: isRelevantGitMetadataPath }));
      }
    } catch (error) {
      for (const watcher of entry.watchers) watcher.close();
      throw error;
    }
    for (const watcher of entry.watchers) {
      // A watcher failure must not terminate the main process. Window-focus and
      // manual refresh remain safe fallbacks for filesystems that cannot watch.
      watcher.on('error', () => undefined);
    }
    return entry;
  }

  private schedule(entry: MonitorEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.flushScheduled(entry), this.debounceMs);
    // Ignored build output may never become quiet. Bound the debounce window so
    // an earlier tracked or Git-metadata change cannot be starved indefinitely.
    entry.maxTimer ??= setTimeout(
      () => this.flushScheduled(entry),
      this.debounceMs * CHANGE_DEBOUNCE_MAX_WAIT_MULTIPLIER,
    );
  }

  private flushScheduled(entry: MonitorEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.maxTimer) clearTimeout(entry.maxTimer);
    entry.timer = null;
    entry.maxTimer = null;
    void this.flush(entry);
  }

  private async flush(entry: MonitorEntry): Promise<void> {
    const gitMetadataDirty = entry.gitMetadataDirty;
    const unknownWorktreeChange = entry.unknownWorktreeChange;
    const pendingPaths = [...entry.pendingPaths];
    entry.gitMetadataDirty = false;
    entry.unknownWorktreeChange = false;
    entry.pendingPaths.clear();
    const hasVisibleWorktreeChange = unknownWorktreeChange
      || await this.resolveVisiblePath(entry.gitRoot, pendingPaths);
    if (!gitMetadataDirty && !hasVisibleWorktreeChange) return;
    for (const listener of entry.listeners) listener();
  }

  private closeEntry(entry: MonitorEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.maxTimer) clearTimeout(entry.maxTimer);
    entry.timer = null;
    entry.maxTimer = null;
    for (const watcher of entry.watchers) watcher.close();
    entry.watchers = [];
  }
}

function nodeWatchDirectory(
  directoryPath: string,
  listener: Parameters<WatchDirectory>[1],
  options: PrunedRecursiveWatchOptions = {},
): Promise<ReviewDirectoryWatcher> | ReviewDirectoryWatcher {
  if (process.platform === 'linux') return createPrunedRecursiveWatcher(directoryPath, listener, options);
  return watch(directoryPath, { persistent: false, recursive: true }, listener);
}

function normalizedWatchPath(filename: string | Buffer | null): string | null {
  if (filename === null) return null;
  const value = String(filename);
  if (!value) return null;
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function pathIsInsideGitMetadata(relativePath: string): boolean {
  return relativePath === '.git' || relativePath.startsWith('.git/');
}

function isFileTransactionSibling(relativePath: string): boolean {
  return FILE_TRANSACTION_SIBLING_PATTERN.test(relativePath);
}

function isRelevantGitMetadataPath(relativePath: string): boolean {
  // Read-only Git commands can create short-lived index.lock files while
  // refreshing index metadata. Treating those transaction files as repository
  // changes feeds getState back into the watcher indefinitely on Windows. The
  // committed index/ref rename still emits its final path for real mutations.
  if (path.posix.basename(relativePath).endsWith('.lock')) return false;
  return relativePath !== 'objects'
    && !relativePath.startsWith('objects/')
    && relativePath !== 'logs'
    && !relativePath.startsWith('logs/');
}

async function hasNonIgnoredPath(gitRoot: string, paths: string[]): Promise<boolean> {
  if (!paths.length) return false;
  const uniquePaths = [...new Set(paths)];
  const ignored = await ignoredGitPaths(gitRoot, uniquePaths);
  if (!ignored) return true;
  return uniquePaths.some((filePath) => !ignored.has(filePath));
}

function ignoredGitPaths(gitRoot: string, paths: string[]): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['check-ignore', '-z', '--stdin'], {
      cwd: gitRoot,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stdin.on('error', () => undefined);
    child.once('error', () => resolve(null));
    child.once('close', (code) => {
      if (code !== 0 && code !== 1) {
        resolve(null);
        return;
      }
      const ignored = Buffer.concat(chunks).toString('utf8').split('\0').filter(Boolean);
      resolve(new Set(ignored.map((filePath) => filePath.split(path.sep).join('/'))));
    });
    child.stdin.end(`${paths.join('\0')}\0`);
  });
}

function normalizedPathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function uniquePaths(values: string[]): string[] {
  const pathsByKey = new Map(values.map((value) => [normalizedPathKey(value), path.resolve(value)]));
  return [...pathsByKey.values()];
}
