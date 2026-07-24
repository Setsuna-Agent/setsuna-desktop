import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DATA_ROOT_MARKER_FILE_NAME,
  dataRootBootstrapLayout,
  desktopDataLayout,
  legacyDesktopPolicyPaths,
} from './layout.js';
import type {
  DataRootMarker,
  DataRootPointer,
  DesktopDataRootBootMode,
  PendingDataMigration,
} from './model.js';
import { removeFileDurably, writeJsonAtomically } from './atomic-json.js';

export function resolveDesktopDataRootBootMode(input: {
  appDataRoot: string;
  defaultRoot: string;
  legacyPolicyPaths?: readonly string[];
  writabilityProbe?: (root: string) => Error | undefined;
}): DesktopDataRootBootMode {
  const defaultRoot = path.resolve(input.defaultRoot);
  const bootstrap = dataRootBootstrapLayout(input.appDataRoot);
  const pointerExists = existsSync(bootstrap.pointerPath);
  const pendingExists = existsSync(bootstrap.pendingMigrationPath);
  const pointer = readJsonSync<DataRootPointer>(bootstrap.pointerPath);
  const pending = readJsonSync<PendingDataMigration>(bootstrap.pendingMigrationPath);

  if (pendingExists && !validPendingMigration(pending)) {
    return {
      mode: 'recovery',
      defaultRoot,
      pointer: validPointer(pointer)
        ? normalizePointer(pointer)
        : pointerExists
          ? invalidPointer()
          : defaultPointer(defaultRoot),
      reason: 'configured_root_invalid',
      error: `Pending data migration metadata is invalid: ${bootstrap.pendingMigrationPath}`,
      bootstrapIssue: 'pending_migration',
    };
  }

  if (validPendingMigration(pending)) {
    const normalizedPending = normalizedPendingMigration(pending);
    if (normalizedPending.kind === 'legacy_import') {
      return {
        mode: 'migrating',
        activeRoot: normalizedPending.sourceRoot,
        defaultRoot,
        ...(validPointer(pointer) ? { pointer: normalizePointer(pointer) } : {}),
        pending: normalizedPending,
      };
    }
    const pointerCommitted = Boolean(normalizedPending.targetRootId)
      && validPointer(pointer)
      && samePath(pointer.dataRoot, pending.targetRoot)
      && pointer.rootId === normalizedPending.targetRootId;
    if (!pointerCommitted) {
      return {
        mode: 'migrating',
        activeRoot: normalizedPending.sourceRoot,
        defaultRoot,
        ...(validPointer(pointer) ? { pointer: normalizePointer(pointer) } : {}),
        pending: normalizedPending,
      };
    }
    const committedMode = resolveConfiguredRoot(
      defaultRoot,
      pointerExists,
      pointer,
      bootstrap.pointerPath,
      input.writabilityProbe ?? probeDataRootWritableSync,
    );
    if (committedMode.mode === 'recovery') {
      return { ...committedMode, bootstrapIssue: 'committed_pending' };
    }
    return { ...committedMode, completedPending: normalizedPending };
  }

  const configuredMode = resolveConfiguredRoot(
    defaultRoot,
    pointerExists,
    pointer,
    bootstrap.pointerPath,
    input.writabilityProbe ?? probeDataRootWritableSync,
  );
  if (configuredMode.mode === 'recovery') return configuredMode;
  return legacyImportBootMode(configuredMode, input.legacyPolicyPaths);
}

