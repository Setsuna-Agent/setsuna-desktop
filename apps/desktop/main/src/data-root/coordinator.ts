import {
  DESKTOP_DATA_MIGRATION_CATEGORY_IDS,
  type DesktopDataMigrationCategoryProgress,
  type DesktopDataMigrationPlan,
  type DesktopDataMigrationProgress,
  type DesktopDataRootActionResult,
  type DesktopDataRootRetainedBackupInspection,
  type DesktopDataRootState,
} from '@setsuna-desktop/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  symlink,
  utimes,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RuntimeHost } from '../runtime/host.js';
import {
  isAtomicJsonTemporaryFileName,
  writeJsonAtomically,
} from './atomic-json.js';
import {
  newPendingDataMigration,
  probeDataRootWritableSync,
  readDataRootMarkerSync,
  removePendingDataMigration,
  samePath,
  writeDataRootMarker,
  writeDataRootPointer,
  writePendingDataMigration,
} from './bootstrap.js';
import {
  DATA_MIGRATION_OWNER_FILE_NAME,
  dataRootBootstrapLayout,
} from './layout.js';
import {
  buildDataMigrationManifest,
  inspectDataMigrationTarget,
  summarizeMigrationCategories,
  summarizeMigrationPlanCategories,
} from './manifest.js';
import {
  buildLegacyDataImportPlan,
  executeLegacyDataImport,
  recoverLegacyDataImportTransaction,
} from './legacy-import.js';
import type {
  DataMigrationManifest,
  DataRootMarker,
  DesktopDataRootBootMode,
  PendingDataMigration,
  RetainedDataRootBackup,
} from './model.js';
import { relocateDataRootContents } from './relocate.js';
import {
  deleteRetainedDataRootBackup,
  dismissRetainedDataRootBackups,
  inspectRetainedDataRootBackup,
  looksLikeSetsunaDataRoot,
  readRetainedDataRootBackups,
  recoverRetainedDataRootDeletions,
  registerRetainedDataRootBackup,
  retainedBackupError,
} from './retained-backups.js';
import { validateCopiedManifest, validateMigratedData } from './validation.js';

type DataRootCoordinatorOptions = {
  appDataRoot: string;
  bootMode: DesktopDataRootBootMode;
  getRuntimeHost: () => RuntimeHost | null;
  requestRelaunch: () => Promise<void>;
};

type CachedPlan = {
  plan: DesktopDataMigrationPlan;
  manifest: DataMigrationManifest;
};

const PROGRESS_EVENT_INTERVAL_MS = 120;

export class DesktopDataRootCoordinator {
  private bootMode: DesktopDataRootBootMode;
  private cachedPlan: CachedPlan | null = null;
  private migrationPromise: Promise<DesktopDataRootActionResult> | null = null;
  private progress: DesktopDataMigrationProgress | null = null;
  private retainedBackups: RetainedDataRootBackup[] = [];
  private backupMutationInProgress = false;
  private readonly listeners = new Set<(state: DesktopDataRootState) => void>();
  private lastProgressEventAt = 0;

  constructor(private readonly options: DataRootCoordinatorOptions) {
    this.bootMode = options.bootMode;
    if (this.bootMode.mode === 'migrating') {
      this.progress = emptyProgress(this.bootMode.pending, 'scanning');
    }
  }

  getState(): DesktopDataRootState {
    if (this.bootMode.mode === 'normal') {
      const { activeRoot, defaultRoot, pointer } = this.bootMode;
      return {
        mode: 'normal',
        activeRoot,
        defaultRoot,
        ...(pointer?.previousDataRoot
          ? { previousRoot: pointer.previousDataRoot }
          : {}),
        isCustom: !samePath(activeRoot, defaultRoot),
        retainedBackups: this.retainedBackups
          .filter((backup) => !samePath(backup.dataRoot, activeRoot))
          .map((backup) => ({
            id: backup.id,
            path: backup.dataRoot,
            createdAt: backup.createdAt,
            promptOnStartup: backup.promptOnStartup,
          })),
      };
    }
    if (this.bootMode.mode === 'recovery') {
      return {
        mode: 'recovery',
        configuredRoot: this.bootMode.pointer.dataRoot,
        defaultRoot: this.bootMode.defaultRoot,
        ...(this.bootMode.pointer.previousDataRoot
          ? { previousRoot: this.bootMode.pointer.previousDataRoot }
          : {}),
        reason: this.bootMode.reason,
        error: {
          code: this.bootMode.reason,
          message: this.bootMode.error,
          ...(this.bootMode.pointer.dataRoot ? { path: this.bootMode.pointer.dataRoot } : {}),
        },
      };
    }
    return {
      mode: 'migrating',
      activeRoot: this.bootMode.activeRoot,
      defaultRoot: this.bootMode.defaultRoot,
      ...(this.bootMode.pointer?.previousDataRoot
        ? { previousRoot: this.bootMode.pointer.previousDataRoot }
        : {}),
      migration: this.progress ?? emptyProgress(this.bootMode.pending, 'scanning'),
    };
  }

