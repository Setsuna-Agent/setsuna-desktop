import { watch, type FSWatcher } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppServerNotificationBus } from '../../ports/app-server-notification-bus.js';
import type { RuntimeFactory } from '../types.js';
import { APP_SERVER_DEFAULT_CONNECTION_ID } from './command-exec.js';
import { AppServerRpcError } from './errors.js';
import { recordInput, requiredRawString, requiredString } from './input.js';

const APP_SERVER_FS_CHANGED_DEBOUNCE_MS = 200;

type AppServerFsPathMode = 'existing' | 'target';

type AppServerFsResolvedPath = {
  absolutePath: string;
};

type AppServerFsExistingParent = {
  originalPath: string;
  realPath: string;
};

export type AppServerFsManager = {
  watch(runtime: RuntimeFactory, params: unknown, connectionId?: string): Promise<{ path: string }>;
  unwatch(params: unknown, connectionId?: string): Promise<Record<string, never>>;
  terminateConnection(connectionId: string): void;
  terminateAll(): void;
};

type AppServerFsWatchEntry = {
  changedPaths: Set<string>;
  closed: boolean;
  connectionId: string;
  debounceTimer?: NodeJS.Timeout;
  path: string;
  watchId: string;
  watcher: FSWatcher;
};

export function createAppServerFsManager(notificationBus: AppServerNotificationBus): AppServerFsManager {
  const watches = new Map<string, AppServerFsWatchEntry>();

  return {
    watch: (runtime, params, connectionId) => appServerFsWatch(runtime, params, appServerFsConnectionId(connectionId), watches, notificationBus),
    unwatch: async (params, connectionId) => {
      const watchId = appServerFsWatchId(params);
      const key = appServerFsWatchKey(appServerFsConnectionId(connectionId), watchId);
      const entry = watches.get(key);
      if (entry) {
        watches.delete(key);
        closeAppServerFsWatchEntry(entry);
      }
      return {};
    },
    terminateConnection: (connectionId) => {
      const normalizedConnectionId = appServerFsConnectionId(connectionId);
      for (const [key, entry] of watches.entries()) {
        if (entry.connectionId !== normalizedConnectionId) continue;
        watches.delete(key);
        closeAppServerFsWatchEntry(entry);
      }
    },
    terminateAll: () => {
      for (const entry of watches.values()) closeAppServerFsWatchEntry(entry);
      watches.clear();
    },
  };
}

export async function appServerFsReadFile(runtime: RuntimeFactory, params: unknown): Promise<{ dataBase64: string }> {
  const target = await resolveAppServerFsPath(runtime, recordInput(params).path, 'fs/readFile path', 'existing');
  const data = await readFile(target.absolutePath);
  return { dataBase64: data.toString('base64') };
}

export async function appServerFsWriteFile(runtime: RuntimeFactory, params: unknown): Promise<Record<string, never>> {
  const input = recordInput(params);
  const target = await resolveAppServerFsPath(runtime, input.path, 'fs/writeFile path', 'target');
  await rejectSymlinkTargetForWrite(target.absolutePath, 'fs/writeFile');
  const data = strictBase64Decode(input.dataBase64 ?? input.data_base64, 'fs/writeFile requires valid base64 dataBase64');
  await mkdir(path.dirname(target.absolutePath), { recursive: true });
  await writeFile(target.absolutePath, data);
  return {};
}

export async function appServerFsCreateDirectory(runtime: RuntimeFactory, params: unknown): Promise<Record<string, never>> {
  const input = recordInput(params);
  const target = await resolveAppServerFsPath(runtime, input.path, 'fs/createDirectory path', 'target');
  await mkdir(target.absolutePath, { recursive: input.recursive !== false });
  return {};
}

export async function appServerFsGetMetadata(runtime: RuntimeFactory, params: unknown): Promise<{
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  createdAtMs: number;
  modifiedAtMs: number;
}> {
  const target = await resolveAppServerFsPath(runtime, recordInput(params).path, 'fs/getMetadata path', 'existing');
  const linkStats = await lstat(target.absolutePath);
  const targetStats = linkStats.isSymbolicLink()
    ? await realpath(target.absolutePath).then((real) => lstat(real))
    : linkStats;
  return {
    isDirectory: targetStats.isDirectory(),
    isFile: targetStats.isFile(),
    isSymlink: linkStats.isSymbolicLink(),
    createdAtMs: Math.trunc(linkStats.birthtimeMs || 0),
    modifiedAtMs: Math.trunc(linkStats.mtimeMs || 0),
  };
}