function resolveConfiguredRoot(
  defaultRoot: string,
  pointerExists: boolean,
  pointer: DataRootPointer | undefined,
  pointerPath: string,
  writabilityProbe: (root: string) => Error | undefined,
): Extract<DesktopDataRootBootMode, { mode: 'normal' | 'recovery' }> {
  if (!pointerExists) return { mode: 'normal', activeRoot: defaultRoot, defaultRoot };
  if (!validPointer(pointer)) {
    return {
      mode: 'recovery',
      defaultRoot,
      pointer: invalidPointer(),
      reason: 'configured_root_invalid',
      error: `Data location pointer is invalid: ${pointerPath}`,
    };
  }

  const normalizedPointer = normalizePointer(pointer);
  if (samePath(normalizedPointer.dataRoot, defaultRoot)) {
    const defaultStats = safeLstat(defaultRoot);
    if (!defaultStats) {
      return {
        mode: 'recovery',
        defaultRoot,
        pointer: normalizedPointer,
        reason: 'configured_root_unavailable',
        error: `Configured data location is unavailable: ${defaultRoot}`,
      };
    }
    if (!defaultStats.isDirectory() || defaultStats.isSymbolicLink()) {
      return {
        mode: 'recovery',
        defaultRoot,
        pointer: normalizedPointer,
        reason: 'configured_root_invalid',
        error: `Configured data location is not a valid Setsuna data root: ${defaultRoot}`,
      };
    }
    const writeError = writabilityProbe(defaultRoot);
    if (writeError) {
      return unavailableRoot(defaultRoot, defaultRoot, normalizedPointer, writeError);
    }
    return {
      mode: 'normal',
      activeRoot: defaultRoot,
      defaultRoot,
      pointer: normalizedPointer,
    };
  }

  const rootStats = safeLstat(normalizedPointer.dataRoot);
  if (!rootStats) {
    return {
      mode: 'recovery',
      defaultRoot,
      pointer: normalizedPointer,
      reason: 'configured_root_unavailable',
      error: `Configured data location is unavailable: ${normalizedPointer.dataRoot}`,
    };
  }
  const marker = readDataRootMarkerSync(normalizedPointer.dataRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || marker?.rootId !== normalizedPointer.rootId) {
    return {
      mode: 'recovery',
      defaultRoot,
      pointer: normalizedPointer,
      reason: 'configured_root_invalid',
      error: `Configured data location is not a valid Setsuna data root: ${normalizedPointer.dataRoot}`,
    };
  }
  const writeError = writabilityProbe(normalizedPointer.dataRoot);
  if (writeError) {
    return unavailableRoot(
      normalizedPointer.dataRoot,
      defaultRoot,
      normalizedPointer,
      writeError,
    );
  }
  return {
    mode: 'normal',
    activeRoot: normalizedPointer.dataRoot,
    defaultRoot,
    pointer: normalizedPointer,
  };
}

function unavailableRoot(
  root: string,
  defaultRoot: string,
  pointer: DataRootPointer,
  error: Error,
): Extract<DesktopDataRootBootMode, { mode: 'recovery' }> {
  return {
    mode: 'recovery',
    defaultRoot,
    pointer,
    reason: 'configured_root_unavailable',
    error: `Configured data location is not writable: ${root}. ${error.message}`,
  };
}

/**
 * Electron and SQLite both need create/write/delete access below userData. A marker
 * alone cannot prove that a removable or network mount is usable by this OS user.
 */
