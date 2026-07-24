import {
  type DesktopDataMigrationCategoryId,
  type DesktopDataMigrationCategorySummary,
  type DesktopDataMigrationIssue,
  type DesktopDataMigrationPhase,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  samePath,
  writePendingDataMigration,
} from './bootstrap.js';
import {
  DATA_MIGRATION_OWNER_FILE_NAME,
  LEGACY_MEMORY_IMPORT_RECEIPT_FILE_NAME,
  desktopDataLayout,
} from './layout.js';
import type { PendingDataMigration } from './model.js';
import {
  isAtomicJsonTemporaryFileName,
  writeJsonAtomically,
} from './atomic-json.js';

const MEMORY_INDEX_FILE_NAME = 'memories.json';
const MEMORY_ROOT_MARKER_FILE_NAME = '.setsuna-memory-root.json';

export { buildLegacyDataImportPlan } from './legacy-import-plan.js';

export type LegacyImportEntry = {
  sourcePath: string;
  relativePath: string;
  targetRelativePath: string;
  size: number;
  mode: number;
  mtimeMs: number;
  category: DesktopDataMigrationCategoryId;
  origin: 'active_memory' | 'legacy_memory' | 'legacy_policy';
};

export type LegacyImportDirectory = {
  relativePath: string;
  mode: number;
  mtimeMs: number;
};

export type LegacyMemorySource = {
  root: string;
  managed: boolean;
};

export type LegacyDataImportPlan = {
  activeRoot: string;
  activeMemoryRoot: string;
  memoryStagingRoot: string;
  memoryBackupRoot: string;
  policyStagingRoot: string;
  activeMemoryEntries: LegacyImportEntry[];
  activeMemoryDirectories: LegacyImportDirectory[];
  legacyMemoryEntries: LegacyImportEntry[];
  legacyMemoryDirectories: LegacyImportDirectory[];
  legacyMemorySource?: LegacyMemorySource;
  policyEntries: LegacyImportEntry[];
  totalFiles: number;
  totalBytes: number;
  requiredBytes: number;
  availableBytes: number;
  categories: DesktopDataMigrationCategorySummary[];
  blockers: DesktopDataMigrationIssue[];
  warnings: DesktopDataMigrationIssue[];
  memoryAlreadyCommitted: boolean;
};

type LegacyImportCallbacks = {
  onPhase: (phase: DesktopDataMigrationPhase) => void;
  onCopyProgress: (
    category: DesktopDataMigrationCategoryId,
    relativePath: string,
    bytes: number,
    completed: boolean,
  ) => void;
  onPendingChange: (pending: PendingDataMigration) => void;
};

export async function recoverLegacyDataImportTransaction(
  pending: PendingDataMigration,
  appDataRoot: string,
): Promise<PendingDataMigration> {
  if (pending.kind !== 'legacy_import') return pending;
  const paths = legacyTransactionPaths(pending);
  const activeReceipt = await readJsonRecord(
    path.join(paths.activeMemoryRoot, LEGACY_MEMORY_IMPORT_RECEIPT_FILE_NAME),
  );
  if (activeReceipt?.migrationId === pending.migrationId) {
    await rm(path.join(paths.activeMemoryRoot, DATA_MIGRATION_OWNER_FILE_NAME), { force: true });
    return updatePendingStage(pending, 'memory_committed', appDataRoot);
  }

  const [activeKind, stagingKind, backupKind] = await Promise.all([
    pathKind(paths.activeMemoryRoot),
    pathKind(paths.memoryStagingRoot),
    pathKind(paths.memoryBackupRoot),
  ]);
  if (stagingKind === 'symlink' || stagingKind === 'other') {
    throw new Error(`Legacy memory staging is invalid: ${paths.memoryStagingRoot}`);
  }
  if (backupKind === 'symlink' || backupKind === 'other') {
    throw new Error(`Legacy memory backup is invalid: ${paths.memoryBackupRoot}`);
  }

  if (activeKind === 'missing' && stagingKind === 'directory') {
    await assertMigrationOwner(paths.memoryStagingRoot, pending.migrationId);
    await rename(paths.memoryStagingRoot, paths.activeMemoryRoot);
    await rm(path.join(paths.activeMemoryRoot, DATA_MIGRATION_OWNER_FILE_NAME), { force: true });
    return updatePendingStage(pending, 'memory_committed', appDataRoot);
  }
  if (activeKind === 'missing' && backupKind === 'directory') {
    await rename(paths.memoryBackupRoot, paths.activeMemoryRoot);
    return updatePendingStage(pending, 'scheduled', appDataRoot);
  }
  if (activeKind === 'symlink' || activeKind === 'other') {
    throw new Error(`Unified memory root is invalid: ${paths.activeMemoryRoot}`);
  }
  if (pending.legacyTransactionStage === 'memory_committed') {
    throw new Error('Legacy memory transaction is marked committed but its receipt is missing.');
  }
  return pending;
}

