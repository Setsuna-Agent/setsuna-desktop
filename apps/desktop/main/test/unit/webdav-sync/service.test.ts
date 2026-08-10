import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CredentialVault } from '../../../src/security/credential-vault.js';
import { WebDavSyncConfigStore } from '../../../src/webdav-sync/config-store.js';
import {
  WebDavSyncService,
  type WebDavSyncRuntimeCoordinator,
} from '../../../src/webdav-sync/service.js';
import { MemoryWebDavServer } from '../../support/memory-webdav.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WebDavSyncService', () => {
  it('cleans plaintext staging before reporting a damaged sync config', async () => {
    const dataRoot = await createDataRoot();
    const workRoot = path.join(dataRoot, '.webdav-sync-work');
    await mkdir(path.join(workRoot, 'stale'), { recursive: true });
    await writeFile(path.join(workRoot, 'stale', 'local-data.json'), '{"secret":true}\n');
    await writeFile(path.join(dataRoot, 'webdav-sync.json'), '{ invalid json', 'utf8');
    const service = new WebDavSyncService({
      dataRoot,
      appVersion: '0.2.1',
      configStore: new WebDavSyncConfigStore(
        path.join(dataRoot, 'webdav-sync.json'),
        new MemoryCredentialVault(),
      ),
      fetch: new MemoryWebDavServer('/dav').fetch,
      runtime: {
        prepare: async () => ({ ready: true, registeredTasks: 0, pendingMutations: 0 }),
        release: async () => undefined,
        stop: async () => undefined,
        start: async () => undefined,
      },
      requestRelaunch: async () => undefined,
    });

    await expect(service.initialize()).rejects.toThrow('无法读取 WebDAV 同步配置');
    await expect(readFile(path.join(workRoot, 'stale', 'local-data.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.resetLocalConfiguration()).resolves.toMatchObject({ configured: false });
    service.close();
  });

  it('disables sync when stale plaintext staging data cannot be removed', async () => {
    if (process.platform === 'win32') return;
    const dataRoot = await createDataRoot();
    const workRoot = path.join(dataRoot, '.webdav-sync-work');
    const stalePath = path.join(workRoot, 'stale', 'local-data.json');
    const staleRoot = path.dirname(stalePath);
    await mkdir(staleRoot, { recursive: true });
    await writeFile(stalePath, '{"secret":true}\n');
    await chmod(staleRoot, 0o500);
    await chmod(workRoot, 0o500);
    const service = new WebDavSyncService({
      dataRoot,
      appVersion: '0.2.1',
      configStore: new WebDavSyncConfigStore(
        path.join(dataRoot, 'webdav-sync.json'),
        new MemoryCredentialVault(),
      ),
      fetch: new MemoryWebDavServer('/dav').fetch,
      runtime: {
        prepare: async () => ({ ready: true, registeredTasks: 0, pendingMutations: 0 }),
        release: async () => undefined,
        stop: async () => undefined,
        start: async () => undefined,
      },
      requestRelaunch: async () => undefined,
    });

    try {
      await expect(service.initialize()).rejects.toThrow('本地明文暂存目录');
      await expect(readFile(stalePath, 'utf8')).resolves.toContain('secret');
      await expect(service.getState()).rejects.toThrow('同步功能已停用');
    } finally {
      await chmod(staleRoot, 0o700).catch(() => undefined);
      await chmod(workRoot, 0o700);
      service.close();
    }
  });

  it('keeps sync unavailable when automatic backup scheduling fails during initialization', async () => {
    const dataRoot = await createDataRoot();
    const configStore = new WebDavSyncConfigStore(
      path.join(dataRoot, 'webdav-sync.json'),
      new MemoryCredentialVault(),
    );
    const getConfig = vi.spyOn(configStore, 'getConfig')
      .mockRejectedValueOnce(new Error('automatic schedule unavailable'));
    const service = new WebDavSyncService({
      dataRoot,
      appVersion: '0.2.1',
      configStore,
      fetch: new MemoryWebDavServer('/dav').fetch,
      runtime: {
        prepare: async () => ({ ready: true, registeredTasks: 0, pendingMutations: 0 }),
        release: async () => undefined,
        stop: async () => undefined,
        start: async () => undefined,
      },
      requestRelaunch: async () => undefined,
    });

    await expect(service.initialize()).rejects.toThrow('automatic schedule unavailable');
    await expect(service.getState()).rejects.toThrow('automatic schedule unavailable');
    expect(getConfig).toHaveBeenCalledOnce();

    await expect(service.initialize()).resolves.toBeUndefined();
    await expect(service.getState()).resolves.toMatchObject({ configured: false });
    service.close();
  });

  it('backs up and manually restores portable config plus independently encrypted model API keys', async () => {
    const dataRoot = await createDataRoot();
    const server = new MemoryWebDavServer('/dav');
    const vault = new MemoryCredentialVault();
    const prepare = vi.fn(async () => ({ ready: true, registeredTasks: 0, pendingMutations: 0 }));
    const release = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const start = vi.fn(async () => undefined);
    const requestRelaunch = vi.fn(async () => undefined);
    const service = new WebDavSyncService({
      dataRoot,
      appVersion: '0.2.1',
      configStore: new WebDavSyncConfigStore(path.join(dataRoot, 'webdav-sync.json'), vault),
      fetch: server.fetch,
      runtime: { prepare, release, stop, start },
      requestRelaunch,
    });
    await service.initialize();
    try {
      const testedState = await service.testConnection({
        endpoint: 'https://dav.test/dav',
        remoteRoot: '/Backups',
        username: 'alice',
        password: 'secret',
        repositoryMode: 'create',
      });
      expect(testedState.configured).toBe(false);
      expect(vault.values.size).toBe(0);
      expect(server.files.size).toBe(0);

      const configured = await service.configure({
        endpoint: 'https://dav.test/dav',
        remoteRoot: '/Backups',
        username: 'alice',
        password: 'secret',
        repositoryMode: 'create',
        deviceName: 'Test device',
      });
      expect(configured.recoveryKey).toMatch(/^setsuna-v1-/u);
      expect(configured.state.operation).toBeUndefined();
      await expect(service.revealRecoveryKey()).resolves.toBe(configured.recoveryKey);
      await service.updatePreferences({ categories: ['preferences', 'model_credentials'] });
      const firstBackup = await service.backupNow();
      const backup = await service.backupNow();
      expect(backup.state.operation).toBeUndefined();
      expect(backup.snapshot.id).not.toBe(firstBackup.snapshot.id);
      expect(backup.snapshot.categories.map((category) => category.id))
        .toEqual(['preferences', 'model_credentials']);
      expect([...server.files.keys()].some((remotePath) => (
        remotePath.includes(firstBackup.snapshot.id)
      ))).toBe(false);

      await writeRuntimeConfig(dataRoot, 'locally changed');
      await writeFile(path.join(dataRoot, 'runtime', 'secrets.json'), JSON.stringify({
        providerApiKeys: {
          'provider-openai': 'sk-locally-changed',
          'provider-local-only': 'sk-local-only',
        },
      }), { encoding: 'utf8', mode: 0o600 });

      const snapshots = await service.listSnapshots();
      expect(snapshots.snapshots).toHaveLength(1);
      expect(snapshots.snapshots[0]?.id).toBe(backup.snapshot.id);
      const plan = await service.inspectRestore({
        snapshotId: snapshots.snapshots[0]!.id,
        categories: ['preferences', 'model_credentials'],
      });
      expect(plan.overwrittenCount).toBeGreaterThanOrEqual(2);
      expect(plan.diffs.find((diff) => diff.category === 'model_credentials')?.removed)
        .toEqual([]);
      expect(plan.diffs.find((diff) => diff.category === 'model_credentials')?.preserved)
        .toContainEqual(expect.objectContaining({ detail: 'provider-local-only' }));

      const restoreDownloadProgress: Array<{ completed: number; total: number }> = [];
      const unsubscribe = service.subscribe((state) => {
        const operation = state.operation;
        if (operation?.kind !== 'restore' || operation.phase !== 'downloading' || !operation.totalBytes) return;
        restoreDownloadProgress.push({
          completed: operation.completedBytes ?? 0,
          total: operation.totalBytes,
        });
      });
      await service.restore(plan.id);
      unsubscribe();

      expect(requestRelaunch).toHaveBeenCalledOnce();
      expect(stop).toHaveBeenCalledOnce();
      expect(start).not.toHaveBeenCalled();
      expect(await readFile(path.join(dataRoot, 'runtime', 'config.json'), 'utf8'))
        .toContain('backed up');
      const restoredSecrets = JSON.parse(
        await readFile(path.join(dataRoot, 'runtime', 'secrets.json'), 'utf8'),
      ) as { providerApiKeys: Record<string, string> };
      expect(restoredSecrets.providerApiKeys).toEqual({
        'provider-local-only': 'sk-local-only',
        'provider-openai': 'sk-backup-value',
      });
      expect(restoreDownloadProgress[0]?.completed).toBe(0);
      const finalDownloadProgress = restoreDownloadProgress.at(-1);
      expect(finalDownloadProgress).toBeDefined();
      expect(finalDownloadProgress?.completed).toBe(finalDownloadProgress?.total);
      expect(restoreDownloadProgress.every((item, index) => (
        index === 0 || item.completed >= restoreDownloadProgress[index - 1]!.completed
      ))).toBe(true);
      expect([...server.files.values()].some((data) => data.includes('sk-backup-value'))).toBe(false);
    } finally {
      service.close();
    }
  }, 15_000);

  it('rolls back a newly created repository when secure local persistence fails', async () => {
    const dataRoot = await createDataRoot();
    const server = new MemoryWebDavServer('/dav');
    const configPath = path.join(dataRoot, 'webdav-sync.json');
    const runtime = {
      prepare: async () => ({ ready: true as const, registeredTasks: 0, pendingMutations: 0 }),
      release: async () => undefined,
      stop: async () => undefined,
      start: async () => undefined,
    };
    const failedService = new WebDavSyncService({
      dataRoot,
      appVersion: '0.2.1',
      configStore: new WebDavSyncConfigStore(configPath, new RejectingCredentialVault()),
      fetch: server.fetch,
      runtime,
      requestRelaunch: async () => undefined,
    });
    await failedService.initialize();
    await expect(failedService.configure({
      endpoint: 'https://dav.test/dav',
      remoteRoot: '/Backups',
      username: 'alice',
      password: 'secret',
      repositoryMode: 'create',
    })).rejects.toThrow('安全存储不可用');
    failedService.close();

    expect([...server.files.keys()].some((remotePath) => remotePath.endsWith('/repository.json')))
      .toBe(false);

    const retryService = new WebDavSyncService({
      dataRoot,
      appVersion: '0.2.1',
      configStore: new WebDavSyncConfigStore(configPath, new MemoryCredentialVault()),
      fetch: server.fetch,
      runtime,
      requestRelaunch: async () => undefined,
    });
    await retryService.initialize();
    try {
      await expect(retryService.configure({
        endpoint: 'https://dav.test/dav',
        remoteRoot: '/Backups',
        username: 'alice',
        password: 'secret',
        repositoryMode: 'create',
      })).resolves.toMatchObject({ recoveryKey: expect.stringMatching(/^setsuna-v1-/u) });
    } finally {
      retryService.close();
    }
  });

  it('releases the runtime gate before starting the network upload', async () => {
    const releaseGate = deferred();
    const release = vi.fn(() => releaseGate.promise);
    const fixture = await createConfiguredService({
      prepare: async () => ({ ready: true, registeredTasks: 0, pendingMutations: 0 }),
      release,
      stop: async () => undefined,
      start: async () => undefined,
    });
    try {
      await fixture.service.updatePreferences({ categories: ['preferences'] });
      const backup = fixture.service.backupNow();
      await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());

      expect([...fixture.server.files.keys()].some((remotePath) => (
        remotePath.includes('/snapshots/')
      ))).toBe(false);

      await writeRuntimeConfig(fixture.dataRoot, 'changed after snapshot');
      releaseGate.resolve();
      const completed = await backup;
      expect(completed.snapshot).toMatchObject({ categories: [{ id: 'preferences' }] });
      expect([...fixture.server.files.keys()].some((remotePath) => (
        remotePath.includes('/snapshots/')
      ))).toBe(true);

      const plan = await fixture.service.inspectRestore({
        snapshotId: completed.snapshot.id,
        categories: ['preferences'],
      });
      await fixture.service.restore(plan.id);
      expect(await readFile(path.join(fixture.dataRoot, 'runtime', 'config.json'), 'utf8'))
        .toContain('backed up');
    } finally {
      releaseGate.resolve();
      fixture.service.close();
    }
  });

  it('reports a runtime gate release failure instead of claiming backup success', async () => {
    const release = vi.fn(async () => {
      throw new Error('runtime bridge unavailable');
    });
    const fixture = await createConfiguredService({
      prepare: async () => ({ ready: true, registeredTasks: 0, pendingMutations: 0 }),
      release,
      stop: async () => undefined,
      start: async () => undefined,
    });
    try {
      await fixture.service.updatePreferences({ categories: ['preferences'] });
      await expect(fixture.service.backupNow()).rejects.toThrow('无法解除本地 Runtime');
      expect(release).toHaveBeenCalledTimes(3);
      expect([...fixture.server.files.keys()].some((remotePath) => (
        remotePath.includes('/snapshots/')
      ))).toBe(false);
      expect((await fixture.service.getState()).operation).toBeUndefined();
    } finally {
      fixture.service.close();
    }
  });

  it('does not admit a backup while category preferences are being persisted', async () => {
    const fixture = await createConfiguredService({
      prepare: async () => ({ ready: true, registeredTasks: 0, pendingMutations: 0 }),
      release: async () => undefined,
      stop: async () => undefined,
      start: async () => undefined,
    });
    try {
      await fixture.service.updatePreferences({
        categories: ['preferences', 'model_credentials'],
      });
      const updateGate = deferred();
      const updatePreferences = fixture.configStore.updatePreferences.bind(fixture.configStore);
      const updateSpy = vi.spyOn(fixture.configStore, 'updatePreferences').mockImplementation(
        async (input) => {
          await updateGate.promise;
          return updatePreferences(input);
        },
      );

      const update = fixture.service.updatePreferences({ categories: ['preferences'] });
      await vi.waitFor(() => expect(updateSpy).toHaveBeenCalledOnce());
      await expect(fixture.service.backupNow()).rejects.toThrow('另一项 WebDAV 同步操作');

      updateGate.resolve();
      await update;
      await expect(fixture.service.backupNow()).resolves.toMatchObject({
        snapshot: { categories: [{ id: 'preferences' }] },
      });
    } finally {
      fixture.service.close();
    }
  });

  it('retries automatic backup when its timer fires during another sync operation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T10:00:00.000Z'));
    const requestGate = deferred();
    const requestBlocked = deferred();
    const automaticStarted = deferred();
    let service: WebDavSyncService | undefined;
    try {
      const dataRoot = await createDataRoot();
      const server = new MemoryWebDavServer('/dav');
      let blockNextRequest = false;
      const fetch = (async (...args: Parameters<typeof globalThis.fetch>) => {
        if (blockNextRequest) {
          blockNextRequest = false;
          requestBlocked.resolve();
          await requestGate.promise;
        }
        return server.fetch(...args);
      }) as typeof globalThis.fetch;
      const prepare = vi.fn(async () => {
        automaticStarted.resolve();
        return { ready: true as const, registeredTasks: 0, pendingMutations: 0 };
      });
      service = new WebDavSyncService({
        dataRoot,
        appVersion: '0.2.1',
        configStore: new WebDavSyncConfigStore(
          path.join(dataRoot, 'webdav-sync.json'),
          new MemoryCredentialVault(),
        ),
        fetch,
        runtime: {
          prepare,
          release: async () => undefined,
          stop: async () => undefined,
          start: async () => undefined,
        },
        requestRelaunch: async () => undefined,
      });
      await service.initialize();
      await service.configure({
        endpoint: 'https://dav.test/dav',
        remoteRoot: '/Backups',
        username: 'alice',
        password: 'secret',
        repositoryMode: 'create',
      });
      await service.updatePreferences({
        automaticBackup: true,
        categories: ['preferences'],
      });
      const initialSchedule = (await service.getState()).nextAutomaticBackupAt;

      await vi.advanceTimersByTimeAsync(299_000);
      blockNextRequest = true;
      const listing = service.listSnapshots();
      await requestBlocked.promise;

      const retryScheduled = deferred();
      const unsubscribeRetry = service.subscribe((state) => {
        if (state.nextAutomaticBackupAt && state.nextAutomaticBackupAt !== initialSchedule) {
          retryScheduled.resolve();
        }
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await retryScheduled.promise;
      unsubscribeRetry();
      expect(prepare).not.toHaveBeenCalled();

      requestGate.resolve();
      await listing;
      const backupCompleted = deferred();
      const unsubscribeBackup = service.subscribe((state) => {
        if (state.lastBackupAt) backupCompleted.resolve();
      });
      await vi.advanceTimersByTimeAsync(15 * 60 * 1_000);
      await automaticStarted.promise;
      await backupCompleted.promise;
      unsubscribeBackup();
      expect(prepare).toHaveBeenCalledOnce();
    } finally {
      requestGate.resolve();
      service?.close();
      vi.useRealTimers();
    }
  });

  it('stops the runtime before validating the final restore inventory', async () => {
    const dataRoot = await createDataRoot();
    const server = new MemoryWebDavServer('/dav');
    const stop = vi.fn(async () => writeRuntimeConfig(dataRoot, 'changed while stopping'));
    const start = vi.fn(async () => undefined);
    const requestRelaunch = vi.fn(async () => undefined);
    const service = new WebDavSyncService({
      dataRoot,
      appVersion: '0.2.1',
      configStore: new WebDavSyncConfigStore(
        path.join(dataRoot, 'webdav-sync.json'),
        new MemoryCredentialVault(),
      ),
      fetch: server.fetch,
      runtime: {
        prepare: async () => ({ ready: true, registeredTasks: 0, pendingMutations: 0 }),
        release: async () => undefined,
        stop,
        start,
      },
      requestRelaunch,
    });
    await service.initialize();
    try {
      await service.configure({
        endpoint: 'https://dav.test/dav',
        remoteRoot: '/Backups',
        username: 'alice',
        password: 'secret',
        repositoryMode: 'create',
      });
      await service.updatePreferences({ categories: ['preferences'] });
      const backup = await service.backupNow();
      const plan = await service.inspectRestore({
        snapshotId: backup.snapshot.id,
        categories: ['preferences'],
      });

      await expect(service.restore(plan.id)).rejects.toThrow(
        '检查清单后，会被覆盖或删除的本地内容发生了变化',
      );

      expect(stop).toHaveBeenCalledOnce();
      expect(start).toHaveBeenCalledOnce();
      expect(requestRelaunch).not.toHaveBeenCalled();
      expect(await readFile(path.join(dataRoot, 'runtime', 'config.json'), 'utf8'))
        .toContain('changed while stopping');
    } finally {
      service.close();
    }
  }, 15_000);
});

