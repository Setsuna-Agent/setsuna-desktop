import {
  DESKTOP_WEBDAV_SYNC_CATEGORY_IDS,
  type DesktopWebDavSyncCategoryId,
} from '../contracts/index.js';
import type { ErasedFeatureSettingsDocumentDefinition } from '@setsuna-desktop/feature-core/settings';
import { lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { WebDavSyncStorageHost } from './capabilities.js';
import { featureSettingsRestoreTargetPaths } from './portable-feature-settings.js';
import { categoryTargetPaths } from './snapshot-data.js';

const JOURNAL_FILE = '.webdav-sync-restore.json';
const JOURNAL_VERSION = 1;
const MAX_JOURNAL_BYTES = 64 * 1024;
const ROLLBACK_NAME_PATTERN = /^\.webdav-sync-rollback-[0-9a-f-]{36}$/u;

export type WebDavRestoreJournal = {
  version: 1;
  phase: 'committing' | 'installing' | 'committed' | 'validated';
  rollbackDirectory: string;
  categories: DesktopWebDavSyncCategoryId[];
  targets: string[];
  existingTargets: string[];
};

export type WebDavRestoreRecovery = 'none' | 'rolled-back' | 'awaiting-validation';

export function webDavRestoreJournalPath(dataRoot: string): string {
  return path.join(dataRoot, JOURNAL_FILE);
}

export async function writeWebDavRestoreJournal(
  dataRoot: string,
  journal: WebDavRestoreJournal,
  storage: WebDavSyncStorageHost,
): Promise<void> {
  await storage.writeJsonAtomically(webDavRestoreJournalPath(dataRoot), journal);
}

export async function assertNoPendingWebDavRestore(dataRoot: string): Promise<void> {
  if (!await pathExists(webDavRestoreJournalPath(dataRoot))) return;
  throw new Error('上一次 WebDAV 还原尚未恢复完成，请重启 Setsuna 后再试。');
}

export async function clearWebDavRestoreJournal(
  dataRoot: string,
  storage: WebDavSyncStorageHost,
): Promise<void> {
  await storage.removeFileDurably(webDavRestoreJournalPath(dataRoot));
}

/** Makes rename/remove directory entries durable before the journal advances. */
export async function syncWebDavRestorePathParents(
  dataRoot: string,
  changedPaths: readonly string[],
  storage: WebDavSyncStorageHost,
): Promise<void> {
  const resolvedRoot = path.resolve(dataRoot);
  const directories = new Set<string>();
  for (const changedPath of changedPaths) {
    const resolvedPath = path.resolve(changedPath);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error('WebDAV 还原持久化路径超出 Setsuna 数据目录。');
    }
    let directory = resolvedPath === resolvedRoot ? resolvedRoot : path.dirname(resolvedPath);
    for (;;) {
      directories.add(directory);
      if (directory === resolvedRoot) break;
      directory = path.dirname(directory);
    }
  }
  const ordered = [...directories].sort((left, right) => pathDepth(right) - pathDepth(left));
  for (const directory of ordered) await storage.syncDirectoryDurably(directory);
}

/** Runs before Runtime opens SQLite and always rolls an interrupted commit back. */
export async function recoverInterruptedWebDavRestore(
  dataRoot: string,
  storage: WebDavSyncStorageHost,
  featureSettingsDocuments: readonly ErasedFeatureSettingsDocumentDefinition[] = [],
): Promise<WebDavRestoreRecovery> {
  const journal = await readJournal(dataRoot, storage, featureSettingsDocuments);
  if (!journal) return 'none';
  if (journal.phase === 'validated') {
    await discardValidatedJournal(dataRoot, journal, storage);
    return 'none';
  }
  if (journal.phase === 'committed') return 'awaiting-validation';
  await rollbackJournal(dataRoot, journal, storage);
  return 'rolled-back';
}

export async function finalizeCommittedWebDavRestore(
  dataRoot: string,
  storage: WebDavSyncStorageHost,
  featureSettingsDocuments: readonly ErasedFeatureSettingsDocumentDefinition[] = [],
): Promise<boolean> {
  const journal = await readJournal(dataRoot, storage, featureSettingsDocuments);
  if (!journal) return false;
  if (journal.phase !== 'committed') {
    throw new Error('WebDAV 还原尚未提交，不能清理回滚数据。');
  }
  await writeWebDavRestoreJournal(dataRoot, { ...journal, phase: 'validated' }, storage);
  await discardValidatedJournal(dataRoot, { ...journal, phase: 'validated' }, storage);
  return true;
}

async function discardValidatedJournal(
  dataRoot: string,
  journal: WebDavRestoreJournal,
  storage: WebDavSyncStorageHost,
): Promise<void> {
  const rollbackRoot = path.join(dataRoot, journal.rollbackDirectory);
  await rm(rollbackRoot, { recursive: true, force: true });
  await clearWebDavRestoreJournal(dataRoot, storage);
}

export async function rollbackCommittedWebDavRestore(
  dataRoot: string,
  storage: WebDavSyncStorageHost,
  featureSettingsDocuments: readonly ErasedFeatureSettingsDocumentDefinition[] = [],
): Promise<boolean> {
  const journal = await readJournal(dataRoot, storage, featureSettingsDocuments);
  if (!journal) return false;
  await rollbackJournal(dataRoot, journal, storage);
  return true;
}