export async function executeLegacyDataImport(
  plan: LegacyDataImportPlan,
  initialPending: PendingDataMigration,
  appDataRoot: string,
  callbacks: LegacyImportCallbacks,
): Promise<PendingDataMigration> {
  let pending = initialPending;
  await writePendingDataMigration(appDataRoot, pending);
  callbacks.onPendingChange(pending);

  const needsMemoryCommit = Boolean(
    pending.legacyMemoryStoragePath
    && plan.legacyMemorySource
    && !samePath(plan.legacyMemorySource.root, plan.activeMemoryRoot)
    && !plan.memoryAlreadyCommitted,
  );

  callbacks.onPhase('copying');
  let preparedMemory = false;
  if (needsMemoryCommit) {
    await cleanupOwnedDirectory(plan.memoryStagingRoot, pending.migrationId);
    await mkdir(plan.memoryStagingRoot, { recursive: false });
    await writeMigrationOwner(plan.memoryStagingRoot, pending.migrationId);
    await createDirectories(plan.memoryStagingRoot, plan.activeMemoryDirectories);
    const activeHashes = await copyEntries(
      plan.activeMemoryEntries,
      plan.memoryStagingRoot,
      callbacks,
      { overwrite: true },
    );

    await createDirectories(plan.memoryStagingRoot, plan.legacyMemoryDirectories);
    const legacyIndexEntry = plan.legacyMemoryEntries.find(
      (entry) => entry.targetRelativePath === MEMORY_INDEX_FILE_NAME,
    );
    const overlayEntries = plan.legacyMemoryEntries.filter(
      (entry) => entry.targetRelativePath !== MEMORY_INDEX_FILE_NAME,
    );
    const legacyHashes = await copyEntries(
      overlayEntries,
      plan.memoryStagingRoot,
      callbacks,
      { overwrite: true },
    );
    let legacyIndexHash: string | undefined;
    if (legacyIndexEntry) {
      legacyIndexHash = await hashFileWithProgress(legacyIndexEntry, callbacks);
    }

    callbacks.onPhase('merging_memory');
    const [preferredIndex, fallbackIndex] = await Promise.all([
      readMemoryIndex(plan.legacyMemorySource!.root),
      readMemoryIndex(plan.activeMemoryRoot),
    ]);
    await writeJsonAtomically(
      path.join(plan.memoryStagingRoot, MEMORY_INDEX_FILE_NAME),
      mergeMemoryIndexes(preferredIndex, fallbackIndex),
    );
    await writeJsonAtomically(
      path.join(plan.memoryStagingRoot, MEMORY_ROOT_MARKER_FILE_NAME),
      {
        owner: 'setsuna-desktop',
        version: 1,
        legacyImportComplete: true,
      },
    );
    await writeJsonAtomically(
      path.join(plan.memoryStagingRoot, LEGACY_MEMORY_IMPORT_RECEIPT_FILE_NAME),
      {
        version: 1,
        migrationId: pending.migrationId,
        sourcePathHash: hashText(path.resolve(plan.legacyMemorySource!.root)),
        importedAt: new Date().toISOString(),
      },
    );
    await applyDirectoryMetadata(plan.memoryStagingRoot, [
      ...plan.activeMemoryDirectories,
      ...plan.legacyMemoryDirectories,
    ]);

    callbacks.onPhase('validating');
    await validateSourcesStable(plan.activeMemoryEntries, activeHashes);
    await validateSourcesStable(overlayEntries, legacyHashes);
    if (legacyIndexEntry && legacyIndexHash) {
      await validateSourceStable(legacyIndexEntry, legacyIndexHash);
    }
    await validateMemoryTargets(
      plan.memoryStagingRoot,
      plan.activeMemoryEntries,
      activeHashes,
      overlayEntries,
      legacyHashes,
    );
    await readMemoryIndex(plan.memoryStagingRoot);
    preparedMemory = true;
  }

  let policyHashes = new Map<string, string>();
  if (plan.policyEntries.length) {
    callbacks.onPhase('copying');
    await cleanupOwnedDirectory(plan.policyStagingRoot, pending.migrationId);
    await mkdir(plan.policyStagingRoot, { recursive: false });
    await writeMigrationOwner(plan.policyStagingRoot, pending.migrationId);
    policyHashes = await copyEntries(plan.policyEntries, plan.policyStagingRoot, callbacks, {
      overwrite: false,
    });
    callbacks.onPhase('validating');
    await validateSourcesStable(plan.policyEntries, policyHashes);
    await validateDirectTargets(plan.policyStagingRoot, plan.policyEntries, policyHashes);
  }

  pending = await updatePendingStage(pending, preparedMemory ? 'prepared' : 'memory_committed', appDataRoot);
  callbacks.onPendingChange(pending);
  callbacks.onPhase('committing');

  if (preparedMemory) {
    const activeKind = await pathKind(plan.activeMemoryRoot);
    if (activeKind === 'symlink' || activeKind === 'other') {
      throw new Error(`Unified memory root is invalid: ${plan.activeMemoryRoot}`);
    }
    if (activeKind === 'directory') {
      if (await pathKind(plan.memoryBackupRoot) !== 'missing') {
        throw new Error(`Legacy memory backup already exists: ${plan.memoryBackupRoot}`);
      }
      await rename(plan.activeMemoryRoot, plan.memoryBackupRoot);
    }
    pending = await updatePendingStage(pending, 'backup_created', appDataRoot);
    callbacks.onPendingChange(pending);
    try {
      await rename(plan.memoryStagingRoot, plan.activeMemoryRoot);
      await rm(path.join(plan.activeMemoryRoot, DATA_MIGRATION_OWNER_FILE_NAME), { force: true });
    } catch (error) {
      if (
        await pathKind(plan.activeMemoryRoot) === 'missing'
        && await pathKind(plan.memoryBackupRoot) === 'directory'
      ) {
        await rename(plan.memoryBackupRoot, plan.activeMemoryRoot).catch(() => undefined);
        pending = await updatePendingStage(pending, 'scheduled', appDataRoot);
        callbacks.onPendingChange(pending);
      }
      throw error;
    }
  }

  pending = await updatePendingStage(pending, 'memory_committed', appDataRoot);
  callbacks.onPendingChange(pending);
  await commitPolicyImports(plan, policyHashes);
  await clearLegacyStoragePath(plan.activeRoot);
  if (plan.policyEntries.length) {
    await writeJsonAtomically(desktopDataLayout(plan.activeRoot).legacyDataImportReceiptPath, {
      version: 1,
      policyImportComplete: true,
      sources: plan.policyEntries.map((entry) => entry.sourcePath),
      importedAt: new Date().toISOString(),
    });
  }
  return pending;
}

