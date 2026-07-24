import {
  DESKTOP_DATA_MIGRATION_CATEGORY_IDS,
  type DesktopDataMigrationCategoryId,
  type DesktopDataMigrationCategorySummary,
  type DesktopDataMigrationIssue,
} from '@setsuna-desktop/contracts';
import { lstat, readFile, readlink, readdir, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';
import { DATA_ROOT_MARKER_FILE_NAME } from './layout.js';
import type { DataMigrationManifest, DataMigrationManifestEntry } from './model.js';
import { readDataRootMarkerSync, samePath } from './bootstrap.js';
import { isNetworkVolumePath } from './volume-kind.js';

const TRANSIENT_DIRECTORY_NAMES = new Set([
  'cache',
  'code cache',
  'crashpad',
  'dawncache',
  'dawngraphitecache',
  'dawnwebgpucache',
  'gpucache',
  'grshadercache',
  'logs',
  'shadercache',
]);
const TRANSIENT_ROOT_FILE_NAMES = new Set([
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
]);
const MINIMUM_SPACE_RESERVE_BYTES = 64 * 1024 * 1024;
const ACTIVE_MEMORY_INDEX_PATH = 'runtime/memories/memories.json';

export async function buildDataMigrationManifest(sourceRoot: string): Promise<{
  manifest: DataMigrationManifest;
  blockers: DesktopDataMigrationIssue[];
}> {
  const root = path.resolve(sourceRoot);
  const rootStats = await lstat(root);
  const entries: DataMigrationManifestEntry[] = [];
  const directories: DataMigrationManifest['directories'] = [];
  const skipped: DataMigrationManifest['skipped'] = [];
  const blockers: DesktopDataMigrationIssue[] = [];
  await scanDirectory(root, '', entries, directories, skipped, blockers);
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    manifest: {
      entries,
      directories,
      skipped,
      totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
      rootMode: rootStats.mode,
    },
    blockers,
  };
}

export async function inspectDataMigrationTarget(input: {
  sourceRoot: string;
  targetRoot: string;
  totalBytes: number;
  reservedRoots?: readonly string[];
  expectedTargetDeviceId?: string;
  networkVolumeDetector?: (target: string) => Promise<boolean>;
}): Promise<{
  availableBytes: number;
  requiredBytes: number;
  targetDeviceId: string;
  blockers: DesktopDataMigrationIssue[];
  warnings: DesktopDataMigrationIssue[];
}> {
  const sourceRoot = path.resolve(input.sourceRoot);
  const targetRoot = path.resolve(input.targetRoot);
  const blockers: DesktopDataMigrationIssue[] = [];
  const warnings: DesktopDataMigrationIssue[] = [];
  const requiredBytes = input.totalBytes + Math.max(
    MINIMUM_SPACE_RESERVE_BYTES,
    Math.ceil(input.totalBytes * 0.1),
  );

  const sourceStats = await lstat(sourceRoot).catch(() => null);
  if (!sourceStats?.isDirectory() || sourceStats.isSymbolicLink()) {
    blockers.push(issue('invalid_source', 'The current Setsuna data root is not a regular directory.', sourceRoot));
  }

  const targetStats = await lstat(targetRoot).catch(() => null);
  if (targetStats?.isSymbolicLink()) {
    blockers.push(issue('symlink_not_supported', 'A symlink cannot be used as the Setsuna data root.', targetRoot));
  } else if (targetStats && !targetStats.isDirectory()) {
    blockers.push(issue('invalid_target', 'The selected data location is not a directory.', targetRoot));
  }

  const canonicalSource = await canonicalPath(sourceRoot);
  const canonicalTarget = await canonicalPath(targetRoot);
  if (samePath(canonicalSource, canonicalTarget)) {
    blockers.push(issue('same_directory', 'The selected location is already the current data root.', targetRoot));
  } else if (containsPath(canonicalSource, canonicalTarget) || containsPath(canonicalTarget, canonicalSource)) {
    blockers.push(issue(
      'source_target_nested',
      'The current and selected data locations cannot contain one another.',
      targetRoot,
    ));
  }
  for (const reservedRoot of input.reservedRoots ?? []) {
    const canonicalReserved = await canonicalPath(reservedRoot);
    if (
      samePath(canonicalReserved, canonicalTarget)
      || containsPath(canonicalReserved, canonicalTarget)
      || containsPath(canonicalTarget, canonicalReserved)
    ) {
      blockers.push(issue(
        'invalid_target',
        'The selected location overlaps Setsuna bootstrap or migration control files.',
        targetRoot,
      ));
      break;
    }
  }

  if (targetStats?.isDirectory()) {
    const targetEntries = await readdir(targetRoot);
    if (targetEntries.length) {
      const marker = readDataRootMarkerSync(targetRoot);
      blockers.push(marker
        ? issue(
            'existing_setsuna_data',
            'The selected directory already contains another Setsuna data root. Merging is not supported.',
            targetRoot,
          )
        : issue(
            'target_not_empty',
            'The selected directory is not empty and has no Setsuna ownership marker.',
            targetRoot,
          ));
    }
  }

  const spaceRoot = await nearestExistingDirectory(targetRoot);
  const isNetworkVolume = await (
    input.networkVolumeDetector ?? isNetworkVolumePath
  )(spaceRoot);
  if (looksLikeCloudOrNetworkLocation(targetRoot) || isNetworkVolume) {
    warnings.push(issue(
      'network_or_cloud_location',
      'Cloud-synced and network locations can break SQLite WAL and atomic rename guarantees.',
      targetRoot,
    ));
  }
  const targetDeviceId = String((await lstat(spaceRoot)).dev);
  if (
    input.expectedTargetDeviceId
    && input.expectedTargetDeviceId !== targetDeviceId
  ) {
    blockers.push(issue(
      'target_unavailable',
      'The selected target volume is unavailable or has changed.',
      targetRoot,
    ));
  }
  const volume = await statfs(spaceRoot);
  const availableBytes = clampSafeInteger(Number(volume.bavail) * Number(volume.bsize));
  if (availableBytes < requiredBytes) {
    blockers.push(issue(
      'insufficient_space',
      `The selected volume needs ${requiredBytes} bytes but only ${availableBytes} bytes are available.`,
      targetRoot,
    ));
  }

  return { availableBytes, requiredBytes, targetDeviceId, blockers, warnings };
}

