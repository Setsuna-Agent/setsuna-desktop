import type {
  DesktopDataRootRetainedBackupInspection,
} from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomically } from './atomic-json.js';
import { readDataRootMarkerSync, samePath } from './bootstrap.js';
import { dataRootBootstrapLayout, desktopDataLayout } from './layout.js';
import type {
  RetainedDataRootBackup,
  RetainedDataRootBackupRegistry,
} from './model.js';

type RetainedBackupRegistration = {
  dataRoot: string;
  rootId?: string;
  id?: string;
  createdAt?: string;
  promptOnStartup: boolean;
  refreshIdentity: boolean;
};

type RetainedBackupSafetyContext = {
  activeRoot: string;
  reservedRoots: readonly string[];
};

export class RetainedBackupError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly errorPath: string,
  ) {
    super(message);
    this.name = 'RetainedBackupError';
  }
}

export async function readRetainedDataRootBackups(
  appDataRoot: string,
): Promise<RetainedDataRootBackup[]> {
  const registryPath = dataRootBootstrapLayout(appDataRoot).retainedBackupsPath;
  const text = await readFile(registryPath, 'utf8').catch(() => null);
  if (text === null) return [];
  try {
    const value = JSON.parse(text) as unknown;
    return validRegistry(value)
      ? value.backups.map(normalizeBackup)
      : [];
  } catch {
    // Cleanup metadata must never prevent the application from opening. A later
    // migration or startup reconciliation can rebuild records from trusted roots.
    return [];
  }
}

export async function registerRetainedDataRootBackup(
  appDataRoot: string,
  input: RetainedBackupRegistration,
): Promise<RetainedDataRootBackup[]> {
  const captured = await captureBackup(input);
  const backups = await readRetainedDataRootBackups(appDataRoot);
  const existingIndex = backups.findIndex((backup) => samePath(backup.dataRoot, captured.dataRoot));
  if (existingIndex < 0) {
    backups.push(captured);
  } else if (input.refreshIdentity) {
    backups[existingIndex] = {
      ...captured,
      id: backups[existingIndex].id,
    };
  }
  await writeRetainedDataRootBackups(appDataRoot, backups);
  return backups;
}

export async function dismissRetainedDataRootBackups(
  appDataRoot: string,
  backupIds: readonly string[],
): Promise<RetainedDataRootBackup[]> {
  const selected = new Set(backupIds);
  const backups = (await readRetainedDataRootBackups(appDataRoot)).map((backup) => (
    selected.has(backup.id) ? { ...backup, promptOnStartup: false } : backup
  ));
  await writeRetainedDataRootBackups(appDataRoot, backups);
  return backups;
}

export async function inspectRetainedDataRootBackup(
  appDataRoot: string,
  backupId: string,
  context: RetainedBackupSafetyContext,
): Promise<DesktopDataRootRetainedBackupInspection> {
  const backup = (await readRetainedDataRootBackups(appDataRoot))
    .find((candidate) => candidate.id === backupId);
  if (!backup) {
    return inspectionFailure(
      backupId,
      '',
      'unavailable',
      'backup_not_found',
      'The retained data location is no longer registered.',
    );
  }
  try {
    assertSeparatedFromProtectedRoots(backup.dataRoot, context);
    await assertDistinctFromProtectedRoots(backup.dataRoot, context);
    await assertBackupIdentity(backup, backup.dataRoot);
    const totals = await scanDirectory(backup.dataRoot);
    await assertBackupIdentity(backup, backup.dataRoot);
    return {
      id: backup.id,
      path: backup.dataRoot,
      status: 'ready',
      ...totals,
    };
  } catch (error) {
    const issue = retainedBackupError(error, backup.dataRoot);
    return inspectionFailure(
      backup.id,
      backup.dataRoot,
      issue.code === 'backup_changed' ? 'changed' : 'unavailable',
      issue.code,
      issue.message,
    );
  }
}

