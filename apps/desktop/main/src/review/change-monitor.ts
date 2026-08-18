import { spawn } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { resolveDesktopReviewRepository } from './state.js';

type ReviewChangeListener = () => void;
type WatchDirectory = (
  directoryPath: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => FSWatcher;
type VisiblePathResolver = (gitRoot: string, paths: string[]) => Promise<boolean>;

type MonitorEntry = {
  gitMetadataDirty: boolean;
  gitRoot: string;
  listeners: Set<ReviewChangeListener>;
  maxTimer: ReturnType<typeof setTimeout> | null;
  pendingPaths: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  unknownWorktreeChange: boolean;
  watchers: FSWatcher[];
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
    let entry = this.entries.get(key);
    if (!entry) {
      entry = this.createEntry(repository.gitRoot, [repository.gitDirectory, repository.gitCommonDirectory]);
      this.entries.set(key, entry);
    }
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
    for (const entry of this.entries.values()) this.closeEntry(entry);
    this.entries.clear();
  }

  private createEntry(gitRoot: string, gitDirectories: string[]): MonitorEntry {
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
      entry.watchers.push(this.watchDirectory(gitRoot, (_eventType, filename) => {
        const relativePath = normalizedWatchPath(filename);
        if (relativePath && pathIsInsideGitMetadata(relativePath)) return;
        // Local file mutations use short-lived sibling files to commit related
        // writes atomically. They are implementation details, not review files.
        if (relativePath && isFileTransactionSibling(relativePath)) return;
        if (relativePath) entry.pendingPaths.add(relativePath);
        else entry.unknownWorktreeChange = true;
        this.schedule(entry);
      }));
      for (const gitDirectory of uniquePaths(gitDirectories)) {
        entry.watchers.push(this.watchDirectory(gitDirectory, (_eventType, filename) => {
          const relativePath = normalizedWatchPath(filename);
          if (relativePath && !isRelevantGitMetadataPath(relativePath)) return;
          entry.gitMetadataDirty = true;
          this.schedule(entry);
        }));
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

function nodeWatchDirectory(directoryPath: string, listener: Parameters<WatchDirectory>[1]): FSWatcher {
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
  return !relativePath.startsWith('objects/') && !relativePath.startsWith('logs/');
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