export function summarizeMigrationCategories(
  manifest: DataMigrationManifest,
): DesktopDataMigrationCategorySummary[] {
  const totals = new Map<DesktopDataMigrationCategoryId, { fileCount: number; totalBytes: number }>(
    DESKTOP_DATA_MIGRATION_CATEGORY_IDS.map((id) => [id, { fileCount: 0, totalBytes: 0 }]),
  );
  for (const entry of manifest.entries) {
    const summary = totals.get(entry.category);
    if (!summary) continue;
    summary.fileCount += 1;
    summary.totalBytes += entry.size;
  }
  return DESKTOP_DATA_MIGRATION_CATEGORY_IDS.map((id) => ({ id, ...totals.get(id)! }));
}

export async function summarizeMigrationPlanCategories(
  manifest: DataMigrationManifest,
): Promise<DesktopDataMigrationCategorySummary[]> {
  const summaries = summarizeMigrationCategories(manifest);
  const recordCount = await activeMemoryRecordCount(manifest);
  if (recordCount === undefined) return summaries;
  return summaries.map((summary) => (
    summary.id === 'memories' ? { ...summary, recordCount } : summary
  ));
}

export function migrationCategory(relativePath: string): DesktopDataMigrationCategoryId {
  const normalized = relativePath.replaceAll(path.sep, '/').toLowerCase();
  if (normalized === 'secure-credentials.json') return 'settings_credentials';
  if (!normalized.startsWith('runtime/')) return 'desktop_browser';
  if (
    normalized === 'runtime/threads.sqlite'
    || normalized.startsWith('runtime/threads.sqlite-')
    || normalized.startsWith('runtime/threads/')
  ) return 'conversations';
  if (
    normalized.startsWith('runtime/memories/')
    || normalized.startsWith('runtime/.memories-before-unification-')
  ) return 'memories';
  if (
    normalized.startsWith('runtime/attachments/')
    || normalized.startsWith('runtime/generated-images/')
  ) return 'attachments_images';
  if (normalized.startsWith('runtime/workspace-dependencies/')) return 'runtime_dependencies';
  if (
    normalized.startsWith('runtime/projects')
    || normalized.startsWith('runtime/temporary-workspace/')
    || normalized.startsWith('runtime/skills')
    || normalized.startsWith('runtime/user-skills/')
    || normalized.startsWith('runtime/plugins')
    || normalized.startsWith('runtime/rules/')
    || normalized.startsWith('runtime/pc-local-policies/')
    || normalized.startsWith('runtime/policy-amendments')
    || normalized.startsWith('runtime/tool-approvals')
  ) return 'projects_capabilities';
  return 'settings_credentials';
}

async function activeMemoryRecordCount(
  manifest: DataMigrationManifest,
): Promise<number | undefined> {
  const indexEntry = manifest.entries.find((entry) => (
    entry.relativePath.replaceAll(path.sep, '/').toLowerCase() === ACTIVE_MEMORY_INDEX_PATH
  ));
  if (!indexEntry) return 0;
  try {
    const parsed = JSON.parse(await readFile(indexEntry.absolutePath, 'utf8')) as {
      memories?: unknown;
    };
    if (!Array.isArray(parsed.memories)) return undefined;
    return parsed.memories.filter(isPreviewableMemoryRecord).length;
  } catch {
    // Migration validation reports malformed managed JSON. The plan can still show
    // file totals without presenting an unreliable domain-record count.
    return undefined;
  }
}

function isPreviewableMemoryRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.status !== 'archived'
    && record.status !== 'deleted'
    && typeof record.content === 'string'
    && Boolean(record.content.trim());
}