export function probeDataRootWritableSync(root: string): Error | undefined {
  const probePath = path.join(
    path.resolve(root),
    `.setsuna-write-probe-${process.pid}-${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(probePath, 'wx', 0o600);
    created = true;
    writeFileSync(descriptor, 'setsuna-write-probe\n', 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    unlinkSync(probePath);
    created = false;
    return undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Best-effort cleanup; the original probe error is more useful to recovery UI.
      }
    }
    if (created) {
      try {
        unlinkSync(probePath);
      } catch {
        // A failed delete is itself enough to reject this root.
      }
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function legacyImportBootMode(
  mode: Extract<DesktopDataRootBootMode, { mode: 'normal' }>,
  configuredPolicyPaths?: readonly string[],
): DesktopDataRootBootMode {
  const layout = desktopDataLayout(mode.activeRoot);
  const config = readJsonSync<Record<string, unknown>>(layout.runtimeConfigPath);
  const storagePath = typeof config?.storagePath === 'string' ? config.storagePath.trim() : '';
  const receipt = readJsonSync<Record<string, unknown>>(layout.legacyDataImportReceiptPath);
  const defaultPolicyPaths = legacyDesktopPolicyPaths(os.homedir());
  const pendingPolicyPaths = receipt?.policyImportComplete === true
    ? []
    : [...(configuredPolicyPaths ?? [
        defaultPolicyPaths.execPolicyPath,
        defaultPolicyPaths.shellPolicyPath,
      ])]
      .map((candidate) => path.resolve(candidate))
      .filter((candidate) => existsSync(candidate));
  if (!storagePath && !pendingPolicyPaths.length) return mode;

  return {
    mode: 'migrating',
    activeRoot: mode.activeRoot,
    defaultRoot: mode.defaultRoot,
    ...(mode.pointer ? { pointer: mode.pointer } : {}),
    pending: newPendingLegacyDataImport(mode.activeRoot, {
      ...(storagePath ? { memoryStoragePath: storagePath } : {}),
      policyPaths: pendingPolicyPaths,
    }),
  };
}

export function maintenanceProfileRoot(mode: DesktopDataRootBootMode): string | null {
  if (mode.mode === 'normal') return null;
  const suffix = mode.mode === 'migrating'
    ? mode.pending.migrationId
    : stablePathToken(mode.pointer.dataRoot || mode.defaultRoot);
  return path.join(os.tmpdir(), 'setsuna-desktop-maintenance', suffix);
}

export async function writeDataRootPointer(
  appDataRoot: string,
  pointer: DataRootPointer,
): Promise<void> {
  const { pointerPath } = dataRootBootstrapLayout(appDataRoot);
  await writeJsonAtomically(pointerPath, pointer);
}

export async function writePendingDataMigration(
  appDataRoot: string,
  pending: PendingDataMigration,
): Promise<void> {
  const { pendingMigrationPath } = dataRootBootstrapLayout(appDataRoot);
  await writeJsonAtomically(pendingMigrationPath, pending);
}

export async function removePendingDataMigration(appDataRoot: string): Promise<void> {
  await removeFileDurably(dataRootBootstrapLayout(appDataRoot).pendingMigrationPath);
}

export async function writeDataRootMarker(root: string, marker: DataRootMarker): Promise<void> {
  await writeJsonAtomically(path.join(path.resolve(root), DATA_ROOT_MARKER_FILE_NAME), marker);
}

export function readDataRootMarkerSync(root: string): DataRootMarker | undefined {
  const marker = readJsonSync<DataRootMarker>(
    path.join(path.resolve(root), DATA_ROOT_MARKER_FILE_NAME),
  );
  return validDataRootMarker(marker) ? marker : undefined;
}

export function newPendingDataMigration(
  sourceRoot: string,
  targetRoot: string,
  options: {
    sourceRootId?: string;
    targetDeviceId?: string;
  } = {},
): PendingDataMigration {
  return {
    version: 1,
    migrationId: randomUUID(),
    sourceRoot: path.resolve(sourceRoot),
    targetRoot: path.resolve(targetRoot),
    ...(options.sourceRootId ? { sourceRootId: options.sourceRootId } : {}),
    ...(options.targetDeviceId ? { targetDeviceId: options.targetDeviceId } : {}),
    createdAt: new Date().toISOString(),
  };
}

export function newPendingLegacyDataImport(
  activeRoot: string,
  options: {
    memoryStoragePath?: string;
    policyPaths?: readonly string[];
  },
): PendingDataMigration {
  const root = path.resolve(activeRoot);
  return {
    version: 1,
    kind: 'legacy_import',
    migrationId: randomUUID(),
    sourceRoot: root,
    targetRoot: root,
    ...(options.memoryStoragePath?.trim()
      ? { legacyMemoryStoragePath: options.memoryStoragePath.trim() }
      : {}),
    ...(options.policyPaths?.length
      ? { legacyPolicyPaths: options.policyPaths.map((candidate) => path.resolve(candidate)) }
      : {}),
    legacyTransactionStage: 'scheduled',
    createdAt: new Date().toISOString(),
  };
}

export function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === 'linux' ? resolved : resolved.toLocaleLowerCase('en-US');
  };
  return normalize(left) === normalize(right);
}

function readJsonSync<T>(filePath: string): T | undefined {
  const stats = safeLstat(filePath);
  if (!stats?.isFile() || stats.isSymbolicLink()) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function safeLstat(target: string): Stats | undefined {
  try {
    return lstatSync(target);
  } catch {
    return undefined;
  }
}

function validDataRootMarker(value: unknown): value is DataRootMarker {
  if (!value || typeof value !== 'object') return false;
  const marker = value as Partial<DataRootMarker>;
  return marker.owner === 'setsuna-desktop'
    && marker.version === 1
    && typeof marker.rootId === 'string'
    && Boolean(marker.rootId)
    && typeof marker.createdAt === 'string';
}

function validPointer(value: unknown): value is DataRootPointer {
  if (!value || typeof value !== 'object') return false;
  const pointer = value as Partial<DataRootPointer>;
  return pointer.version === 1
    && typeof pointer.dataRoot === 'string'
    && Boolean(pointer.dataRoot.trim())
    && typeof pointer.rootId === 'string'
    && (pointer.previousDataRoot === undefined || typeof pointer.previousDataRoot === 'string')
    && (pointer.previousRootId === undefined || typeof pointer.previousRootId === 'string')
    && typeof pointer.updatedAt === 'string';
}

function normalizePointer(pointer: DataRootPointer): DataRootPointer {
  return {
    ...pointer,
    dataRoot: path.resolve(pointer.dataRoot),
    ...(pointer.previousDataRoot
      ? { previousDataRoot: path.resolve(pointer.previousDataRoot) }
      : {}),
  };
}

function validPendingMigration(value: unknown): value is PendingDataMigration {
  if (!value || typeof value !== 'object') return false;
  const pending = value as Partial<PendingDataMigration>;
  return pending.version === 1
    && (
      pending.kind === undefined
      || pending.kind === 'data_root'
      || pending.kind === 'legacy_import'
    )
    && typeof pending.migrationId === 'string'
    && Boolean(pending.migrationId)
    && typeof pending.sourceRoot === 'string'
    && Boolean(pending.sourceRoot.trim())
    && typeof pending.targetRoot === 'string'
    && Boolean(pending.targetRoot.trim())
    && (pending.sourceRootId === undefined || typeof pending.sourceRootId === 'string')
    && (pending.targetRootId === undefined || typeof pending.targetRootId === 'string')
    && (pending.targetDeviceId === undefined || typeof pending.targetDeviceId === 'string')
    && (
      pending.legacyMemoryStoragePath === undefined
      || typeof pending.legacyMemoryStoragePath === 'string'
    )
    && (
      pending.legacyPolicyPaths === undefined
      || (
        Array.isArray(pending.legacyPolicyPaths)
        && pending.legacyPolicyPaths.every((candidate) => typeof candidate === 'string')
      )
    )
    && (
      pending.legacyTransactionStage === undefined
      || pending.legacyTransactionStage === 'scheduled'
      || pending.legacyTransactionStage === 'prepared'
      || pending.legacyTransactionStage === 'backup_created'
      || pending.legacyTransactionStage === 'memory_committed'
    )
    && typeof pending.createdAt === 'string';
}

function normalizedPendingMigration(pending: PendingDataMigration): PendingDataMigration {
  return {
    ...pending,
    sourceRoot: path.resolve(pending.sourceRoot),
    targetRoot: path.resolve(pending.targetRoot),
    ...(pending.legacyPolicyPaths
      ? { legacyPolicyPaths: pending.legacyPolicyPaths.map((candidate) => path.resolve(candidate)) }
      : {}),
  };
}

function invalidPointer(): DataRootPointer {
  return {
    version: 1,
    dataRoot: '',
    rootId: '',
    updatedAt: new Date(0).toISOString(),
  };
}

function defaultPointer(defaultRoot: string): DataRootPointer {
  return {
    version: 1,
    dataRoot: path.resolve(defaultRoot),
    rootId: '',
    updatedAt: new Date(0).toISOString(),
  };
}

function stablePathToken(value: string): string {
  let token = 2166136261;
  for (const character of value) {
    token ^= character.codePointAt(0) ?? 0;
    token = Math.imul(token, 16777619);
  }
  return `recovery-${(token >>> 0).toString(16)}`;
}
