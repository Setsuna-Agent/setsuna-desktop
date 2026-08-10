import type {
  DesktopWebDavSyncCategoryId,
  DesktopWebDavSyncRestoreCategoryDiff,
  DesktopWebDavSyncRestoreDiffItem,
  DesktopWebDavSyncRestorePlan,
} from '@setsuna-desktop/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { relocateDataRootContents } from '../data-root/relocate.js';
import { mergePortableConfigForRestore } from './portable-config.js';
import { mergePortableSkillStateForRestore } from './portable-skill-state.js';
import {
  buildProjectRestoreActions,
  projectRestoreFingerprint,
  stageMergedProjectIndex,
  type LocalProjectRecord,
  type PortableProjectRecord,
} from './portable-projects.js';
import { remapStagedProjectReferences } from './project-references.js';
import {
  assertNoPendingWebDavRestore,
  clearWebDavRestoreJournal,
  safeRelativePath,
  writeWebDavRestoreJournal,
  type WebDavRestoreJournal,
} from './restore-journal.js';
import type {
  LocalSnapshotInventoryItem,
  WebDavSnapshotManifest,
  WebDavSnapshotRecord,
} from './model.js';
import { categoryTargetPaths, mergeRestoredSecretsBuffer } from './snapshot-data.js';

const RESTORE_PLAN_TTL_MS = 10 * 60 * 1_000;
const MAX_VISIBLE_DIFF_ITEMS = 100;

export type StoredWebDavRestorePlan = {
  publicPlan: DesktopWebDavSyncRestorePlan;
  manifest: WebDavSnapshotManifest;
  portableProjects: PortableProjectRecord[];
  reviewedImpactFingerprint: string;
};

export function buildWebDavRestorePlan(input: {
  snapshot: WebDavSnapshotRecord;
  categories: DesktopWebDavSyncCategoryId[];
  localItems: LocalSnapshotInventoryItem[];
  localProjects?: LocalProjectRecord[];
  portableProjects?: PortableProjectRecord[];
  now?: Date;
}): StoredWebDavRestorePlan {
  const now = input.now ?? new Date();
  for (const category of input.categories) {
    if (!input.snapshot.manifest.categories.includes(category)) {
      throw new Error('所选快照不包含这个数据类别。');
    }
  }
  const portableProjects = input.portableProjects ?? [];
  const localProjects = input.localProjects ?? [];
  const includeProjects = input.categories.includes('conversations') || input.categories.includes('memories');
  const diffs = input.categories.map((category) => categoryDiff(
    category,
    input.snapshot.manifest.items.filter((item) => item.category === category && item.kind !== 'project-catalog'),
    input.localItems.filter((item) => item.category === category && item.kind !== 'project-catalog'),
  ));
  const publicPlan: DesktopWebDavSyncRestorePlan = {
    id: randomUUID(),
    snapshot: input.snapshot.summary,
    categories: [...input.categories],
    diffs,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RESTORE_PLAN_TTL_MS).toISOString(),
    overwrittenCount: diffs.reduce((sum, diff) => sum + diff.overwrittenCount, 0),
    removedCount: diffs.reduce((sum, diff) => sum + diff.removedCount, 0),
    projectActions: includeProjects
      ? buildProjectRestoreActions(portableProjects, localProjects)
      : [],
  };
  return {
    publicPlan,
    manifest: input.snapshot.manifest,
    portableProjects,
    reviewedImpactFingerprint: restoreImpactFingerprint(
      input.snapshot.manifest,
      input.categories,
      input.localItems,
      includeProjects ? projectRestoreFingerprint(portableProjects, localProjects) : '',
    ),
  };
}

export function assertRestorePlanCurrent(
  plan: StoredWebDavRestorePlan,
  localItems: readonly LocalSnapshotInventoryItem[],
  now = new Date(),
  localProjects: readonly LocalProjectRecord[] = [],
): void {
  if (Date.parse(plan.publicPlan.expiresAt) <= now.getTime()) {
    throw new Error('还原清单已过期，请重新检查覆盖内容。');
  }
  const current = restoreImpactFingerprint(
    plan.manifest,
    plan.publicPlan.categories,
    localItems,
    plan.publicPlan.projectActions.length || plan.portableProjects.length
      ? projectRestoreFingerprint(plan.portableProjects, localProjects)
      : '',
  );
  if (current !== plan.reviewedImpactFingerprint) {
    throw new Error('检查清单后，会被覆盖或删除的本地内容发生了变化，请重新检查。');
  }
}