async function rollbackJournal(
  dataRoot: string,
  journal: WebDavRestoreJournal,
  storage: WebDavSyncStorageHost,
): Promise<void> {
  if (journal.phase === 'validated') {
    throw new Error('已经验证成功的 WebDAV 还原不能再自动回滚。');
  }
  const rollbackRoot = path.join(dataRoot, journal.rollbackDirectory);
  const existing = new Set(journal.existingTargets);
  const changedPaths: string[] = [];
  // Commit moves every old target before installing any new target. During an
  // interrupted `committing` phase, a missing backup is safe only when the old
  // target still exists and therefore was never moved.
  for (const relative of journal.existingTargets) {
    const target = safeTarget(dataRoot, relative);
    const backup = safeTarget(rollbackRoot, relative);
    if (await pathExists(backup)) continue;
    if (journal.phase === 'committing' && await pathExists(target)) continue;
    throw new Error('WebDAV 还原回滚数据不完整；为避免覆盖现有文件，Setsuna 已停止自动恢复。');
  }
  for (const relative of [...journal.targets].reverse()) {
    const target = safeTarget(dataRoot, relative);
    const backup = safeTarget(rollbackRoot, relative);
    if (!existing.has(relative)) {
      await rm(target, { recursive: true, force: true });
      changedPaths.push(target);
      continue;
    }
    if (!await pathExists(backup)) continue;
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await rename(backup, target);
    changedPaths.push(backup, target);
  }
  await syncWebDavRestorePathParents(dataRoot, changedPaths, storage);
  await rm(rollbackRoot, { recursive: true, force: true });
  await clearWebDavRestoreJournal(dataRoot, storage);
}

async function readJournal(
  dataRoot: string,
  storage: WebDavSyncStorageHost,
  featureSettingsDocuments: readonly ErasedFeatureSettingsDocumentDefinition[],
): Promise<WebDavRestoreJournal | null> {
  let raw: unknown;
  try {
    const journalPath = webDavRestoreJournalPath(dataRoot);
    const stats = await lstat(journalPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_JOURNAL_BYTES) {
      throw invalidJournal();
    }
    raw = JSON.parse(await readFile(journalPath, 'utf8')) as unknown;
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw new Error('WebDAV 还原恢复日志无法读取。', { cause: error });
  }
  if (!isRecord(raw) || raw.version !== JOURNAL_VERSION) throw invalidJournal();
  const phase = raw.phase === 'committing'
    || raw.phase === 'installing'
    || raw.phase === 'committed'
    || raw.phase === 'validated'
    ? raw.phase
    : null;
  const rollbackDirectory = typeof raw.rollbackDirectory === 'string'
    ? raw.rollbackDirectory
    : '';
  const categories = normalizeCategories(raw.categories);
  const requiredTargets = new Set(categoryTargetPaths(dataRoot, categories, storage).map((target) => (
    safeRelativePath(dataRoot, target)
  )));
  const allowedTargets = new Set([
    ...requiredTargets,
    ...featureSettingsRestoreTargetPaths(
      dataRoot,
      featureSettingsDocuments,
      categories,
    ).map((target) => safeRelativePath(dataRoot, target)),
  ]);
  const targets = normalizeRelativePaths(raw.targets, allowedTargets);
  if ([...requiredTargets].some((target) => !targets.includes(target))) throw invalidJournal();
  const existingTargets = normalizeRelativePaths(raw.existingTargets, new Set(targets));
  if (!phase || !ROLLBACK_NAME_PATTERN.test(rollbackDirectory) || !targets.length) {
    throw invalidJournal();
  }
  return {
    version: JOURNAL_VERSION,
    phase,
    rollbackDirectory,
    categories,
    targets,
    existingTargets,
  };
}

function normalizeCategories(value: unknown): DesktopWebDavSyncCategoryId[] {
  if (!Array.isArray(value) || !value.length) throw invalidJournal();
  const categories = value.filter((item): item is DesktopWebDavSyncCategoryId => (
    typeof item === 'string' && DESKTOP_WEBDAV_SYNC_CATEGORY_IDS.includes(item as DesktopWebDavSyncCategoryId)
  ));
  if (categories.length !== value.length || new Set(categories).size !== categories.length) {
    throw invalidJournal();
  }
  return categories;
}

function normalizeRelativePaths(value: unknown, allowed: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) throw invalidJournal();
  const paths = value.filter((item): item is string => typeof item === 'string');
  if (
    paths.length !== value.length
    || new Set(paths).size !== paths.length
    || paths.some((item) => !allowed.has(item))
  ) throw invalidJournal();
  return paths;
}

export function safeRelativePath(root: string, target: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('WebDAV 还原目标超出 Setsuna 数据目录。');
  }
  return relative;
}

function safeTarget(root: string, relative: string): string {
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw invalidJournal();
  return target;
}

async function pathExists(target: string): Promise<boolean> {
  return lstat(target).then(() => true).catch((error) => {
    if (isMissingFileError(error)) return false;
    throw error;
  });
}

function invalidJournal(): Error {
  return new Error('WebDAV 还原恢复日志无效；为避免误删本地数据，Setsuna 已停止自动恢复。');
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function pathDepth(value: string): number {
  return path.resolve(value).split(path.sep).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