async function createDataRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-service-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, 'runtime'), { recursive: true });
  await writeRuntimeConfig(root, 'backed up');
  await writeFile(path.join(root, 'runtime', 'secrets.json'), JSON.stringify({
    providerApiKeys: { 'provider-openai': 'sk-backup-value' },
  }), { encoding: 'utf8', mode: 0o600 });
  return root;
}

async function writeRuntimeConfig(root: string, marker: string): Promise<void> {
  await writeFile(path.join(root, 'runtime', 'config.json'), JSON.stringify({
    schemaVersion: 5,
    globalPrompt: marker,
    providers: [{
      id: 'provider-openai',
      name: 'OpenAI',
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      models: [],
      proxyRoute: { mode: 'inherit' },
    }],
  }), 'utf8');
}

class MemoryCredentialVault implements CredentialVault {
  readonly values = new Map<string, string>();

  async status() { return { available: true, backend: 'memory' }; }
  async get(key: string) { return this.values.get(key); }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

class RejectingCredentialVault extends MemoryCredentialVault {
  override async set(): Promise<void> {
    throw new Error('安全存储不可用');
  }
}

async function createConfiguredService(runtime: WebDavSyncRuntimeCoordinator) {
  const dataRoot = await createDataRoot();
  const server = new MemoryWebDavServer('/dav');
  const configStore = new WebDavSyncConfigStore(
    path.join(dataRoot, 'webdav-sync.json'),
    new MemoryCredentialVault(),
  );
  const service = new WebDavSyncService({
    dataRoot,
    appVersion: '0.2.1',
    configStore,
    fetch: server.fetch,
    runtime,
    requestRelaunch: async () => undefined,
  });
  await service.initialize();
  await service.configure({
    endpoint: 'https://dav.test/dav',
    remoteRoot: '/Backups',
    username: 'alice',
    password: 'secret',
    repositoryMode: 'create',
  });
  return { configStore, dataRoot, server, service };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