export async function applyRestoredSnapshot(input: {
  dataRoot: string;
  stagingRoot: string;
  sourceDataRoot: string;
  categories: DesktopWebDavSyncCategoryId[];
  portableProjects?: PortableProjectRecord[];
  secretsBuffer?: Buffer;
}): Promise<void> {
  await relocateDataRootContents(input.stagingRoot, input.sourceDataRoot, input.dataRoot);
  const localConfigPath = path.join(input.dataRoot, 'runtime', 'config.json');
  const stagedConfigPath = path.join(input.stagingRoot, 'runtime', 'config.json');
  if (input.categories.includes('preferences') && await pathExists(stagedConfigPath)) {
    await mergePortableConfigForRestore({
      localPath: localConfigPath,
      portablePath: stagedConfigPath,
    });
  }
  const stagedSkillStatePath = path.join(input.stagingRoot, 'runtime', 'skills.json');
  if (input.categories.includes('user_skills') && await pathExists(stagedSkillStatePath)) {
    await mergePortableSkillStateForRestore({
      localPath: path.join(input.dataRoot, 'runtime', 'skills.json'),
      localUserSkillsRoot: path.join(input.dataRoot, 'runtime', 'user-skills'),
      portablePath: stagedSkillStatePath,
      portableUserSkillsRoot: path.join(input.stagingRoot, 'runtime', 'user-skills'),
    });
  }
  const mergedSecrets = input.categories.includes('model_credentials')
    ? await mergeRestoredSecretsBuffer(
        path.join(input.dataRoot, 'runtime', 'secrets.json'),
        input.secretsBuffer,
      )
    : undefined;
  const includesProjects = input.categories.includes('conversations') || input.categories.includes('memories');
  if (includesProjects) {
    const projectMerge = await stageMergedProjectIndex({
      dataRoot: input.dataRoot,
      stagingRoot: input.stagingRoot,
      remoteProjects: input.portableProjects ?? [],
    });
    await remapStagedProjectReferences({
      stagingRoot: input.stagingRoot,
      projectIdMap: projectMerge.projectIdMap,
      targetPaths: projectMerge.targetPaths,
      conversations: input.categories.includes('conversations'),
      memories: input.categories.includes('memories'),
    });
  }
  const targets = categoryTargetPaths(input.dataRoot, input.categories);
  const rollbackRoot = path.join(input.dataRoot, `.webdav-sync-rollback-${randomUUID()}`);
  const relativeTargets = targets.map((target) => safeRelativePath(input.dataRoot, target));
  const existingTargets: string[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    if (await pathExists(targets[index]!)) existingTargets.push(relativeTargets[index]!);
  }
  const journal: WebDavRestoreJournal = {
    version: 1,
    phase: 'committing',
    rollbackDirectory: path.basename(rollbackRoot),
    categories: [...input.categories],
    targets: relativeTargets,
    existingTargets,
  };
  const movedToRollback: Array<{ target: string; backup: string }> = [];
  const installedTargets: string[] = [];
  let rollbackComplete = false;
  let journalWritten = false;
  await mkdir(rollbackRoot, { recursive: false, mode: 0o700 });
  try {
    if (mergedSecrets) {
      const stagedSecretsPath = path.join(input.stagingRoot, 'runtime', 'secrets.json');
      await mkdir(path.dirname(stagedSecretsPath), { recursive: true });
      await writeFile(stagedSecretsPath, mergedSecrets, { flag: 'wx', mode: 0o600 });
    }
    await assertNoPendingWebDavRestore(input.dataRoot);
    await writeWebDavRestoreJournal(input.dataRoot, journal);
    journalWritten = true;
    for (const target of targets) {
      const relative = safeRelativePath(input.dataRoot, target);
      if (!await pathExists(target)) continue;
      const backupPath = path.join(rollbackRoot, relative);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await rename(target, backupPath);
      movedToRollback.push({ target, backup: backupPath });
    }

    // Once this phase is durable, every previously existing target must have a
    // rollback copy. Recovery can then distinguish new installs from untouched data.
    await writeWebDavRestoreJournal(input.dataRoot, { ...journal, phase: 'installing' });
    for (const target of targets) {
      if (target.endsWith('-wal') || target.endsWith('-shm')) continue;
      const relative = safeRelativePath(input.dataRoot, target);
      const staged = path.join(input.stagingRoot, relative);
      if (!await pathExists(staged)) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await rename(staged, target);
      installedTargets.push(target);
    }

    await writeWebDavRestoreJournal(input.dataRoot, { ...journal, phase: 'committed' });
  } catch (error) {
    let rollbackError: unknown;
    for (const target of [...installedTargets].reverse()) {
      try {
        await rm(target, { recursive: true, force: true });
      } catch (currentError) {
        rollbackError ??= currentError;
      }
    }
    for (const item of [...movedToRollback].reverse()) {
      try {
        await mkdir(path.dirname(item.target), { recursive: true });
        await rename(item.backup, item.target);
      } catch (currentError) {
        rollbackError ??= currentError;
      }
    }
    rollbackComplete = rollbackError === undefined;
    if (rollbackComplete && journalWritten) {
      await clearWebDavRestoreJournal(input.dataRoot).catch(() => undefined);
    }
    if (rollbackError) {
      throw new Error(`还原提交失败，原数据保留在：${rollbackRoot}`, {
        cause: new AggregateError([error, rollbackError]),
      });
    }
    throw new Error('还原提交失败，Setsuna 已尝试恢复原有本地数据。', { cause: error });
  } finally {
    mergedSecrets?.fill(0);
    // A committed rollback is retained until the relaunched Runtime proves it can
    // open the restored data. Startup then finalizes it, or rolls it back on failure.
    if (rollbackComplete) {
      await rm(rollbackRoot, { recursive: true, force: true }).catch(() => undefined);
      if (journalWritten) await clearWebDavRestoreJournal(input.dataRoot).catch(() => undefined);
    }
  }
}