function legacyTransactionPaths(pending: PendingDataMigration) {
  const activeRoot = path.resolve(pending.sourceRoot);
  const layout = desktopDataLayout(activeRoot);
  return {
    activeRoot,
    activeMemoryRoot: layout.memoriesRoot,
    memoryStagingRoot: path.join(layout.runtimeRoot, `.memories-unification-${pending.migrationId}`),
    memoryBackupRoot: path.join(layout.runtimeRoot, `.memories-before-unification-${pending.migrationId}`),
    policyStagingRoot: path.join(layout.runtimeRoot, `.legacy-policy-import-${pending.migrationId}`),
  };
}

async function copyEntries(
  entries: LegacyImportEntry[],
  targetRoot: string,
  callbacks: LegacyImportCallbacks,
  options: { overwrite: boolean },
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const entry of entries) {
    const target = path.join(targetRoot, entry.targetRelativePath);
    await mkdir(path.dirname(target), { recursive: true });
    callbacks.onCopyProgress(entry.category, entry.relativePath, 0, false);
    const hash = await copyFileWithProgress(entry.sourcePath, target, entry.mode, options.overwrite, (bytes) => {
      callbacks.onCopyProgress(entry.category, entry.relativePath, bytes, false);
    });
    const modified = new Date(entry.mtimeMs);
    await chmod(target, entry.mode).catch(() => undefined);
    await utimes(target, modified, modified).catch(() => undefined);
    callbacks.onCopyProgress(entry.category, entry.relativePath, 0, true);
    hashes.set(entryKey(entry), hash);
  }
  return hashes;
}

