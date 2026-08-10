import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CredentialVault } from '../../../src/security/credential-vault.js';
import { WebDavSyncConfigStore } from '../../../src/webdav-sync/config-store.js';
import { WebDavSyncService } from '../../../src/webdav-sync/service.js';
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