export async function deleteRetainedDataRootBackup(
  appDataRoot: string,
  backupId: string,
  context: RetainedBackupSafetyContext,
): Promise<RetainedDataRootBackup[]> {
  let backups = await readRetainedDataRootBackups(appDataRoot);
  let backup = backups.find((candidate) => candidate.id === backupId);
  if (!backup) {
    throw new RetainedBackupError(
      'backup_not_found',
      'The retained data location is no longer registered.',
      '',
    );
  }

  assertSeparatedFromProtectedRoots(backup.dataRoot, context);
  await assertDistinctFromProtectedRoots(backup.dataRoot, context);
  const deletionRoot = backup.deletionRoot ?? deletionPath(backup);
  assertDeletionPath(backup.dataRoot, deletionRoot, context);

  if (!backup.deletionRequestedAt || !backup.deletionRoot) {
    await assertBackupIdentity(backup, backup.dataRoot);
    const deletionStats = await lstat(deletionRoot).catch(() => null);
    if (deletionStats) {
      throw new RetainedBackupError(
        'backup_cleanup_conflict',
        'The temporary cleanup location is already occupied.',
        deletionRoot,
      );
    }
    backup = {
      ...backup,
      deletionRequestedAt: new Date().toISOString(),
      deletionRoot,
    };
    backups = replaceBackup(backups, backup);
    await writeRetainedDataRootBackups(appDataRoot, backups);
  }

  await finishRequestedDeletion(backup, context);
  const remaining = (await readRetainedDataRootBackups(appDataRoot))
    .filter((candidate) => candidate.id !== backupId);
  await writeRetainedDataRootBackups(appDataRoot, remaining);
  return remaining;
}

export async function recoverRetainedDataRootDeletions(
  appDataRoot: string,
  context: RetainedBackupSafetyContext,
): Promise<RetainedDataRootBackup[]> {
  const backups = await readRetainedDataRootBackups(appDataRoot);
  for (const backup of backups) {
    if (!backup.deletionRequestedAt || !backup.deletionRoot) continue;
    try {
      await finishRequestedDeletion(backup, context);
      const current = await readRetainedDataRootBackups(appDataRoot);
      await writeRetainedDataRootBackups(
        appDataRoot,
        current.filter((candidate) => candidate.id !== backup.id),
      );
    } catch {
      // Keep the transaction record visible. The user can retry from Settings,
      // and an identity mismatch is never converted into an automatic deletion.
    }
  }
  return readRetainedDataRootBackups(appDataRoot);
}

export async function looksLikeSetsunaDataRoot(root: string): Promise<boolean> {
  const stats = await lstat(root).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) return false;
  const layout = desktopDataLayout(root);
  const runtimeStats = await lstat(layout.runtimeRoot).catch(() => null);
  if (!runtimeStats?.isDirectory() || runtimeStats.isSymbolicLink()) return false;
  const sentinels = [
    layout.runtimeConfigPath,
    layout.runtimeDatabasePath,
    layout.windowStatePath,
    layout.credentialVaultPath,
  ];
  const results = await Promise.all(sentinels.map(async (candidate) => {
    const candidateStats = await lstat(candidate).catch(() => null);
    return Boolean(candidateStats?.isFile() && !candidateStats.isSymbolicLink());
  }));
  return results.some(Boolean);
}

export function retainedBackupError(error: unknown, fallbackPath: string): RetainedBackupError {
  if (error instanceof RetainedBackupError) return error;
  return new RetainedBackupError(
    'backup_cleanup_failed',
    error instanceof Error ? error.message : String(error),
    fallbackPath,
  );
}