async function hashFileWithProgress(
  entry: LegacyImportEntry,
  callbacks: LegacyImportCallbacks,
): Promise<string> {
  callbacks.onCopyProgress(entry.category, entry.relativePath, 0, false);
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(entry.sourcePath);
    stream.on('data', (chunk) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      hash.update(bytes);
      callbacks.onCopyProgress(entry.category, entry.relativePath, bytes.byteLength, false);
    });
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  callbacks.onCopyProgress(entry.category, entry.relativePath, 0, true);
  return hash.digest('hex');
}

async function copyFileWithProgress(
  source: string,
  target: string,
  mode: number,
  overwrite: boolean,
  onBytes: (bytes: number) => void,
): Promise<string> {
  const hash = createHash('sha256');
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      onBytes(chunk.byteLength);
      callback(null, chunk);
    },
  });
  await pipeline(
    createReadStream(source),
    meter,
    createWriteStream(target, { flags: overwrite ? 'w' : 'wx', mode }),
  );
  return hash.digest('hex');
}

async function validateSourcesStable(
  entries: LegacyImportEntry[],
  hashes: Map<string, string>,
): Promise<void> {
  for (const entry of entries) {
    const expected = hashes.get(entryKey(entry));
    if (!expected) throw new Error(`Missing source hash for ${entry.sourcePath}`);
    await validateSourceStable(entry, expected);
  }
}

async function validateSourceStable(entry: LegacyImportEntry, expectedHash: string): Promise<void> {
  const stats = await lstat(entry.sourcePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== entry.size) {
    throw new Error(`Legacy import source changed during migration: ${entry.sourcePath}`);
  }
  if (await hashFile(entry.sourcePath) !== expectedHash) {
    throw new Error(`Legacy import source changed during migration: ${entry.sourcePath}`);
  }
}