function categoryDiff(
  category: DesktopWebDavSyncCategoryId,
  backupItems: WebDavSnapshotManifest['items'],
  localItems: LocalSnapshotInventoryItem[],
): DesktopWebDavSyncRestoreCategoryDiff {
  const backupByPath = new Map(backupItems.map((item) => [item.logicalPath, item]));
  const localByPath = new Map(localItems.map((item) => [item.logicalPath, item]));
  const added: DesktopWebDavSyncRestoreDiffItem[] = [];
  const overwritten: DesktopWebDavSyncRestoreDiffItem[] = [];
  const removed: DesktopWebDavSyncRestoreDiffItem[] = [];
  const preserved: DesktopWebDavSyncRestoreDiffItem[] = [];
  for (const backup of backupItems) {
    const local = localByPath.get(backup.logicalPath);
    const item = diffItem(backup);
    if (!local) added.push(item);
    else if (local.sha256 === backup.sha256) preserved.push(item);
    else overwritten.push(item);
  }
  for (const local of localItems) {
    if (backupByPath.has(local.logicalPath)) continue;
    if (category === 'model_credentials') preserved.push(diffItem(local));
    else removed.push(diffItem(local));
  }
  const warnings: string[] = [];
  if ([added, overwritten, removed, preserved].some((items) => items.length > MAX_VISIBLE_DIFF_ITEMS)) {
    warnings.push('条目较多，列表仅展示前 100 项；上方数量为完整统计。');
  }
  return {
    category,
    backupItemCount: backupItems.length,
    localItemCount: localItems.length,
    added: added.slice(0, MAX_VISIBLE_DIFF_ITEMS),
    overwritten: overwritten.slice(0, MAX_VISIBLE_DIFF_ITEMS),
    removed: removed.slice(0, MAX_VISIBLE_DIFF_ITEMS),
    preserved: preserved.slice(0, MAX_VISIBLE_DIFF_ITEMS),
    addedCount: added.length,
    overwrittenCount: overwritten.length,
    removedCount: removed.length,
    preservedCount: preserved.length,
    warnings,
  };
}

function diffItem(item: {
  logicalPath: string;
  label: string;
  detail?: string;
}): DesktopWebDavSyncRestoreDiffItem {
  return {
    id: item.logicalPath,
    label: item.label,
    ...(item.detail ? { detail: item.detail } : {}),
  };
}

function restoreImpactFingerprint(
  manifest: WebDavSnapshotManifest,
  categories: readonly DesktopWebDavSyncCategoryId[],
  localItems: readonly LocalSnapshotInventoryItem[],
  projectFingerprint = '',
): string {
  const selected = new Set(categories);
  const backupByCategoryAndPath = new Map(manifest.items
    .filter((item) => selected.has(item.category) && item.kind !== 'project-catalog')
    .map((item) => [`${item.category}\0${item.logicalPath}`, item]));
  const localByCategoryAndPath = new Map(localItems
    .filter((item) => selected.has(item.category) && item.kind !== 'project-catalog')
    .map((item) => [`${item.category}\0${item.logicalPath}`, item]));
  const impacts: string[] = [];

  for (const [key, backup] of backupByCategoryAndPath) {
    const local = localByCategoryAndPath.get(key);
    if (local && local.sha256 !== backup.sha256) {
      impacts.push(`${backup.category}\0overwrite\0${backup.logicalPath}`);
    }
  }
  for (const local of localItems) {
    if (
      !selected.has(local.category)
      || local.category === 'model_credentials'
      || local.kind === 'project-catalog'
    ) continue;
    const key = `${local.category}\0${local.logicalPath}`;
    if (!backupByCategoryAndPath.has(key)) {
      impacts.push(`${local.category}\0remove\0${local.logicalPath}`);
    }
  }

  // A reviewed path may change bytes while the dialog is open (notably the live
  // conversation database). That is safe when it remains in the same reviewed
  // overwrite/delete set; only a changed impact list requires another review.
  const canonical = `${impacts.sort().join('\n')}\nprojects\0${projectFingerprint}`;
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

async function pathExists(target: string): Promise<boolean> {
  return lstat(target).then(() => true).catch((error) => {
    if (isMissingFileError(error)) return false;
    throw error;
  });
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