async function captureBackup(
  input: RetainedBackupRegistration,
): Promise<RetainedDataRootBackup> {
  const dataRoot = path.resolve(input.dataRoot);
  const stats = await backupStats(dataRoot);
  const marker = readDataRootMarkerSync(dataRoot);
  if (input.rootId && marker?.rootId !== input.rootId) {
    throw new RetainedBackupError(
      'backup_changed',
      'The old data location no longer has the expected ownership marker.',
      dataRoot,
    );
  }
  return {
    id: input.id ?? randomUUID(),
    dataRoot,
    ...(marker?.rootId || input.rootId ? { rootId: marker?.rootId ?? input.rootId } : {}),
    deviceId: stats.dev.toString(),
    inode: stats.ino.toString(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    promptOnStartup: input.promptOnStartup,
  };
}

async function finishRequestedDeletion(
  backup: RetainedDataRootBackup,
  context: RetainedBackupSafetyContext,
): Promise<void> {
  const deletionRoot = backup.deletionRoot;
  if (!deletionRoot) {
    throw new RetainedBackupError(
      'backup_cleanup_invalid',
      'The retained data cleanup transaction is incomplete.',
      backup.dataRoot,
    );
  }
  assertSeparatedFromProtectedRoots(backup.dataRoot, context);
  assertDeletionPath(backup.dataRoot, deletionRoot, context);
  const [sourceStats, deletionStats] = await Promise.all([
    lstat(backup.dataRoot).catch(() => null),
    lstat(deletionRoot).catch(() => null),
  ]);
  if (sourceStats && deletionStats) {
    throw new RetainedBackupError(
      'backup_cleanup_conflict',
      'Both the old and temporary cleanup locations exist. Nothing was deleted.',
      backup.dataRoot,
    );
  }
  if (sourceStats) {
    await assertDistinctFromProtectedRoots(backup.dataRoot, context);
    await assertBackupIdentity(backup, backup.dataRoot);
    await rename(backup.dataRoot, deletionRoot);
  } else if (!deletionStats) {
    return;
  }
  await assertDistinctFromProtectedRoots(deletionRoot, context);
  await assertBackupIdentity(backup, deletionRoot);
  await rm(deletionRoot, {
    recursive: true,
    force: false,
    maxRetries: 3,
    retryDelay: 100,
  });
}

async function assertBackupIdentity(
  backup: RetainedDataRootBackup,
  location: string,
): Promise<void> {
  const stats = await backupStats(location);
  if (
    stats.dev.toString() !== backup.deviceId
    || stats.ino.toString() !== backup.inode
  ) {
    throw new RetainedBackupError(
      'backup_changed',
      'The old data folder was replaced or moved after migration. Nothing was deleted.',
      location,
    );
  }
  if (backup.rootId && readDataRootMarkerSync(location)?.rootId !== backup.rootId) {
    throw new RetainedBackupError(
      'backup_changed',
      'The old data folder ownership marker changed after migration. Nothing was deleted.',
      location,
    );
  }
}

async function backupStats(location: string) {
  const stats = await lstat(location, { bigint: true }).catch((error: unknown) => {
    throw new RetainedBackupError(
      'backup_unavailable',
      error instanceof Error ? error.message : String(error),
      location,
    );
  });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new RetainedBackupError(
      'backup_changed',
      'The retained data location is no longer a regular folder.',
      location,
    );
  }
  return stats;
}

function assertSeparatedFromProtectedRoots(
  candidate: string,
  context: RetainedBackupSafetyContext,
): void {
  const resolved = path.resolve(candidate);
  if (resolved === path.parse(resolved).root) {
    throw new RetainedBackupError(
      'backup_cleanup_unsafe_path',
      'A filesystem root can never be removed as retained Setsuna data.',
      resolved,
    );
  }
  for (const protectedRoot of [context.activeRoot, ...context.reservedRoots]) {
    if (pathsOverlap(resolved, protectedRoot)) {
      throw new RetainedBackupError(
        'backup_cleanup_unsafe_path',
        'The old data location overlaps the active or bootstrap data location.',
        resolved,
      );
    }
  }
}

async function assertDistinctFromProtectedRoots(
  candidate: string,
  context: RetainedBackupSafetyContext,
): Promise<void> {
  const candidateStats = await backupStats(candidate);
  const resolvedCandidate = await realpath(candidate);
  for (const protectedRoot of [context.activeRoot, ...context.reservedRoots]) {
    const [protectedStats, resolvedProtected] = await Promise.all([
      lstat(protectedRoot, { bigint: true }).catch(() => null),
      realpath(protectedRoot).catch(() => null),
    ]);
    if (
      (
        protectedStats
        && protectedStats.dev === candidateStats.dev
        && protectedStats.ino === candidateStats.ino
      )
      || (resolvedProtected && pathsOverlap(resolvedCandidate, resolvedProtected))
    ) {
      throw new RetainedBackupError(
        'backup_cleanup_unsafe_path',
        'The old data location resolves to the active or bootstrap data directory.',
        candidate,
      );
    }
  }
}