export async function appServerFsReadDirectory(runtime: RuntimeFactory, params: unknown): Promise<{
  entries: Array<{ fileName: string; isDirectory: boolean; isFile: boolean }>;
}> {
  const target = await resolveAppServerFsPath(runtime, recordInput(params).path, 'fs/readDirectory path', 'existing');
  const entries = await readdir(target.absolutePath, { withFileTypes: true });
  return {
    entries: entries
      .map((entry) => ({
        fileName: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }))
      .sort((left, right) => left.fileName.localeCompare(right.fileName)),
  };
}

export async function appServerFsRemove(runtime: RuntimeFactory, params: unknown): Promise<Record<string, never>> {
  const input = recordInput(params);
  const target = await resolveAppServerFsPath(runtime, input.path, 'fs/remove path', 'target');
  await rm(target.absolutePath, {
    recursive: input.recursive !== false,
    force: input.force !== false,
  });
  return {};
}

export async function appServerFsCopy(runtime: RuntimeFactory, params: unknown): Promise<Record<string, never>> {
  const input = recordInput(params);
  const source = await resolveAppServerFsPath(runtime, input.sourcePath ?? input.source_path, 'fs/copy sourcePath', 'existing');
  const destination = await resolveAppServerFsPath(
    runtime,
    input.destinationPath ?? input.destination_path,
    'fs/copy destinationPath',
    'target',
  );
  await rejectSymlinkTargetForWrite(destination.absolutePath, 'fs/copy');
  await cp(source.absolutePath, destination.absolutePath, {
    recursive: input.recursive === true,
    force: true,
    errorOnExist: false,
  });
  return {};
}

async function appServerFsWatch(
  runtime: RuntimeFactory,
  rawParams: unknown,
  connectionId: string,
  watches: Map<string, AppServerFsWatchEntry>,
  notificationBus: AppServerNotificationBus,
): Promise<{ path: string }> {
  const input = recordInput(rawParams);
  const watchId = requiredString(input.watchId ?? input.watch_id, 'watchId');
  const target = await resolveAppServerFsWatchPath(runtime, input.path, 'fs/watch path');
  const key = appServerFsWatchKey(connectionId, watchId);
  if (watches.has(key)) throw new AppServerRpcError(-32600, `watchId already exists: ${watchId}`);

  const targetStats = await lstat(target.absolutePath).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null;
    throw error;
  });
  const watchPath = targetStats?.isDirectory() ? target.absolutePath : path.dirname(target.absolutePath);
  const watchedFileName = targetStats?.isDirectory() ? null : path.basename(target.absolutePath);

  let entry: AppServerFsWatchEntry | undefined;
  let watcher: FSWatcher;
  try {
    watcher = watch(watchPath, { persistent: false }, (_eventType, filename) => {
      const changedPath = appServerFsChangedPath(target.absolutePath, watchedFileName, filename);
      if (!changedPath || !entry) return;
      enqueueAppServerFsChanged(entry, changedPath, notificationBus);
    });
  } catch (error) {
    throw new AppServerRpcError(-32603, `failed to watch path: ${error instanceof Error ? error.message : String(error)}`);
  }

  entry = {
    changedPaths: new Set(),
    closed: false,
    connectionId,
    path: target.absolutePath,
    watchId,
    watcher,
  };
  watches.set(key, entry);
  watcher.on('error', () => {
    watches.delete(key);
    closeAppServerFsWatchEntry(entry);
  });
  return { path: target.absolutePath };
}

async function resolveAppServerFsPath(
  runtime: RuntimeFactory,
  rawPath: unknown,
  name: string,
  mode: AppServerFsPathMode,
): Promise<AppServerFsResolvedPath> {
  const rawAbsolutePath = requiredRawString(rawPath, name);
  if (!path.isAbsolute(rawAbsolutePath)) throw new AppServerRpcError(-32602, `${name} must be an absolute path`);
  const absolutePath = path.resolve(rawAbsolutePath);
  const roots = await workspaceRoots(runtime);
  if (mode === 'existing') {
    const resolved = await realpath(absolutePath);
    if (!roots.some((root) => pathIsWithin(root, resolved))) {
      throw new AppServerRpcError(-32600, `fs path is outside registered workspaces: ${absolutePath}`);
    }
    return { absolutePath };
  }

  const parent = await realExistingParent(path.dirname(absolutePath));
  const canonicalTarget = path.resolve(parent.realPath, path.relative(parent.originalPath, absolutePath));
  if (!roots.some((root) => pathIsWithin(root, parent.realPath) && pathIsWithin(root, canonicalTarget))) {
    throw new AppServerRpcError(-32600, `fs path is outside registered workspaces: ${absolutePath}`);
  }
  return { absolutePath: canonicalTarget };
}