async function scanDirectory(
  root: string,
  relativeDirectory: string,
  entries: DataMigrationManifestEntry[],
  directories: DataMigrationManifest['directories'],
  skipped: DataMigrationManifest['skipped'],
  blockers: DesktopDataMigrationIssue[],
): Promise<void> {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const children = await readdir(absoluteDirectory, { withFileTypes: true });
  for (const child of children) {
    const relativePath = path.join(relativeDirectory, child.name);
    if (shouldSkip(relativePath, child.name, child.isDirectory())) {
      skipped.push({ relativePath, reason: 'rebuildable' });
      continue;
    }
    const absolutePath = path.join(root, relativePath);
    if (child.isSymbolicLink()) {
      const sourceLinkTarget = await readlink(absolutePath);
      const resolvedTarget = path.resolve(path.dirname(absolutePath), sourceLinkTarget);
      if (!isPathInside(root, resolvedTarget)) {
        blockers.push(issue(
          'symlink_not_supported',
          'Only symlinks that resolve inside the data root can be migrated.',
          absolutePath,
        ));
        continue;
      }
      // Absolute links created by managed runtimes would otherwise keep pointing at
      // the old data root. A relative target preserves the same in-root relationship
      // after staging is atomically renamed into the selected location.
      const linkTarget = path.isAbsolute(sourceLinkTarget)
        ? path.relative(path.dirname(absolutePath), resolvedTarget) || '.'
        : sourceLinkTarget;
      const stats = await lstat(absolutePath);
      entries.push({
        absolutePath,
        relativePath,
        category: migrationCategory(relativePath),
        kind: 'symlink',
        linkTarget,
        ...(linkTarget !== sourceLinkTarget ? { sourceLinkTarget } : {}),
        size: 0,
        mode: stats.mode,
        mtimeMs: stats.mtimeMs,
      });
      continue;
    }
    if (child.isDirectory()) {
      const stats = await lstat(absolutePath);
      directories.push({
        relativePath,
        mode: stats.mode,
        mtimeMs: stats.mtimeMs,
      });
      await scanDirectory(root, relativePath, entries, directories, skipped, blockers);
      continue;
    }
    if (!child.isFile()) {
      blockers.push(issue(
        'unsupported_file',
        'The data root contains an unsupported special file.',
        absolutePath,
      ));
      continue;
    }
    const stats = await lstat(absolutePath);
    entries.push({
      absolutePath,
      relativePath,
      category: migrationCategory(relativePath),
      kind: 'file',
      size: stats.size,
      mode: stats.mode,
      mtimeMs: stats.mtimeMs,
    });
  }
}

function shouldSkip(relativePath: string, name: string, directory: boolean): boolean {
  if (relativePath === DATA_ROOT_MARKER_FILE_NAME) return true;
  if (!relativePath.includes(path.sep) && TRANSIENT_ROOT_FILE_NAMES.has(name)) return true;
  const normalized = relativePath.replaceAll(path.sep, '/').toLowerCase();
  // Phase 2 used a private Git repository before switching to snapshot baselines.
  // The current runtime never reads this history, so carrying it forward only
  // inflates the memory category with implementation files.
  if (directory && normalized === 'runtime/memories/.git') return true;
  const segments = normalized.split('/');
  if (
    directory
    && TRANSIENT_DIRECTORY_NAMES.has(name.toLowerCase())
    && (
      segments.length === 1
      || segments[0] === 'partitions'
      || normalized === 'runtime/workspace-dependencies/cache'
      || normalized === 'runtime/logs'
    )
  ) {
    return true;
  }
  if (name !== 'LOCK') return false;
  const parentSegments = segments.slice(0, -1);
  return normalized.startsWith('session storage/')
    || normalized.startsWith('shared_proto_db/')
    || parentSegments.some((segment) => segment === 'leveldb' || segment.endsWith('.leveldb'));
}

async function canonicalPath(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    const parent = path.dirname(target);
    if (parent === target) return path.resolve(target);
    return path.join(await canonicalPath(parent), path.basename(target));
  }
}

async function nearestExistingDirectory(target: string): Promise<string> {
  const stats = await lstat(target).catch(() => null);
  if (stats?.isDirectory()) return target;
  const parent = path.dirname(target);
  if (parent === target) throw new Error(`No existing parent directory for ${target}`);
  return nearestExistingDirectory(parent);
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(pathComparisonKey(parent), pathComparisonKey(child));
  return Boolean(relative)
    && !relative.startsWith('..')
    && !path.isAbsolute(relative);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(pathComparisonKey(root), pathComparisonKey(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathComparisonKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'linux' ? resolved : resolved.toLocaleLowerCase('en-US');
}

function looksLikeCloudOrNetworkLocation(target: string): boolean {
  const normalized = target.replaceAll('\\', '/').toLowerCase();
  return normalized.includes('/library/mobile documents/')
    || normalized.includes('/icloud drive/')
    || normalized.includes('/onedrive')
    || normalized.includes('/dropbox/')
    || normalized.includes('/google drive/')
    || normalized.startsWith('//');
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
