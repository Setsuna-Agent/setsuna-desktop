import {
  DESKTOP_WEBDAV_SYNC_CATEGORY_IDS,
  type DesktopWebDavSyncBackupResult,
  type DesktopWebDavSyncCategorySummary,
  type DesktopWebDavSyncConfigureInput,
  type DesktopWebDavSyncConfigureResult,
  type DesktopWebDavSyncOperationKind,
  type DesktopWebDavSyncOperationPhase,
  type DesktopWebDavSyncOperationState,
  type DesktopWebDavSyncPreferencesInput,
  type DesktopWebDavSyncRestorePlan,
  type DesktopWebDavSyncRestorePlanInput,
  type DesktopWebDavSyncRestoreResult,
  type DesktopWebDavSyncSnapshotList,
  type DesktopWebDavSyncState,
  type RuntimeDataMigrationReadiness,
} from '@setsuna-desktop/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  generateWebDavRecoveryKey,
  normalizeWebDavRecoveryKey,
} from './crypto.js';
import { WebDavSyncConfigStore, normalizeCategories } from './config-store.js';
import type {
  LocalSnapshotSource,
  ResolvedWebDavSyncConnection,
  StoredWebDavSyncConfig,
} from './model.js';
import {
  normalizeWebDavLocation,
  normalizeWebDavPassword,
  normalizeWebDavUsername,
} from './normalization.js';
import { EncryptedWebDavRepository } from './repository.js';
import { readLocalProjects } from './portable-projects.js';
import { summarizeLocalSnapshotCategories } from './snapshot-data.js';
import {
  applyRestoredSnapshot,
  assertRestorePlanCurrent,
  buildWebDavRestorePlan,
  type StoredWebDavRestorePlan,
} from './restore.js';
import {
  finalizeCommittedWebDavRestore,
  rollbackCommittedWebDavRestore,
} from './restore-journal.js';
import {
  createAndUploadSnapshot,
  createLocalInventory,
  downloadSnapshotForRestore,
  downloadSnapshotProjectCatalog,
  materializeSnapshotForUpload,
  type WebDavTransferProgress,
} from './transfer.js';
import { WebDavClient } from './webdav-client.js';

const AUTOMATIC_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const INITIAL_AUTOMATIC_BACKUP_DELAY_MS = 5 * 60 * 1_000;
const BUSY_AUTOMATIC_RETRY_MS = 15 * 60 * 1_000;
const MANUAL_IDLE_WAIT_MS = 30_000;
const IDLE_RETRY_MS = 500;
const RUNTIME_RELEASE_RETRY_DELAYS_MS = [50, 150] as const;
const MAX_RESTORE_PLANS = 5;

export type WebDavSyncRuntimeCoordinator = {
  prepare(): Promise<RuntimeDataMigrationReadiness>;
  release(): Promise<void>;
  stop(): Promise<void>;
  start(): Promise<void>;
};

type WebDavSyncServiceOptions = {
  dataRoot: string;
  appVersion: string;
  configStore: WebDavSyncConfigStore;
  fetch: typeof globalThis.fetch;
  runtime: WebDavSyncRuntimeCoordinator;
  requestRelaunch(): Promise<void>;
  now?: () => Date;
};

export class WebDavSyncService {
  private readonly subscribers = new Set<(state: DesktopWebDavSyncState) => void>();
  private readonly restorePlans = new Map<string, StoredWebDavRestorePlan>();
  private readonly now: () => Date;
  private lastPublishedState: DesktopWebDavSyncState | null = null;
  private operation: DesktopWebDavSyncOperationState | undefined;
  private operationAbort: AbortController | null = null;
  private automaticTimer: ReturnType<typeof setTimeout> | null = null;
  private nextAutomaticBackupAt: string | undefined;
  private lastError: string | undefined;
  private configurationMutation = false;
  private closed = false;

  constructor(private readonly options: WebDavSyncServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    // Cleanup must not depend on a readable config: a damaged metadata file
    // must never leave plaintext staging data behind across restarts.
    await rm(this.workBaseRoot(), { recursive: true, force: true }).catch(() => undefined);
    await this.options.configStore.initialize();
    await this.scheduleAutomaticBackup();
  }

  async getState(): Promise<DesktopWebDavSyncState> {
    const config = await this.options.configStore.getConfig();
    return this.stateFromConfig(config);
  }

  async revealRecoveryKey(): Promise<string> {
    this.assertIdle();
    return (await this.requireConnection()).recoveryKey;
  }