async function validateMemoryTargets(
  targetRoot: string,
  activeEntries: LegacyImportEntry[],
  activeHashes: Map<string, string>,
  overlayEntries: LegacyImportEntry[],
  overlayHashes: Map<string, string>,
): Promise<void> {
  const winners = new Map<string, { entry: LegacyImportEntry; hash: string }>();
  for (const entry of activeEntries) {
    if (isGeneratedMemoryMetadata(entry.targetRelativePath)) continue;
    winners.set(entry.targetRelativePath, { entry, hash: activeHashes.get(entryKey(entry))! });
  }
  for (const entry of overlayEntries) {
    if (isGeneratedMemoryMetadata(entry.targetRelativePath)) continue;
    winners.set(entry.targetRelativePath, { entry, hash: overlayHashes.get(entryKey(entry))! });
  }
  for (const [relativePath, winner] of winners) {
    if (await hashFile(path.join(targetRoot, relativePath)) !== winner.hash) {
      throw new Error(`Legacy memory target failed validation: ${winner.entry.relativePath}`);
    }
  }
}

function isGeneratedMemoryMetadata(relativePath: string): boolean {
  return relativePath === MEMORY_INDEX_FILE_NAME
    || relativePath === MEMORY_ROOT_MARKER_FILE_NAME
    || relativePath === LEGACY_MEMORY_IMPORT_RECEIPT_FILE_NAME;
}

async function validateDirectTargets(
  targetRoot: string,
  entries: LegacyImportEntry[],
  hashes: Map<string, string>,
): Promise<void> {
  for (const entry of entries) {
    const expected = hashes.get(entryKey(entry));
    if (!expected || await hashFile(path.join(targetRoot, entry.targetRelativePath)) !== expected) {
      throw new Error(`Legacy policy target failed validation: ${entry.relativePath}`);
    }
  }
}

async function commitPolicyImports(
  plan: LegacyDataImportPlan,
  hashes: Map<string, string>,
): Promise<void> {
  if (!plan.policyEntries.length) return;
  const layout = desktopDataLayout(plan.activeRoot);
  await mkdir(layout.pcLocalPoliciesRoot, { recursive: true });
  for (const entry of plan.policyEntries) {
    const source = path.join(plan.policyStagingRoot, entry.targetRelativePath);
    const target = path.join(layout.pcLocalPoliciesRoot, entry.targetRelativePath);
    const targetKind = await pathKind(target);
    if (targetKind !== 'missing') {
      if (targetKind !== 'other' || await hashFile(target) !== hashes.get(entryKey(entry))) {
        throw new Error(`Refusing to overwrite an existing unified policy: ${target}`);
      }
      await rm(source, { force: true });
      continue;
    }
    await rename(source, target);
  }
  await rm(plan.policyStagingRoot, { recursive: true, force: true });
}

async function clearLegacyStoragePath(activeRoot: string): Promise<void> {
  const configPath = desktopDataLayout(activeRoot).runtimeConfigPath;
  const config = await readJsonRecord(configPath);
  if (!config || !Object.hasOwn(config, 'storagePath')) return;
  delete config.storagePath;
  config.schemaVersion = Math.max(3, numericValue(config.schemaVersion));
  await writeJsonAtomically(configPath, config);
}

async function updatePendingStage(
  pending: PendingDataMigration,
  stage: NonNullable<PendingDataMigration['legacyTransactionStage']>,
  appDataRoot: string,
): Promise<PendingDataMigration> {
  if (pending.legacyTransactionStage === stage) return pending;
  const updated = { ...pending, legacyTransactionStage: stage };
  await writePendingDataMigration(appDataRoot, updated);
  return updated;
}

async function cleanupOwnedDirectory(root: string, migrationId: string): Promise<void> {
  const kind = await pathKind(root);
  if (kind === 'missing') return;
  if (kind !== 'directory') throw new Error(`Legacy import staging is invalid: ${root}`);
  const owner = await readJsonRecord(path.join(root, DATA_MIGRATION_OWNER_FILE_NAME));
  if (owner?.owner !== 'setsuna-desktop' || owner.migrationId !== migrationId) {
    const entries = await readdir(root);
    if (
      entries.length
      && !entries.every((entry) => (
        isAtomicJsonTemporaryFileName(entry, DATA_MIGRATION_OWNER_FILE_NAME)
      ))
    ) {
      throw new Error(`Refusing to use unowned legacy import staging: ${root}`);
    }
  }
  await rm(root, { recursive: true, force: true });
}