function assertDeletionPath(
  dataRoot: string,
  deletionRoot: string,
  context: RetainedBackupSafetyContext,
): void {
  const resolvedDataRoot = path.resolve(dataRoot);
  const resolvedDeletionRoot = path.resolve(deletionRoot);
  const prefix = `.${path.basename(resolvedDataRoot)}.setsuna-delete-`;
  if (
    path.dirname(resolvedDeletionRoot) !== path.dirname(resolvedDataRoot)
    || !path.basename(resolvedDeletionRoot).startsWith(prefix)
  ) {
    throw new RetainedBackupError(
      'backup_cleanup_invalid',
      'The temporary cleanup location is invalid.',
      resolvedDeletionRoot,
    );
  }
  assertSeparatedFromProtectedRoots(resolvedDeletionRoot, context);
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrChild(left, right) || isSameOrChild(right, left);
}

function isSameOrChild(candidate: string, parent: string): boolean {
  if (samePath(candidate, parent)) return true;
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === 'linux' ? resolved : resolved.toLocaleLowerCase('en-US');
  };
  const relative = path.relative(normalize(parent), normalize(candidate));
  return Boolean(relative)
    && !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative);
}

async function scanDirectory(root: string): Promise<{ fileCount: number; totalBytes: number }> {
  let fileCount = 0;
  let totalBytes = 0;
  const directory = await opendir(root);
  for await (const entry of directory) {
    const absolutePath = path.join(root, entry.name);
    const stats = await lstat(absolutePath);
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      const child = await scanDirectory(absolutePath);
      fileCount += child.fileCount;
      totalBytes += child.totalBytes;
    } else {
      fileCount += 1;
      totalBytes += stats.size;
    }
  }
  return { fileCount, totalBytes };
}

function deletionPath(backup: RetainedDataRootBackup): string {
  const dataRoot = path.resolve(backup.dataRoot);
  return path.join(
    path.dirname(dataRoot),
    `.${path.basename(dataRoot)}.setsuna-delete-${randomUUID()}`,
  );
}

function replaceBackup(
  backups: readonly RetainedDataRootBackup[],
  replacement: RetainedDataRootBackup,
): RetainedDataRootBackup[] {
  return backups.map((backup) => backup.id === replacement.id ? replacement : backup);
}

async function writeRetainedDataRootBackups(
  appDataRoot: string,
  backups: readonly RetainedDataRootBackup[],
): Promise<void> {
  const registry: RetainedDataRootBackupRegistry = {
    version: 1,
    backups: [...backups],
  };
  await writeJsonAtomically(
    dataRootBootstrapLayout(appDataRoot).retainedBackupsPath,
    registry,
  );
}

function inspectionFailure(
  id: string,
  backupPath: string,
  status: 'unavailable' | 'changed',
  code: string,
  message: string,
): DesktopDataRootRetainedBackupInspection {
  return {
    id,
    path: backupPath,
    status,
    fileCount: 0,
    totalBytes: 0,
    error: {
      code,
      message,
      ...(backupPath ? { path: backupPath } : {}),
    },
  };
}

function validRegistry(value: unknown): value is RetainedDataRootBackupRegistry {
  if (!value || typeof value !== 'object') return false;
  const registry = value as Partial<RetainedDataRootBackupRegistry>;
  return registry.version === 1
    && Array.isArray(registry.backups)
    && registry.backups.every(validBackup);
}

function validBackup(value: unknown): value is RetainedDataRootBackup {
  if (!value || typeof value !== 'object') return false;
  const backup = value as Partial<RetainedDataRootBackup>;
  return typeof backup.id === 'string'
    && Boolean(backup.id)
    && typeof backup.dataRoot === 'string'
    && Boolean(backup.dataRoot.trim())
    && (backup.rootId === undefined || typeof backup.rootId === 'string')
    && typeof backup.deviceId === 'string'
    && Boolean(backup.deviceId)
    && typeof backup.inode === 'string'
    && Boolean(backup.inode)
    && typeof backup.createdAt === 'string'
    && typeof backup.promptOnStartup === 'boolean'
    && (
      backup.deletionRequestedAt === undefined
      || typeof backup.deletionRequestedAt === 'string'
    )
    && (backup.deletionRoot === undefined || typeof backup.deletionRoot === 'string');
}

function normalizeBackup(backup: RetainedDataRootBackup): RetainedDataRootBackup {
  return {
    ...backup,
    dataRoot: path.resolve(backup.dataRoot),
    ...(backup.deletionRoot ? { deletionRoot: path.resolve(backup.deletionRoot) } : {}),
  };
}