  async resetLocalConfiguration(): Promise<DesktopWebDavSyncState> {
    return this.mutateConfiguration(async () => {
      await this.options.configStore.resetDamagedConfig();
      this.restorePlans.clear();
      this.lastError = undefined;
    });
  }

  async getLocalCategorySummaries(): Promise<DesktopWebDavSyncCategorySummary[]> {
    const workRoot = await this.createWorkRoot('summary');
    try {
      return await summarizeLocalSnapshotCategories({
        dataRoot: this.options.dataRoot,
        categories: DESKTOP_WEBDAV_SYNC_CATEGORY_IDS,
        stagingRoot: path.join(workRoot, 'local-snapshot'),
      });
    } finally {
      await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  subscribe(listener: (state: DesktopWebDavSyncState) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async configure(input: DesktopWebDavSyncConfigureInput): Promise<DesktopWebDavSyncConfigureResult> {
    const createdRecoveryKey = await this.runOperation('configure', 'connecting', true, async (signal) => {
      const location = normalizeWebDavLocation(input);
      const username = normalizeWebDavUsername(input.username);
      const existing = input.password === undefined
        ? await this.options.configStore.resolveConnection()
        : null;
      const password = input.password === undefined
        ? existing?.password
        : normalizeWebDavPassword(input.password);
      if (!password) throw new Error('请输入 WebDAV 密码。');
      const client = new WebDavClient(location, { username, password }, this.options.fetch);
      let recoveryKey: string;
      let repository: EncryptedWebDavRepository;
      if (input.repositoryMode === 'create') {
        recoveryKey = generateWebDavRecoveryKey();
        repository = await EncryptedWebDavRepository.create(client, recoveryKey, signal);
      } else {
        if (!input.recoveryKey) throw new Error('连接现有仓库时必须填写恢复密钥。');
        recoveryKey = normalizeWebDavRecoveryKey(input.recoveryKey);
        repository = await EncryptedWebDavRepository.connect(client, recoveryKey, signal);
        await repository.testWriteAccess(signal);
      }
      try {
        await this.options.configStore.saveConnection({
          endpoint: location.endpoint,
          remoteRoot: location.remoteRoot,
          username,
          allowInsecureHttp: input.allowInsecureHttp === true,
          repositoryId: repository.metadata.repositoryId,
          recoveryKey,
          ...(input.password !== undefined ? { password } : {}),
          ...(input.deviceName ? { deviceName: input.deviceName } : {}),
        });
      } catch (error) {
        if (input.repositoryMode === 'create') {
          try {
            // The recovery key has not reached the user yet. Remove only the
            // metadata created by this attempt so create mode remains retryable.
            await repository.rollbackCreation();
          } catch (rollbackError) {
            throw new Error('本机配置保存失败，且无法回滚刚创建的远端仓库。', {
              cause: new AggregateError([error, rollbackError]),
            });
          }
        }
        throw error;
      }
      this.restorePlans.clear();
      this.lastError = undefined;
      await this.scheduleAutomaticBackup();
      return input.repositoryMode === 'create' ? recoveryKey : undefined;
    });
    // runOperation publishes its final idle state before resolving. Reading
    // state here prevents the invoke result from carrying a stale busy flag.
    return {
      state: await this.getState(),
      ...(createdRecoveryKey ? { recoveryKey: createdRecoveryKey } : {}),
    };
  }

  async updatePreferences(input: DesktopWebDavSyncPreferencesInput): Promise<DesktopWebDavSyncState> {
    return this.mutateConfiguration(async () => {
      await this.options.configStore.updatePreferences(input);
    });
  }

  async testConnection(
    input?: DesktopWebDavSyncConfigureInput,
  ): Promise<DesktopWebDavSyncState> {
    await this.runOperation('test', 'connecting', true, async (signal) => {
      if (input) {
        const location = normalizeWebDavLocation(input);
        const username = normalizeWebDavUsername(input.username);
        if (input.password === undefined) throw new Error('请输入 WebDAV 密码。');
        const password = normalizeWebDavPassword(input.password);
        const client = new WebDavClient(location, { username, password }, this.options.fetch);
        if (input.repositoryMode === 'connect') {
          if (!input.recoveryKey) throw new Error('连接现有仓库时必须填写恢复密钥。');
          const repository = await EncryptedWebDavRepository.connect(
            client,
            normalizeWebDavRecoveryKey(input.recoveryKey),
            signal,
          );
          await repository.testWriteAccess(signal);
        } else {
          await client.testReadWrite(signal);
        }
      } else {
        const repository = await this.connectedRepository(signal);
        await repository.testWriteAccess(signal);
      }
      this.lastError = undefined;
    });
    return this.getState();
  }

  backupNow(): Promise<DesktopWebDavSyncBackupResult> {
    return this.performBackup(false);
  }

  async listSnapshots(): Promise<DesktopWebDavSyncSnapshotList> {
    return this.runOperation('list', 'listing', true, async (signal) => {
      const repository = await this.connectedRepository(signal);
      const records = await repository.listSnapshots(signal);
      // Older repositories may still contain historical snapshots. The rolling
      // backup product exposes only the newest complete backup and removes the
      // rest on the next successful upload.
      return { snapshots: records.slice(0, 1).map((record) => record.summary) };
    });
  }

  async inspectRestore(input: DesktopWebDavSyncRestorePlanInput): Promise<DesktopWebDavSyncRestorePlan> {
    return this.runOperation('restore-plan', 'listing', true, async (signal) => {
      const categories = normalizeCategories(input.categories);
      const repository = await this.connectedRepository(signal);
      const snapshot = await repository.findSnapshot(String(input.snapshotId ?? ''), signal);
      const workRoot = await this.createWorkRoot('inspect');
      let runtimePrepared = false;
      try {
        runtimePrepared = await this.prepareRuntime(false, signal);
        const localItems = await createLocalInventory({
          dataRoot: this.options.dataRoot,
          categories,
          workRoot,
          signal,
          onProgress: (progress) => this.applyTransferProgress(progress),
        });
        const includesProjects = categories.includes('conversations') || categories.includes('memories');
        const [portableProjects, localProjects] = includesProjects
          ? await Promise.all([
              downloadSnapshotProjectCatalog({
                repository,
                manifest: snapshot.manifest,
                workRoot,
                signal,
              }),
              readLocalProjects(this.options.dataRoot),
            ])
          : [[], []];
        const plan = buildWebDavRestorePlan({
          snapshot,
          categories,
          localItems,
          portableProjects,
          localProjects,
          now: this.now(),
        });
        this.rememberRestorePlan(plan);
        return plan.publicPlan;
      } finally {
        try {
          if (runtimePrepared) await this.releaseRuntimeGate();
        } finally {
          await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    });
  }

  async restore(planId: string): Promise<DesktopWebDavSyncRestoreResult> {
    const plan = this.restorePlans.get(String(planId ?? '').trim());
    if (!plan) throw new Error('还原清单不存在或已失效，请重新检查。');
    return this.runOperation('restore', 'connecting', true, async (signal) => {
      const connection = await this.requireConnection();
      const repository = await this.repositoryFor(connection, signal);
      const remote = await repository.findSnapshot(plan.manifest.id, signal);
      if (snapshotFingerprint(remote.manifest) !== snapshotFingerprint(plan.manifest)) {
        throw new Error('远端快照在检查后发生了变化，请重新生成还原清单。');
      }
      const workRoot = await this.createWorkRoot('restore');
      const stagingRoot = path.join(workRoot, 'restored-data');
      let runtimePrepared = false;
      let runtimeStopped = false;
      let restoreCommitted = false;
      let secretsBuffer: Buffer | undefined;
      try {
        const downloaded = await downloadSnapshotForRestore({
          repository,
          recoveryKey: connection.recoveryKey,
          manifest: remote.manifest,
          categories: plan.publicPlan.categories,
          stagingRoot,
          workRoot,
          signal,
          onProgress: (progress) => this.applyTransferProgress(progress),
        });
        secretsBuffer = downloaded.secretsBuffer;
        runtimePrepared = await this.prepareRuntime(false, signal);
        this.updateOperation('preparing-restore', { cancellable: false });
        // Stopping the runtime before the final inventory closes every local
        // mutation path, so the confirmed overwrite plan cannot race a config
        // or attachment write that the quiescence gate does not own.
        await this.options.runtime.stop();
        runtimeStopped = true;
        runtimePrepared = false;
        const localItems = await createLocalInventory({
          dataRoot: this.options.dataRoot,
          categories: plan.publicPlan.categories,
          workRoot: path.join(workRoot, 'current'),
          signal,
          onProgress: (progress) => this.applyTransferProgress(progress),
        });
        const localProjects = plan.portableProjects.length
          ? await readLocalProjects(this.options.dataRoot)
          : [];
        assertRestorePlanCurrent(plan, localItems, this.now(), localProjects);
        this.updateOperation('restoring', { cancellable: false });
        await applyRestoredSnapshot({
          dataRoot: this.options.dataRoot,
          stagingRoot,
          sourceDataRoot: remote.manifest.sourceDataRoot,
          categories: plan.publicPlan.categories,
          portableProjects: downloaded.portableProjects,
          ...(secretsBuffer ? { secretsBuffer } : {}),
        });
        restoreCommitted = true;
        this.restorePlans.clear();
        await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
        await this.options.requestRelaunch();
        return { ok: true, relaunching: true };
      } catch (error) {
        if (runtimeStopped) {
          try {
            await this.options.runtime.start();
            if (restoreCommitted) {
              await finalizeCommittedWebDavRestore(this.options.dataRoot);
            }
          } catch (restartError) {
            if (restoreCommitted) {
              try {
                await rollbackCommittedWebDavRestore(this.options.dataRoot);
                await this.options.runtime.start();
              } catch (rollbackError) {
                throw new Error('还原后的 Runtime 无法启动，且原本地数据回滚失败。', {
                  cause: new AggregateError([error, restartError, rollbackError]),
                });
              }
              throw new Error('还原后的 Runtime 无法启动，Setsuna 已恢复原有本地数据。', {
                cause: new AggregateError([error, restartError]),
              });
            }
            throw new Error('还原失败，且本地 Runtime 无法重新启动。', {
              cause: new AggregateError([error, restartError]),
            });
          }
        }
        throw error;
      } finally {
        secretsBuffer?.fill(0);
        try {
          if (runtimePrepared) await this.releaseRuntimeGate();
        } finally {
          await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    });
  }

  async cancelCurrentOperation(): Promise<DesktopWebDavSyncState> {
    if (this.operation?.cancellable) {
      this.operationAbort?.abort(new Error('同步操作已取消。'));
    }
    return this.getState();
  }

  async disconnect(): Promise<DesktopWebDavSyncState> {
    return this.mutateConfiguration(async () => {
      await this.options.configStore.disconnect();
      this.restorePlans.clear();
      this.lastError = undefined;
    });
  }

  close(): void {
    this.closed = true;
    this.clearAutomaticTimer();
    if (this.operation?.cancellable) this.operationAbort?.abort(new Error('应用正在退出。'));
  }

  private async performBackup(automatic: boolean): Promise<DesktopWebDavSyncBackupResult> {
    let succeeded = false;
    let operationStarted = false;
    let snapshot: DesktopWebDavSyncBackupResult['snapshot'];
    try {
      snapshot = await this.runOperation('backup', 'connecting', true, async (signal) => {
        operationStarted = true;
        const config = await this.options.configStore.getConfig();
        const connection = await this.requireConnection();
        const repository = await this.repositoryFor(connection, signal);
        const workRoot = await this.createWorkRoot('backup');
        let sources: LocalSnapshotSource[] | undefined;
        try {
          const replaceableSnapshots = await repository.listSnapshots(signal);
          await this.prepareRuntime(automatic, signal);
          try {
            sources = await materializeSnapshotForUpload({
              dataRoot: this.options.dataRoot,
              categories: config.categories,
              workRoot,
              signal,
              onProgress: (progress) => this.applyTransferProgress(progress),
            });
          } finally {
            // The network phase only reads this immutable staging copy, so new
            // turns can resume without changing the backup being uploaded.
            await this.releaseRuntimeGate();
          }
          const published = await createAndUploadSnapshot({
            repository,
            recoveryKey: connection.recoveryKey,
            sourceDataRoot: this.options.dataRoot,
            categories: config.categories,
            sources,
            deviceId: config.deviceId,
            deviceName: config.deviceName,
            appVersion: this.options.appVersion,
            workRoot,
            signal,
            onProgress: (progress) => this.applyTransferProgress(progress),
          });
          this.updateOperation('publishing', { cancellable: true });
          this.updateOperation('pruning', { cancellable: true });
          const retained = await repository.retainPublishedSnapshot(
            published.manifest.deviceId,
            published.manifest.id,
            replaceableSnapshots,
            signal,
          );
          await this.options.configStore.markBackup(
            retained.manifest.id,
            retained.manifest.createdAt,
          );
          this.lastError = undefined;
          return retained.summary;
        } finally {
          for (const source of sources ?? []) source.data?.fill(0);
          await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
        }
      });
      succeeded = true;
    } finally {
      if (operationStarted) {
        await this.scheduleAutomaticBackup(automatic && !succeeded ? BUSY_AUTOMATIC_RETRY_MS : undefined);
      }
    }
    return { state: await this.getState(), snapshot };
  }

  private async connectedRepository(signal?: AbortSignal): Promise<EncryptedWebDavRepository> {
    return this.repositoryFor(await this.requireConnection(), signal);
  }

  private async requireConnection(): Promise<ResolvedWebDavSyncConnection> {
    const connection = await this.options.configStore.resolveConnection();
    if (!connection) throw new Error('请先配置 WebDAV 同步服务器。');
    return connection;
  }

  private async repositoryFor(
    connection: ResolvedWebDavSyncConnection,
    signal?: AbortSignal,
  ): Promise<EncryptedWebDavRepository> {
    this.updateOperation('connecting');
    const location = normalizeWebDavLocation(connection);
    const client = new WebDavClient(
      location,
      { username: connection.username, password: connection.password },
      this.options.fetch,
    );
    const repository = await EncryptedWebDavRepository.connect(client, connection.recoveryKey, signal);
    if (repository.metadata.repositoryId !== connection.repositoryId) {
      throw new Error('远端 WebDAV 仓库与本地连接记录不匹配。');
    }
    return repository;
  }

  private async prepareRuntime(automatic: boolean, signal?: AbortSignal): Promise<boolean> {
    this.updateOperation('waiting-for-idle', { cancellable: true });
    const deadline = this.now().getTime() + (automatic ? 0 : MANUAL_IDLE_WAIT_MS);
    for (;;) {
      throwIfAborted(signal);
      const readiness = await this.options.runtime.prepare();
      if (readiness.ready) return true;
      if (this.now().getTime() >= deadline) {
        throw new Error(automatic
          ? '有任务正在运行，自动同步稍后重试。'
          : '等待本地任务结束超时，请完成或取消正在运行的任务后重试。');
      }
      await delay(IDLE_RETRY_MS, undefined, signal ? { signal } : undefined);
    }
  }

  private async releaseRuntimeGate(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= RUNTIME_RELEASE_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await this.options.runtime.release();
        return;
      } catch (error) {
        lastError = error;
        const retryDelay = RUNTIME_RELEASE_RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined) break;
        await delay(retryDelay);
      }
    }
    throw new Error('无法解除本地 Runtime 的数据一致性锁，请重启 Setsuna 后重试。', {
      cause: lastError,
    });
  }

  private async runOperation<T>(
    kind: DesktopWebDavSyncOperationKind,
    phase: DesktopWebDavSyncOperationPhase,
    cancellable: boolean,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.assertIdle();
    const abort = new AbortController();
    this.operationAbort = abort;
    this.operation = {
      kind,
      phase,
      startedAt: this.now().toISOString(),
      cancellable,
    };
    await this.publishState();
    try {
      const result = await action(abort.signal);
      this.lastError = undefined;
      return result;
    } catch (error) {
      this.lastError = safeErrorMessage(error);
      throw new Error(this.lastError, { cause: error });
    } finally {
      if (this.operationAbort === abort) {
        this.operationAbort = null;
        this.operation = undefined;
      }
      await this.publishState();
    }
  }

  private updateOperation(
    phase: DesktopWebDavSyncOperationPhase,
    patch: Partial<Pick<
      DesktopWebDavSyncOperationState,
      'cancellable' | 'completedBytes' | 'totalBytes' | 'completedItems' | 'totalItems'
    >> = {},
  ): void {
    if (!this.operation) return;
    this.operation = { ...this.operation, phase, ...patch };
    if (this.lastPublishedState) {
      // Progress updates arrive faster than an async config read can complete.
      // Reuse the last base state so each sampled value reaches the renderer in order.
      this.emitState({
        ...this.lastPublishedState,
        operation: { ...this.operation },
      });
    } else {
      void this.publishState();
    }
  }

  private applyTransferProgress(progress: WebDavTransferProgress): void {
    this.updateOperation(progress.phase, {
      ...(progress.completedBytes === undefined ? {} : { completedBytes: progress.completedBytes }),
      ...(progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes }),
      ...(progress.completedItems === undefined ? {} : { completedItems: progress.completedItems }),
      ...(progress.totalItems === undefined ? {} : { totalItems: progress.totalItems }),
    });
  }

  private assertIdle(): void {
    if (this.operation || this.configurationMutation) {
      throw new Error('另一项 WebDAV 同步操作正在进行，请稍候。');
    }
  }

  private async mutateConfiguration(action: () => Promise<void>): Promise<DesktopWebDavSyncState> {
    this.assertIdle();
    this.configurationMutation = true;
    this.clearAutomaticTimer();
    let automaticScheduled = false;
    try {
      await action();
      await this.scheduleAutomaticBackup();
      automaticScheduled = true;
      await this.publishState();
      return await this.getState();
    } finally {
      if (!automaticScheduled) {
        await this.scheduleAutomaticBackup().catch(() => undefined);
      }
      this.configurationMutation = false;
    }
  }

  private rememberRestorePlan(plan: StoredWebDavRestorePlan): void {
    this.restorePlans.set(plan.publicPlan.id, plan);
    while (this.restorePlans.size > MAX_RESTORE_PLANS) {
      const oldest = this.restorePlans.keys().next().value as string | undefined;
      if (!oldest) break;
      this.restorePlans.delete(oldest);
    }
  }

  private stateFromConfig(config: StoredWebDavSyncConfig): DesktopWebDavSyncState {
    return {
      configPath: this.options.configStore.configPath,
      configured: Boolean(config.connection),
      ...(config.connection ? {
        connection: {
          endpoint: config.connection.endpoint,
          remoteRoot: config.connection.remoteRoot,
          username: config.connection.username,
          passwordSet: true,
          allowInsecureHttp: config.connection.allowInsecureHttp,
          repositoryId: config.connection.repositoryId,
          recoveryKeySet: true,
          deviceId: config.deviceId,
          deviceName: config.deviceName,
        },
      } : {}),
      automaticBackup: config.automaticBackup,
      categories: [...config.categories],
      ...(this.operation ? { operation: { ...this.operation } } : {}),
      ...(config.lastBackupAt ? { lastBackupAt: config.lastBackupAt } : {}),
      ...(config.lastSnapshotId ? { lastSnapshotId: config.lastSnapshotId } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.nextAutomaticBackupAt ? { nextAutomaticBackupAt: this.nextAutomaticBackupAt } : {}),
    };
  }

  private async publishState(): Promise<void> {
    if (!this.subscribers.size) return;
    this.emitState(await this.getState());
  }

  private emitState(state: DesktopWebDavSyncState): void {
    this.lastPublishedState = state;
    for (const listener of this.subscribers) listener(state);
  }

  private async scheduleAutomaticBackup(delayOverride?: number): Promise<void> {
    this.clearAutomaticTimer();
    if (this.closed) return;
    const config = await this.options.configStore.getConfig();
    if (!config.connection || !config.automaticBackup) {
      this.nextAutomaticBackupAt = undefined;
      return;
    }
    const now = this.now().getTime();
    const baseline = config.lastBackupAt
      ? Date.parse(config.lastBackupAt) + AUTOMATIC_BACKUP_INTERVAL_MS
      : now + INITIAL_AUTOMATIC_BACKUP_DELAY_MS;
    const scheduledAt = now + (delayOverride ?? Math.max(1_000, baseline - now));
    this.nextAutomaticBackupAt = new Date(scheduledAt).toISOString();
    this.automaticTimer = setTimeout(() => {
      this.automaticTimer = null;
      void this.performBackup(true).catch(() => undefined);
    }, Math.min(2_147_000_000, Math.max(1_000, scheduledAt - now)));
    this.automaticTimer.unref?.();
    await this.publishState();
  }

  private clearAutomaticTimer(): void {
    if (this.automaticTimer) clearTimeout(this.automaticTimer);
    this.automaticTimer = null;
  }

  private async createWorkRoot(kind: string): Promise<string> {
    const baseRoot = this.workBaseRoot();
    await mkdir(baseRoot, { recursive: true, mode: 0o700 });
    const root = path.join(baseRoot, `${kind}-${randomUUID()}`);
    await mkdir(root, { recursive: false, mode: 0o700 });
    return root;
  }

  private workBaseRoot(): string {
    return path.join(this.options.dataRoot, '.webdav-sync-work');
  }
}

function snapshotFingerprint(manifest: { id: string; items: unknown[]; categories: unknown[] }): string {
  return JSON.stringify({ id: manifest.id, categories: manifest.categories, items: manifest.items });
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Basic\s+[A-Za-z0-9+/=_-]+/giu, 'Basic [redacted]')
    .slice(0, 1_000) || 'WebDAV 同步失败。';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('同步操作已取消。');
}
