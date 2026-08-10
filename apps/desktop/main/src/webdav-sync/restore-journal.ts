import {
  DESKTOP_WEBDAV_SYNC_CATEGORY_IDS,
  type DesktopWebDavSyncCategoryId,
} from '@setsuna-desktop/contracts';
import { lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomically } from '../data-root/atomic-json.js';
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
): Promise<void> {
  await writeJsonAtomically(webDavRestoreJournalPath(dataRoot), journal);
}

export async function assertNoPendingWebDavRestore(dataRoot: string): Promise<void> {
  if (!await pathExists(webDavRestoreJournalPath(dataRoot))) return;
  throw new Error('上一次 WebDAV 还原尚未恢复完成，请重启 Setsuna 后再试。');
}

export async function clearWebDavRestoreJournal(dataRoot: string): Promise<void> {
  await rm(webDavRestoreJournalPath(dataRoot), { force: true });
}

/** Runs before Runtime opens SQLite and always rolls an interrupted commit back. */
export async function recoverInterruptedWebDavRestore(
  dataRoot: string,
): Promise<WebDavRestoreRecovery> {
  const journal = await readJournal(dataRoot);
  if (!journal) return 'none';
  if (journal.phase === 'validated') {
    await discardValidatedJournal(dataRoot, journal);
    return 'none';
  }
  if (journal.phase === 'committed') return 'awaiting-validation';
  await rollbackJournal(dataRoot, journal);
  return 'rolled-back';
}

export async function finalizeCommittedWebDavRestore(dataRoot: string): Promise<boolean> {
  const journal = await readJournal(dataRoot);
  if (!journal) return false;
  if (journal.phase !== 'committed') {
    throw new Error('WebDAV 还原尚未提交，不能清理回滚数据。');
  }
  await writeWebDavRestoreJournal(dataRoot, { ...journal, phase: 'validated' });
  await discardValidatedJournal(dataRoot, { ...journal, phase: 'validated' });
  return true;
}

async function discardValidatedJournal(
  dataRoot: string,
  journal: WebDavRestoreJournal,
): Promise<void> {
  const rollbackRoot = path.join(dataRoot, journal.rollbackDirectory);
  await rm(rollbackRoot, { recursive: true, force: true });
  await clearWebDavRestoreJournal(dataRoot);
}

export async function rollbackCommittedWebDavRestore(dataRoot: string): Promise<boolean> {
  const journal = await readJournal(dataRoot);
  if (!journal) return false;
  await rollbackJournal(dataRoot, journal);
  return true;
}

async function rollbackJournal(dataRoot: string, journal: WebDavRestoreJournal): Promise<void> {
  if (journal.phase === 'validated') {
    throw new Error('已经验证成功的 WebDAV 还原不能再自动回滚。');
  }
  const rollbackRoot = path.join(dataRoot, journal.rollbackDirectory);
  const existing = new Set(journal.existingTargets);
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
      continue;
    }
    if (!await pathExists(backup)) continue;
    await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await rename(backup, target);
  }
  await rm(rollbackRoot, { recursive: true, force: true });
  await clearWebDavRestoreJournal(dataRoot);
}

async function readJournal(dataRoot: string): Promise<WebDavRestoreJournal | null> {
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
  const allowedTargets = new Set(categoryTargetPaths(dataRoot, categories).map((target) => (
    safeRelativePath(dataRoot, target)
  )));
  const targets = normalizeRelativePaths(raw.targets, allowedTargets);
  if (targets.length !== allowedTargets.size) throw invalidJournal();
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