async function resolveAppServerFsWatchPath(
  runtime: RuntimeFactory,
  rawPath: unknown,
  name: string,
): Promise<AppServerFsResolvedPath> {
  const rawAbsolutePath = requiredRawString(rawPath, name);
  if (!path.isAbsolute(rawAbsolutePath)) throw new AppServerRpcError(-32602, `${name} must be an absolute path`);
  const absolutePath = path.resolve(rawAbsolutePath);
  const roots = await workspaceRoots(runtime);
  const resolvedExistingPath = await realpath(absolutePath).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null;
    throw error;
  });
  if (resolvedExistingPath) {
    if (!roots.some((root) => pathIsWithin(root, resolvedExistingPath))) {
      throw new AppServerRpcError(-32600, `fs path is outside registered workspaces: ${absolutePath}`);
    }
    return { absolutePath };
  }

  const parent = await realExistingParent(path.dirname(absolutePath));
  const canonicalTarget = path.resolve(parent.realPath, path.relative(parent.originalPath, absolutePath));
  if (!roots.some((root) => pathIsWithin(root, parent.realPath) && pathIsWithin(root, canonicalTarget))) {
    throw new AppServerRpcError(-32600, `fs path is outside registered workspaces: ${absolutePath}`);
  }
  return { absolutePath };
}

async function workspaceRoots(runtime: RuntimeFactory): Promise<string[]> {
  const projects = (await runtime.workspaceProjects.listProjects()).projects;
  const roots = await Promise.all(projects.map((project) => realpath(project.path).catch(() => path.resolve(project.path))));
  return roots.map((root) => path.resolve(root));
}

async function realExistingParent(startPath: string): Promise<AppServerFsExistingParent> {
  let current = path.resolve(startPath);
  for (;;) {
    try {
      const stats = await lstat(current);
      if (!stats.isDirectory()) throw new AppServerRpcError(-32600, `fs parent is not a directory: ${current}`);
      return {
        originalPath: current,
        realPath: await realpath(current),
      };
    } catch (error) {
      if (error instanceof AppServerRpcError) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function rejectSymlinkTargetForWrite(targetPath: string, methodName: string): Promise<void> {
  const stats = await lstat(targetPath).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null;
    throw error;
  });
  if (stats?.isSymbolicLink()) {
    throw new AppServerRpcError(-32600, `${methodName} refuses to write through symlinks`);
  }
}

function strictBase64Decode(value: unknown, messagePrefix: string): Buffer {
  if (typeof value !== 'string') throw new AppServerRpcError(-32602, `${messagePrefix}: expected string`);
  const normalized = value.trim();
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new AppServerRpcError(-32602, `${messagePrefix}: invalid base64`);
  }
  return decoded;
}

function appServerFsWatchId(params: unknown): string {
  const input = recordInput(params);
  return requiredString(input.watchId ?? input.watch_id, 'watchId');
}

function appServerFsConnectionId(connectionId: string | undefined): string {
  const normalized = connectionId?.trim();
  return normalized || APP_SERVER_DEFAULT_CONNECTION_ID;
}

function appServerFsWatchKey(connectionId: string, watchId: string): string {
  return JSON.stringify([connectionId, watchId]);
}

function appServerFsChangedPath(
  targetPath: string,
  watchedFileName: string | null,
  filename: string | Buffer | null,
): string | null {
  if (!watchedFileName) {
    return filename ? path.join(targetPath, filename.toString()) : targetPath;
  }
  if (filename && filename.toString() !== watchedFileName) return null;
  return targetPath;
}

function enqueueAppServerFsChanged(
  entry: AppServerFsWatchEntry,
  changedPath: string,
  notificationBus: AppServerNotificationBus,
): void {
  if (entry.closed) return;
  entry.changedPaths.add(changedPath);
  if (entry.debounceTimer) return;
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = undefined;
    if (entry.closed || entry.changedPaths.size === 0) return;
    const changedPaths = [...entry.changedPaths].sort((left, right) => left.localeCompare(right));
    entry.changedPaths.clear();
    notificationBus.publish({
      method: 'fs/changed',
      params: {
        watchId: entry.watchId,
        changedPaths,
      },
    }, { connectionId: entry.connectionId });
  }, APP_SERVER_FS_CHANGED_DEBOUNCE_MS);
  entry.debounceTimer.unref();
}

function closeAppServerFsWatchEntry(entry: AppServerFsWatchEntry): void {
  entry.closed = true;
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
    entry.debounceTimer = undefined;
  }
  entry.changedPaths.clear();
  entry.watcher.close();
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}