async function assertMigrationOwner(root: string, migrationId: string): Promise<void> {
  const owner = await readJsonRecord(path.join(root, DATA_MIGRATION_OWNER_FILE_NAME));
  if (owner?.owner !== 'setsuna-desktop' || owner.migrationId !== migrationId) {
    throw new Error(`Refusing to use unowned legacy import staging: ${root}`);
  }
}

async function writeMigrationOwner(root: string, migrationId: string): Promise<void> {
  await writeJsonAtomically(path.join(root, DATA_MIGRATION_OWNER_FILE_NAME), {
    owner: 'setsuna-desktop',
    version: 1,
    migrationId,
  });
}

async function createDirectories(root: string, directories: LegacyImportDirectory[]): Promise<void> {
  for (const directory of directories) {
    await mkdir(path.join(root, directory.relativePath), { recursive: true });
  }
}

async function applyDirectoryMetadata(
  root: string,
  directories: LegacyImportDirectory[],
): Promise<void> {
  const byPath = new Map(directories.map((directory) => [directory.relativePath, directory]));
  const deepestFirst = [...byPath.values()].sort((left, right) => (
    right.relativePath.split(path.sep).length - left.relativePath.split(path.sep).length
  ));
  for (const directory of deepestFirst) {
    const target = path.join(root, directory.relativePath);
    const modified = new Date(directory.mtimeMs);
    await chmod(target, directory.mode).catch(() => undefined);
    await utimes(target, modified, modified).catch(() => undefined);
  }
}

async function readMemoryIndex(root: string): Promise<Record<string, unknown>> {
  const indexPath = path.join(root, MEMORY_INDEX_FILE_NAME);
  const kind = await pathKind(indexPath);
  if (kind === 'missing') return { version: 1, memories: [], stage1Outputs: [] };
  const value = await readJsonRecord(indexPath);
  if (value?.version !== 1 || !Array.isArray(value.memories)) {
    throw new Error(`Invalid memory index: ${indexPath}`);
  }
  return value;
}

function mergeMemoryIndexes(
  preferred: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const preferredMemories = recordArray(preferred.memories);
  const fallbackMemories = recordArray(fallback.memories);
  const preferredStage1 = recordArray(preferred.stage1Outputs);
  const fallbackStage1 = recordArray(fallback.stage1Outputs);
  return {
    ...fallback,
    ...preferred,
    version: 1,
    memories: mergeRecords(preferredMemories, fallbackMemories, (entry) => textValue(entry.id)),
    stage1Outputs: mergeRecords(preferredStage1, fallbackStage1, (entry) => (
      textValue(entry.id)
      || (textValue(entry.threadId)
        ? `${textValue(entry.threadId)}\0${textValue(entry.turnId)}`
        : '')
    )),
    ...(preferred.phase2Job !== undefined
      ? { phase2Job: preferred.phase2Job }
      : fallback.phase2Job !== undefined
        ? { phase2Job: fallback.phase2Job }
        : {}),
  };
}

function mergeRecords(
  preferred: Record<string, unknown>[],
  fallback: Record<string, unknown>[],
  keyFor: (entry: Record<string, unknown>) => string,
): Record<string, unknown>[] {
  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const entry of [...preferred, ...fallback]) {
    const key = keyFor(entry);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(entry);
  }
  return merged;
}

function entryKey(entry: LegacyImportEntry): string {
  return `${entry.origin}\0${entry.sourcePath}`;
}

async function pathKind(target: string): Promise<'missing' | 'directory' | 'symlink' | 'other'> {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) return 'symlink';
    if (stats.isDirectory()) return 'directory';
    return 'other';
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return 'missing';
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => (
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
      ))
    : [];
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numericValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
