import {
  DESKTOP_DATA_MIGRATION_CATEGORY_IDS,
  type DesktopDataMigrationCategorySummary,
  type DesktopDataMigrationIssue,
} from '@setsuna-desktop/contracts';
import {
  lstat,
  readFile,
  readdir,
  statfs,
} from 'node:fs/promises';
import path from 'node:path';
import { samePath } from './bootstrap.js';
import type {
  LegacyDataImportPlan,
  LegacyImportDirectory,
  LegacyImportEntry,
  LegacyMemorySource,
} from './legacy-import.js';
import {
  LEGACY_MEMORY_IMPORT_RECEIPT_FILE_NAME,
  desktopDataLayout,
} from './layout.js';
import type { PendingDataMigration } from './model.js';

const CUSTOM_MEMORY_DIR_NAME = '.setsuna-memory';
const MEMORY_INDEX_FILE_NAME = 'memories.json';
const MEMORY_ROOT_MARKER_FILE_NAME = '.setsuna-memory-root.json';
const MINIMUM_SPACE_RESERVE_BYTES = 64 * 1024 * 1024;
const UNMANAGED_MEMORY_ENTRIES = new Set([
  MEMORY_INDEX_FILE_NAME,
  'MEMORY.md',
  'memory_summary.md',
  'raw_memories.md',
  'rollout_summaries',
  'skills',
]);

export async function buildLegacyDataImportPlan(
  pending: PendingDataMigration,
): Promise<LegacyDataImportPlan> {
  if (pending.kind !== 'legacy_import') throw new Error('Expected a legacy data import.');
  const paths = legacyTransactionPaths(pending);
  const blockers: DesktopDataMigrationIssue[] = [];
  const warnings: DesktopDataMigrationIssue[] = [];
  const activeReceipt = await readJsonRecord(
    path.join(paths.activeMemoryRoot, LEGACY_MEMORY_IMPORT_RECEIPT_FILE_NAME),
  );
  const memoryAlreadyCommitted = activeReceipt?.migrationId === pending.migrationId;
  let legacyMemorySource: LegacyMemorySource | undefined;
  let activeTree = emptyTree();
  let legacyTree = emptyTree();

  if (pending.legacyMemoryStoragePath && !memoryAlreadyCommitted) {
    try {
      legacyMemorySource = await resolveLegacyMemorySource(pending.legacyMemoryStoragePath);
      if (legacyMemorySource && !samePath(legacyMemorySource.root, paths.activeMemoryRoot)) {
        if (
          containsPath(legacyMemorySource.root, paths.activeMemoryRoot)
          || containsPath(paths.activeMemoryRoot, legacyMemorySource.root)
        ) {
          throw new Error('Legacy and unified memory roots cannot contain one another.');
        }
        activeTree = await scanOptionalTree(paths.activeMemoryRoot, 'active_memory');
        legacyTree = await scanMemoryTree(legacyMemorySource);
      }
    } catch (error) {
      blockers.push(issue(
        'invalid_source',
        error instanceof Error ? error.message : String(error),
        pending.legacyMemoryStoragePath,
      ));
    }
  }

  const layout = desktopDataLayout(paths.activeRoot);
  const policyReceipt = await readJsonRecord(layout.legacyDataImportReceiptPath);
  const policyEntries = policyReceipt?.policyImportComplete === true
    ? []
    : await inspectPolicyEntries(pending.legacyPolicyPaths ?? [], layout, blockers);
  const allEntries = [...activeTree.entries, ...legacyTree.entries, ...policyEntries];
  const totalBytes = allEntries.reduce((total, entry) => total + entry.size, 0);
  const requiredBytes = totalBytes
    ? totalBytes + Math.max(MINIMUM_SPACE_RESERVE_BYTES, Math.ceil(totalBytes * 0.1))
    : 0;
  const spaceRoot = await nearestExistingDirectory(paths.activeRoot);
  const volume = await statfs(spaceRoot);
  const availableBytes = clampSafeInteger(Number(volume.bavail) * Number(volume.bsize));
  if (availableBytes < requiredBytes) {
    blockers.push(issue(
      'insufficient_space',
      `Legacy data import needs ${requiredBytes} bytes but only ${availableBytes} bytes are available.`,
      paths.activeRoot,
    ));
  }

  return {
    ...paths,
    activeMemoryEntries: activeTree.entries,
    activeMemoryDirectories: activeTree.directories,
    legacyMemoryEntries: legacyTree.entries,
    legacyMemoryDirectories: legacyTree.directories,
    ...(legacyMemorySource ? { legacyMemorySource } : {}),
    policyEntries,
    totalFiles: allEntries.length,
    totalBytes,
    requiredBytes,
    availableBytes,
    categories: summarizeEntries(allEntries),
    blockers,
    warnings,
    memoryAlreadyCommitted,
  };
}