  subscribe(listener: (state: DesktopDataRootState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async finalizeStartup(): Promise<void> {
    if (this.bootMode.mode !== 'normal') return;
    try {
      await this.reconcileRetainedBackups();
    } catch {
      // Backup cleanup metadata is advisory and must not make the active data root
      // unusable. Keep any readable records and let Settings surface later errors.
      this.retainedBackups = await readRetainedDataRootBackups(this.options.appDataRoot);
    }
    if (this.bootMode.completedPending) {
      await removePendingDataMigration(this.options.appDataRoot);
      this.bootMode = {
        ...this.bootMode,
        completedPending: undefined,
      };
    }
  }

  inspectRetainedBackup(
    backupId: string,
  ): Promise<DesktopDataRootRetainedBackupInspection> {
    if (this.bootMode.mode !== 'normal') {
      return Promise.resolve({
        id: backupId,
        path: '',
        status: 'unavailable',
        fileCount: 0,
        totalBytes: 0,
        error: {
          code: 'invalid_mode',
          message: 'Old data can only be inspected during normal startup.',
        },
      });
    }
    return inspectRetainedDataRootBackup(
      this.options.appDataRoot,
      backupId,
      this.backupSafetyContext(),
    );
  }

  async deleteRetainedBackup(backupId: string): Promise<DesktopDataRootActionResult> {
    if (this.bootMode.mode !== 'normal') {
      return failure('invalid_mode', 'Old data can only be removed during normal startup.');
    }
    if (this.backupMutationInProgress) {
      return failure('backup_cleanup_busy', 'Another old data operation is still running.');
    }
    this.backupMutationInProgress = true;
    try {
      const backup = this.retainedBackups.find((candidate) => candidate.id === backupId);
      if (!backup) return failure('backup_not_found', 'The old data location is no longer registered.');
      this.retainedBackups = await deleteRetainedDataRootBackup(
        this.options.appDataRoot,
        backupId,
        this.backupSafetyContext(),
      );
      await this.clearPreviousRootIfDeleted(backup.dataRoot).catch(() => undefined);
      this.emitState();
      return { ok: true };
    } catch (error) {
      const issue = retainedBackupError(error, '');
      return failure(issue.code, issue.message, issue.errorPath);
    } finally {
      this.backupMutationInProgress = false;
    }
  }

  async dismissRetainedBackups(
    backupIds: readonly string[],
  ): Promise<DesktopDataRootActionResult> {
    if (this.bootMode.mode !== 'normal') {
      return failure('invalid_mode', 'Old data can only be managed during normal startup.');
    }
    if (this.backupMutationInProgress) {
      return failure('backup_cleanup_busy', 'Another old data operation is still running.');
    }
    const registeredIds = new Set(this.retainedBackups.map((backup) => backup.id));
    const selectedIds = [...new Set(backupIds)].filter((id) => registeredIds.has(id));
    this.backupMutationInProgress = true;
    try {
      this.retainedBackups = await dismissRetainedDataRootBackups(
        this.options.appDataRoot,
        selectedIds,
      );
      this.emitState();
      return { ok: true };
    } catch (error) {
      return failureFromError('backup_dismiss_failed', error);
    } finally {
      this.backupMutationInProgress = false;
    }
  }

  async scanTarget(targetRoot: string): Promise<DesktopDataMigrationPlan> {
    if (this.bootMode.mode !== 'normal') {
      throw new Error('A data location can only be changed during normal startup.');
    }
    const sourceRoot = this.bootMode.activeRoot;
    const target = path.resolve(targetRoot);
    const { manifest, blockers: manifestBlockers } = await buildDataMigrationManifest(sourceRoot);
    const targetInspection = await inspectDataMigrationTarget({
      sourceRoot,
      targetRoot: target,
      totalBytes: manifest.totalBytes,
      reservedRoots: this.reservedRoots(),
    });
    const plan: DesktopDataMigrationPlan = {
      planId: randomUUID(),
      sourceRoot,
      targetRoot: target,
      totalFiles: manifest.entries.length,
      totalBytes: manifest.totalBytes,
      requiredBytes: targetInspection.requiredBytes,
      availableBytes: targetInspection.availableBytes,
      categories: await summarizeMigrationPlanCategories(manifest),
      blockers: [...manifestBlockers, ...targetInspection.blockers],
      warnings: targetInspection.warnings,
      createdAt: new Date().toISOString(),
    };
    this.cachedPlan = { plan, manifest };
    return plan;
  }

  async beginMigration(planId: string): Promise<DesktopDataRootActionResult> {
    if (this.bootMode.mode !== 'normal') return failure('invalid_mode', 'Migration is already in progress.');
    const cached = this.cachedPlan;
    if (!cached || cached.plan.planId !== planId) {
      return failure('stale_plan', 'The migration plan has expired. Scan the target again.');
    }
    if (cached.plan.blockers.length) {
      return failure('blocked_plan', cached.plan.blockers[0].message, cached.plan.blockers[0].path);
    }

    const runtime = this.options.getRuntimeHost();
    if (!runtime) return failure('runtime_unavailable', 'The desktop runtime is unavailable.');
    const readiness = await runtime.prepareDataMigration();
    if (!readiness.ready) {
      return failure(
        'active_turns',
        'Wait for all active and cancelling turns to finish before moving data.',
      );
    }

    let relaunchAttempted = false;
    try {
      const inspection = await inspectDataMigrationTarget({
        sourceRoot: cached.plan.sourceRoot,
        targetRoot: cached.plan.targetRoot,
        totalBytes: cached.plan.totalBytes,
        reservedRoots: this.reservedRoots(),
      });
      if (inspection.blockers.length) {
        await runtime.cancelDataMigrationPreparation();
        const blocker = inspection.blockers[0];
        return failure(blocker.code, blocker.message, blocker.path);
      }
      const sourceMarker = readDataRootMarkerSync(cached.plan.sourceRoot);
      const pending = newPendingDataMigration(
        cached.plan.sourceRoot,
        cached.plan.targetRoot,
        {
          sourceRootId: sourceMarker?.rootId,
          targetDeviceId: inspection.targetDeviceId,
        },
      );
      await writePendingDataMigration(this.options.appDataRoot, pending);
      relaunchAttempted = true;
      await this.options.requestRelaunch();
      return { ok: true };
    } catch (error) {
      await removePendingDataMigration(this.options.appDataRoot).catch(() => undefined);
      await runtime.cancelDataMigrationPreparation().catch(() => undefined);
      // A strict shutdown failure may already have force-stopped the child. Relaunch only
      // after pending is gone so the next process returns to the old pointer, never migration.
      if (relaunchAttempted) {
        await this.options.requestRelaunch().catch(() => undefined);
      }
      return failureFromError('schedule_failed', error);
    }
  }

  runMigration(): Promise<DesktopDataRootActionResult> {
    if (this.migrationPromise) return this.migrationPromise;
    if (this.bootMode.mode !== 'migrating') {
      return Promise.resolve(failure('invalid_mode', 'There is no pending migration.'));
    }
    this.migrationPromise = (
      this.bootMode.pending.kind === 'legacy_import'
        ? this.executeLegacyMigration(this.bootMode.pending)
        : this.executeDataRootMigration(this.bootMode.pending)
    )
      .finally(() => { this.migrationPromise = null; });
    return this.migrationPromise;
  }

  async cancelMigration(): Promise<DesktopDataRootActionResult> {
    if (this.bootMode.mode !== 'migrating') {
      return failure('invalid_mode', 'There is no pending migration.');
    }
    if (this.bootMode.pending.kind === 'legacy_import') {
      return failure(
        'legacy_import_required',
        'Legacy data must be imported or recovered before Setsuna can start normally.',
      );
    }
    if (this.migrationPromise) {
      return failure('migration_running', 'The migration cannot be cancelled while files are being committed.');
    }
    const pending = this.bootMode.pending;
    try {
      await cleanupOwnedStaging(stagingPath(pending), pending.migrationId);
      await writeDataRootPointer(this.options.appDataRoot, {
        version: 1,
        dataRoot: pending.sourceRoot,
        rootId: pending.sourceRootId ?? '',
        ...(this.bootMode.pointer?.previousDataRoot
          ? { previousDataRoot: this.bootMode.pointer.previousDataRoot }
          : {}),
        ...(this.bootMode.pointer?.previousRootId
          ? { previousRootId: this.bootMode.pointer.previousRootId }
          : {}),
        updatedAt: new Date().toISOString(),
      });
      await removePendingDataMigration(this.options.appDataRoot);
      await this.options.requestRelaunch();
      return { ok: true };
    } catch (error) {
      return failureFromError('cleanup_failed', error);
    }
  }

  async retryStartup(): Promise<DesktopDataRootActionResult> {
    if (this.bootMode.mode !== 'recovery') {
      return failure('invalid_mode', 'Storage recovery is not active.');
    }
    const root = this.bootMode.pointer.dataRoot;
    const stats = await lstat(root).catch(() => null);
    const marker = root ? readDataRootMarkerSync(root) : undefined;
    const isDefaultRoot = samePath(root, this.bootMode.defaultRoot);
    if (
      !stats?.isDirectory()
      || stats.isSymbolicLink()
      || (!isDefaultRoot && marker?.rootId !== this.bootMode.pointer.rootId)
    ) {
      return failure('configured_root_unavailable', 'The configured data location is still unavailable.', root);
    }
    const writeError = probeDataRootWritableSync(root);
    if (writeError) {
      return failure(
        'configured_root_unavailable',
        `The configured data location is not writable: ${writeError.message}`,
        root,
      );
    }
    if (this.bootMode.bootstrapIssue) {
      await removePendingDataMigration(this.options.appDataRoot);
    }
    await this.options.requestRelaunch();
    return { ok: true };
  }

  async restorePreviousRoot(): Promise<DesktopDataRootActionResult> {
    if (this.bootMode.mode !== 'recovery') {
      return failure('invalid_mode', 'Storage recovery is not active.');
    }
    const pointer = this.bootMode.pointer;
    const previousRoot = pointer.previousDataRoot || this.bootMode.defaultRoot;
    const stats = await lstat(previousRoot).catch(() => null);
    if (!stats?.isDirectory() || stats.isSymbolicLink()) {
      return failure('previous_root_unavailable', 'The previous data location is unavailable.', previousRoot);
    }
    const previousIsDefault = samePath(previousRoot, this.bootMode.defaultRoot);
    const marker = previousIsDefault ? undefined : readDataRootMarkerSync(previousRoot);
    if (!previousIsDefault && marker?.rootId !== pointer.previousRootId) {
      return failure('previous_root_invalid', 'The previous data location has an invalid ownership marker.', previousRoot);
    }
    const writeError = probeDataRootWritableSync(previousRoot);
    if (writeError) {
      return failure(
        'previous_root_unavailable',
        `The previous data location is not writable: ${writeError.message}`,
        previousRoot,
      );
    }
    await writeDataRootPointer(this.options.appDataRoot, {
      version: 1,
      dataRoot: previousRoot,
      rootId: marker?.rootId ?? '',
      previousDataRoot: pointer.dataRoot || undefined,
      previousRootId: pointer.rootId || undefined,
      updatedAt: new Date().toISOString(),
    });
    if (this.bootMode.bootstrapIssue) {
      await removePendingDataMigration(this.options.appDataRoot);
    }
    await this.options.requestRelaunch();
    return { ok: true };
  }

  private async executeDataRootMigration(
    pending: PendingDataMigration,
  ): Promise<DesktopDataRootActionResult> {
    const stagingRoot = stagingPath(pending);
    try {
      if (await this.finishInterruptedCommit(pending)) return { ok: true };
      await cleanupOwnedStaging(stagingRoot, pending.migrationId);
      this.setProgress(emptyProgress(pending, 'scanning'), true);
      const { manifest, blockers: manifestBlockers } = await buildDataMigrationManifest(pending.sourceRoot);
      const inspection = await inspectDataMigrationTarget({
        sourceRoot: pending.sourceRoot,
        targetRoot: pending.targetRoot,
        totalBytes: manifest.totalBytes,
        reservedRoots: this.reservedRoots(),
        expectedTargetDeviceId: pending.targetDeviceId,
      });
      const blockers = [...manifestBlockers, ...inspection.blockers];
      if (blockers.length) throw new Error(blockers[0].message);

      await mkdir(stagingRoot, { recursive: false });
      await writeMigrationOwner(stagingRoot, pending.migrationId);
      const categories = progressCategories(summarizeMigrationCategories(manifest));
      this.setProgress({
        ...emptyProgress(pending, 'copying'),
        totalFiles: manifest.entries.length,
        totalBytes: manifest.totalBytes,
        categories,
      }, true);
      const sourceHashes = await this.copyManifest(stagingRoot, manifest);

      this.setProgress({ ...this.requireProgress(), phase: 'validating' }, true);
      await validateCopiedManifest(stagingRoot, manifest, sourceHashes);

      this.setProgress({ ...this.requireProgress(), phase: 'merging_memory' }, true);
      await relocateDataRootContents(stagingRoot, pending.sourceRoot, pending.targetRoot);

      this.setProgress({ ...this.requireProgress(), phase: 'validating' }, true);
      await validateMigratedData(pending.sourceRoot, stagingRoot, manifest);

      const rootMarker: DataRootMarker = {
        owner: 'setsuna-desktop',
        version: 1,
        rootId: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      await writeDataRootMarker(stagingRoot, rootMarker);
      await applyDirectoryMetadata(stagingRoot, manifest);
      const committingPending = { ...pending, targetRootId: rootMarker.rootId };
      await writePendingDataMigration(this.options.appDataRoot, committingPending);
      if (this.bootMode.mode === 'migrating') {
        this.bootMode = { ...this.bootMode, pending: committingPending };
      }

      this.setProgress({ ...this.requireProgress(), phase: 'committing' }, true);
      await this.registerMigrationSourceBackup(pending);
      await commitStaging(stagingRoot, pending.targetRoot);
      await rm(path.join(pending.targetRoot, DATA_MIGRATION_OWNER_FILE_NAME), { force: true });
      await writeDataRootPointer(this.options.appDataRoot, {
        version: 1,
        dataRoot: pending.targetRoot,
        rootId: rootMarker.rootId,
        previousDataRoot: pending.sourceRoot,
        ...(pending.sourceRootId ? { previousRootId: pending.sourceRootId } : {}),
        updatedAt: new Date().toISOString(),
      });
      await removePendingDataMigration(this.options.appDataRoot);
      this.setProgress({ ...this.requireProgress(), phase: 'restarting' }, true);
      await this.options.requestRelaunch();
      return { ok: true };
    } catch (error) {
      return this.failMigration(pending, error);
    }
  }

  private async executeLegacyMigration(
    initialPending: PendingDataMigration,
  ): Promise<DesktopDataRootActionResult> {
    let pending = initialPending;
    try {
      pending = await recoverLegacyDataImportTransaction(pending, this.options.appDataRoot);
      this.replacePending(pending);
      this.setProgress(emptyProgress(pending, 'scanning'), true);
      const plan = await buildLegacyDataImportPlan(pending);
      if (plan.blockers.length) throw new Error(plan.blockers[0].message);
      const startedAt = Date.now();
      this.setProgress({
        ...emptyProgress(pending, 'copying'),
        totalFiles: plan.totalFiles,
        totalBytes: plan.totalBytes,
        categories: progressCategories(plan.categories),
      }, true);
      pending = await executeLegacyDataImport(
        plan,
        pending,
        this.options.appDataRoot,
        {
          onPhase: (phase) => {
            this.setProgress({ ...this.requireProgress(), phase }, true);
          },
          onCopyProgress: (category, relativePath, bytes, completed) => {
            this.updateCopyProgress(category, relativePath, bytes, startedAt, completed);
          },
          onPendingChange: (updated) => this.replacePending(updated),
        },
      );
      this.replacePending(pending);
      await removePendingDataMigration(this.options.appDataRoot);
      this.setProgress({ ...this.requireProgress(), phase: 'restarting' }, true);
      await this.options.requestRelaunch();
      return { ok: true };
    } catch (error) {
      return this.failMigration(pending, error);
    }
  }

  private async finishInterruptedCommit(
    pending: PendingDataMigration,
  ): Promise<boolean> {
    if (!pending.targetRootId) return false;
    const marker = readDataRootMarkerSync(pending.targetRoot);
    if (marker?.rootId !== pending.targetRootId) return false;
    await this.registerMigrationSourceBackup(pending);
    await rm(path.join(pending.targetRoot, DATA_MIGRATION_OWNER_FILE_NAME), { force: true });
    await writeDataRootPointer(this.options.appDataRoot, {
      version: 1,
      dataRoot: pending.targetRoot,
      rootId: pending.targetRootId,
      previousDataRoot: pending.sourceRoot,
      ...(pending.sourceRootId ? { previousRootId: pending.sourceRootId } : {}),
      updatedAt: new Date().toISOString(),
    });
    await removePendingDataMigration(this.options.appDataRoot);
    this.setProgress({
      ...(this.progress ?? emptyProgress(pending, 'restarting')),
      phase: 'restarting',
    }, true);
    await this.options.requestRelaunch();
    return true;
  }

  private async copyManifest(
    stagingRoot: string,
    manifest: DataMigrationManifest,
  ): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    const startedAt = Date.now();
    for (const directory of manifest.directories) {
      await mkdir(path.join(stagingRoot, directory.relativePath), { recursive: true });
    }
    for (const entry of manifest.entries) {
      const targetPath = path.join(stagingRoot, entry.relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      this.updateCopyProgress(entry.category, entry.relativePath, 0, startedAt, false);
      if (entry.kind === 'symlink') {
        await symlink(entry.linkTarget!, targetPath);
      } else {
        const hash = await copyFileWithProgress(
          entry.absolutePath,
          targetPath,
          entry.mode,
          (bytes) => this.updateCopyProgress(
            entry.category,
            entry.relativePath,
            bytes,
            startedAt,
            false,
          ),
        );
        hashes.set(entry.relativePath, hash);
        await chmod(targetPath, entry.mode).catch(() => undefined);
        const modified = new Date(entry.mtimeMs);
        await utimes(targetPath, modified, modified).catch(() => undefined);
      }
      this.updateCopyProgress(entry.category, entry.relativePath, 0, startedAt, true);
    }
    return hashes;
  }

  private updateCopyProgress(
    categoryId: DesktopDataMigrationCategoryProgress['id'],
    relativePath: string,
    byteDelta: number,
    startedAt: number,
    fileCompleted: boolean,
  ): void {
    const progress = this.requireProgress();
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const completedBytes = progress.completedBytes + byteDelta;
    const categories = progress.categories.map((category) => {
      if (category.id !== categoryId) return category;
      const completedFiles = category.completedFiles + (fileCompleted ? 1 : 0);
      return {
        ...category,
        completedBytes: category.completedBytes + byteDelta,
        completedFiles,
        status: completedFiles >= category.fileCount ? 'completed' as const : 'running' as const,
      };
    });
    const bytesPerSecond = completedBytes / elapsedSeconds;
    this.setProgress({
      ...progress,
      completedBytes,
      completedFiles: progress.completedFiles + (fileCompleted ? 1 : 0),
      bytesPerSecond,
      etaSeconds: bytesPerSecond > 0
        ? Math.max(0, (progress.totalBytes - completedBytes) / bytesPerSecond)
        : undefined,
      currentCategory: categoryId,
      currentRelativePath: relativePath,
      categories,
    });
  }

  private requireProgress(): DesktopDataMigrationProgress {
    if (!this.progress) throw new Error('Migration progress is unavailable.');
    return this.progress;
  }

  private replacePending(pending: PendingDataMigration): void {
    if (this.bootMode.mode === 'migrating') {
      this.bootMode = { ...this.bootMode, pending };
    }
  }

  private failMigration(
    pending: PendingDataMigration,
    error: unknown,
  ): DesktopDataRootActionResult {
    const failed = {
      ...(this.progress ?? emptyProgress(pending, 'failed')),
      phase: 'failed' as const,
      error: errorValue('migration_failed', error),
    };
    const currentCategory = failed.currentCategory;
    failed.categories = failed.categories.map((category) => (
      category.id === currentCategory ? { ...category, status: 'failed' as const } : category
    ));
    this.setProgress(failed, true);
    return { ok: false, error: failed.error };
  }

  private reservedRoots(): string[] {
    return [
      dataRootBootstrapLayout(this.options.appDataRoot).root,
      path.join(os.tmpdir(), 'setsuna-desktop-maintenance'),
    ];
  }

  private backupSafetyContext() {
    if (this.bootMode.mode !== 'normal') {
      throw new Error('Backup safety context requires normal startup.');
    }
    return {
      activeRoot: this.bootMode.activeRoot,
      reservedRoots: this.reservedRoots(),
    };
  }

  private async registerMigrationSourceBackup(
    pending: PendingDataMigration,
  ): Promise<void> {
    await registerRetainedDataRootBackup(this.options.appDataRoot, {
      id: pending.migrationId,
      dataRoot: pending.sourceRoot,
      ...(pending.sourceRootId ? { rootId: pending.sourceRootId } : {}),
      createdAt: pending.createdAt,
      promptOnStartup: true,
      refreshIdentity: true,
    });
  }

  private async reconcileRetainedBackups(): Promise<void> {
    if (this.bootMode.mode !== 'normal') return;
    const context = this.backupSafetyContext();
    await recoverRetainedDataRootDeletions(this.options.appDataRoot, context);
    const pointer = this.bootMode.pointer;
    if (
      pointer?.previousDataRoot
      && !samePath(pointer.previousDataRoot, this.bootMode.activeRoot)
    ) {
      await this.registerDiscoveredBackup(
        pointer.previousDataRoot,
        pointer.previousRootId,
      );
    }
    if (
      !samePath(this.bootMode.defaultRoot, this.bootMode.activeRoot)
      && await looksLikeSetsunaDataRoot(this.bootMode.defaultRoot)
    ) {
      await this.registerDiscoveredBackup(this.bootMode.defaultRoot);
    }
    this.retainedBackups = await readRetainedDataRootBackups(this.options.appDataRoot);
    const previousRoot = this.bootMode.pointer?.previousDataRoot;
    if (
      previousRoot
      && !this.retainedBackups.some((backup) => samePath(backup.dataRoot, previousRoot))
      && !await lstat(previousRoot).catch(() => null)
    ) {
      await this.clearPreviousRootIfDeleted(previousRoot);
    }
  }

  private async registerDiscoveredBackup(
    dataRoot: string,
    rootId?: string,
  ): Promise<void> {
    try {
      await registerRetainedDataRootBackup(this.options.appDataRoot, {
        dataRoot,
        ...(rootId ? { rootId } : {}),
        promptOnStartup: true,
        refreshIdentity: false,
      });
    } catch {
      // An unavailable or identity-mismatched legacy path is not safe to adopt
      // into the cleanup registry. Existing valid records remain untouched.
    }
  }

  private async clearPreviousRootIfDeleted(deletedRoot: string): Promise<void> {
    if (
      this.bootMode.mode !== 'normal'
      || !this.bootMode.pointer?.previousDataRoot
      || !samePath(this.bootMode.pointer.previousDataRoot, deletedRoot)
    ) {
      return;
    }
    const { previousDataRoot: _previousDataRoot, previousRootId: _previousRootId, ...pointer } =
      this.bootMode.pointer;
    const nextPointer = {
      ...pointer,
      updatedAt: new Date().toISOString(),
    };
    await writeDataRootPointer(this.options.appDataRoot, nextPointer);
    this.bootMode = { ...this.bootMode, pointer: nextPointer };
  }

  private emitState(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  private setProgress(progress: DesktopDataMigrationProgress, force = false): void {
    this.progress = progress;
    const now = Date.now();
    if (!force && now - this.lastProgressEventAt < PROGRESS_EVENT_INTERVAL_MS) return;
    this.lastProgressEventAt = now;
    this.emitState();
  }
}

async function copyFileWithProgress(
  source: string,
  target: string,
  mode: number,
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
    createWriteStream(target, { flags: 'wx', mode }),
  );
  return hash.digest('hex');
}

function emptyProgress(
  pending: PendingDataMigration,
  phase: DesktopDataMigrationProgress['phase'],
): DesktopDataMigrationProgress {
  return {
    operation: pending.kind === 'legacy_import' ? 'legacy_import' : 'relocate',
    phase,
    sourceRoot: pending.sourceRoot,
    targetRoot: pending.targetRoot,
    totalFiles: 0,
    completedFiles: 0,
    totalBytes: 0,
    completedBytes: 0,
    categories: DESKTOP_DATA_MIGRATION_CATEGORY_IDS.map((id) => ({
      id,
      fileCount: 0,
      totalBytes: 0,
      completedFiles: 0,
      completedBytes: 0,
      status: 'pending',
    })),
  };
}

function progressCategories(
  summaries: DesktopDataMigrationPlan['categories'],
): DesktopDataMigrationCategoryProgress[] {
  return summaries.map((summary) => ({
    ...summary,
    completedFiles: 0,
    completedBytes: 0,
    status: summary.fileCount ? 'pending' : 'skipped',
  }));
}

function stagingPath(pending: PendingDataMigration): string {
  const target = path.resolve(pending.targetRoot);
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.setsuna-staging-${pending.migrationId}`,
  );
}

async function writeMigrationOwner(root: string, migrationId: string): Promise<void> {
  await writeJsonAtomically(path.join(root, DATA_MIGRATION_OWNER_FILE_NAME), {
    owner: 'setsuna-desktop',
    migrationId,
    version: 1,
  });
}

async function cleanupOwnedStaging(root: string, migrationId: string): Promise<void> {
  const stats = await lstat(root).catch(() => null);
  if (!stats) return;
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Migration staging path is not a regular directory: ${root}`);
  }
  const ownerPath = path.join(root, DATA_MIGRATION_OWNER_FILE_NAME);
  const ownerText = await readFile(ownerPath, 'utf8').catch(() => null);
  let owner: { owner?: string; migrationId?: string } | null = null;
  let malformedOwner = false;
  if (ownerText !== null) {
    try {
      const value = JSON.parse(ownerText) as unknown;
      owner = value && typeof value === 'object' && !Array.isArray(value)
        ? value as { owner?: string; migrationId?: string }
        : {};
    } catch {
      malformedOwner = true;
    }
  }
  if (owner && (owner.owner !== 'setsuna-desktop' || owner.migrationId !== migrationId)) {
    throw new Error(`Refusing to remove unowned migration staging path: ${root}`);
  }
  if (!owner) {
    const entries = await readdir(root);
    const recoverable = entries.every((entry) => (
      isAtomicJsonTemporaryFileName(entry, DATA_MIGRATION_OWNER_FILE_NAME)
      || (malformedOwner && entry === DATA_MIGRATION_OWNER_FILE_NAME)
    ));
    if (!recoverable) {
      throw new Error(`Refusing to remove unowned migration staging path: ${root}`);
    }
  }
  await rm(root, { recursive: true, force: true });
}

async function commitStaging(stagingRoot: string, targetRoot: string): Promise<void> {
  const targetStats = await lstat(targetRoot).catch(() => null);
  if (targetStats) {
    if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
      throw new Error(`Migration target is not a regular directory: ${targetRoot}`);
    }
    if ((await readdir(targetRoot)).length) {
      throw new Error('Migration target became non-empty before commit.');
    }
    await rmdir(targetRoot);
  }
  await rename(stagingRoot, targetRoot);
}

async function applyDirectoryMetadata(
  stagingRoot: string,
  manifest: DataMigrationManifest,
): Promise<void> {
  const deepestFirst = [...manifest.directories].sort((left, right) => (
    right.relativePath.split(path.sep).length - left.relativePath.split(path.sep).length
  ));
  for (const directory of deepestFirst) {
    const target = path.join(stagingRoot, directory.relativePath);
    await chmod(target, directory.mode);
    const modified = new Date(directory.mtimeMs);
    await utimes(target, modified, modified).catch(() => undefined);
  }
  await chmod(stagingRoot, manifest.rootMode);
}

function failure(code: string, message: string, errorPath?: string): DesktopDataRootActionResult {
  return { ok: false, error: { code, message, ...(errorPath ? { path: errorPath } : {}) } };
}

function failureFromError(code: string, error: unknown): DesktopDataRootActionResult {
  return { ok: false, error: errorValue(code, error) };
}

function errorValue(code: string, error: unknown) {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}