async function inspectPolicyEntries(
  sourcePaths: readonly string[],
  layout: ReturnType<typeof desktopDataLayout>,
  blockers: DesktopDataMigrationIssue[],
): Promise<LegacyImportEntry[]> {
  const entries: LegacyImportEntry[] = [];
  const targetNames = new Set<string>();
  for (const sourcePath of sourcePaths) {
    const targetPath = policyTargetPath(layout, sourcePath);
    if (targetNames.has(targetPath)) {
      blockers.push(issue('invalid_source', 'Multiple legacy policies map to the same destination.', sourcePath));
      continue;
    }
    targetNames.add(targetPath);
    try {
      const stats = await lstat(sourcePath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        blockers.push(issue(
          stats.isSymbolicLink() ? 'symlink_not_supported' : 'invalid_source',
          'Legacy policy must be a regular file.',
          sourcePath,
        ));
        continue;
      }
      JSON.parse(await readFile(sourcePath, 'utf8'));
      entries.push({
        sourcePath: path.resolve(sourcePath),
        relativePath: path.join('legacy-policies', path.basename(sourcePath)),
        targetRelativePath: path.basename(targetPath),
        size: stats.size,
        mode: stats.mode,
        mtimeMs: stats.mtimeMs,
        category: 'projects_capabilities',
        origin: 'legacy_policy',
      });
    } catch (error) {
      blockers.push(issue(
        'invalid_source',
        `Legacy policy cannot be imported: ${error instanceof Error ? error.message : String(error)}`,
        sourcePath,
      ));
    }
  }
  return entries;
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

async function resolveLegacyMemorySource(storageContainer: string): Promise<LegacyMemorySource | undefined> {
  const container = path.resolve(storageContainer);
  const containerKind = await pathKind(container);
  if (containerKind === 'missing') throw new Error(`Legacy memory location is unavailable: ${container}`);
  if (containerKind === 'symlink') throw new Error(`Refusing to import symlinked memory container: ${container}`);
  if (containerKind !== 'directory') throw new Error(`Legacy memory container is not a directory: ${container}`);

  const customRoot = path.join(container, CUSTOM_MEMORY_DIR_NAME);
  const customKind = await pathKind(customRoot);
  if (customKind === 'symlink') throw new Error(`Refusing to import symlinked memory root: ${customRoot}`);
  if (customKind === 'other') throw new Error(`Legacy memory root is not a directory: ${customRoot}`);
  if (customKind === 'directory') {
    const marker = await readJsonRecord(path.join(customRoot, MEMORY_ROOT_MARKER_FILE_NAME));
    if (
      marker?.owner !== 'setsuna-desktop'
      || marker.version !== 1
      || typeof marker.legacyImportComplete !== 'boolean'
    ) {
      throw new Error(`Invalid legacy memory root marker: ${customRoot}`);
    }
    return { root: customRoot, managed: true };
  }
  const index = await readJsonRecord(path.join(container, MEMORY_INDEX_FILE_NAME));
  return index?.version === 1 && Array.isArray(index.memories)
    ? { root: container, managed: false }
    : undefined;
}

async function scanOptionalTree(
  root: string,
  origin: LegacyImportEntry['origin'],
): Promise<{ entries: LegacyImportEntry[]; directories: LegacyImportDirectory[] }> {
  const kind = await pathKind(root);
  if (kind === 'missing') return emptyTree();
  if (kind !== 'directory') throw new Error(`Legacy import source is not a regular directory: ${root}`);
  return scanTree(root, origin);
}

function scanMemoryTree(
  source: LegacyMemorySource,
): Promise<{ entries: LegacyImportEntry[]; directories: LegacyImportDirectory[] }> {
  return scanTree(
    source.root,
    'legacy_memory',
    source.managed ? undefined : (relativePath) => {
      const firstSegment = relativePath.split(path.sep)[0];
      return UNMANAGED_MEMORY_ENTRIES.has(firstSegment);
    },
  );
}

async function scanTree(
  root: string,
  origin: LegacyImportEntry['origin'],
  include?: (relativePath: string) => boolean,
): Promise<{ entries: LegacyImportEntry[]; directories: LegacyImportDirectory[] }> {
  const entries: LegacyImportEntry[] = [];
  const directories: LegacyImportDirectory[] = [];
  await walk('');
  return { entries, directories };

  async function walk(relativeDirectory: string): Promise<void> {
    const children = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    for (const child of children) {
      const relativePath = path.join(relativeDirectory, child.name);
      if (include && !include(relativePath)) continue;
      const sourcePath = path.join(root, relativePath);
      if (child.isSymbolicLink()) {
        throw new Error(`Refusing to import symlinked legacy entry: ${sourcePath}`);
      }
      const stats = await lstat(sourcePath);
      if (child.isDirectory()) {
        directories.push({ relativePath, mode: stats.mode, mtimeMs: stats.mtimeMs });
        await walk(relativePath);
      } else if (child.isFile()) {
        entries.push({
          sourcePath,
          relativePath: path.join(
            origin === 'active_memory' ? 'current-memories' : 'legacy-memories',
            relativePath,
          ),
          targetRelativePath: relativePath,
          size: stats.size,
          mode: stats.mode,
          mtimeMs: stats.mtimeMs,
          category: 'memories',
          origin,
        });
      } else {
        throw new Error(`Refusing to import special legacy entry: ${sourcePath}`);
      }
    }
  }
}

function summarizeEntries(entries: LegacyImportEntry[]): DesktopDataMigrationCategorySummary[] {
  const totals = new Map(
    DESKTOP_DATA_MIGRATION_CATEGORY_IDS.map((id) => [id, { fileCount: 0, totalBytes: 0 }]),
  );
  for (const entry of entries) {
    const total = totals.get(entry.category)!;
    total.fileCount += 1;
    total.totalBytes += entry.size;
  }
  return DESKTOP_DATA_MIGRATION_CATEGORY_IDS.map((id) => ({ id, ...totals.get(id)! }));
}

function policyTargetPath(layout: ReturnType<typeof desktopDataLayout>, sourcePath: string): string {
  return path.basename(sourcePath).toLowerCase().includes('shell-policy')
    ? layout.pcLocalShellPolicyPath
    : layout.pcLocalExecPolicyPath;
}

function emptyTree(): { entries: LegacyImportEntry[]; directories: LegacyImportDirectory[] } {
  return { entries: [], directories: [] };
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(comparisonPath(parent), comparisonPath(child));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function comparisonPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'linux'
    ? resolved
    : resolved.toLocaleLowerCase('en-US');
}

async function pathKind(target: string): Promise<'missing' | 'directory' | 'symlink' | 'other'> {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink()) return 'symlink';
    return stats.isDirectory() ? 'directory' : 'other';
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return 'missing';
    throw error;
  }
}

async function nearestExistingDirectory(target: string): Promise<string> {
  if (await pathKind(target) === 'directory') return target;
  const parent = path.dirname(target);
  if (parent === target) throw new Error(`No existing parent directory for ${target}`);
  return nearestExistingDirectory(parent);
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

function issue(
  code: DesktopDataMigrationIssue['code'],
  message: string,
  issuePath?: string,
): DesktopDataMigrationIssue {
  return { code, message, ...(issuePath ? { path: issuePath } : {}) };
}

function clampSafeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, value)) : 0;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
