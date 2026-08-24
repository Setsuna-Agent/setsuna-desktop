import { DEFAULT_DESKTOP_WEBDAV_SYNC_CATEGORIES } from '../../src/contracts/index.js';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebDavSyncCredentialVault } from '../../src/main/capabilities.js';
import { generateWebDavRecoveryKey } from '../../src/main/crypto.js';
import { createTestWebDavSyncConfigStore } from '../support/feature-host.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WebDavSyncConfigStore', () => {
  it('keeps WebDAV and recovery credentials out of ordinary metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-config-'));
    temporaryRoots.push(root);
    const configPath = path.join(root, 'webdav-sync.json');
    const vault = new MemoryCredentialVault();
    const store = createTestWebDavSyncConfigStore(configPath, vault);
    const initial = await store.initialize();
    expect(initial.automaticBackup).toBe(false);
    expect(initial.categories).toEqual(DEFAULT_DESKTOP_WEBDAV_SYNC_CATEGORIES);
    expect(initial.categories).not.toContain('usage');
    const recoveryKey = generateWebDavRecoveryKey();

    await store.saveConnection({
      endpoint: 'https://dav.example.com/base',
      remoteRoot: '/Setsuna',
      username: 'alice',
      password: 'webdav-password',
      allowInsecureHttp: false,
      repositoryId: '1455a7df-11ca-4b40-9fd8-f65e3a8846f0',
      recoveryKey,
      deviceName: 'Work laptop',
    });

    const raw = await readFile(configPath, 'utf8');
    expect(raw).not.toContain('webdav-password');
    expect(raw).not.toContain(recoveryKey);
    await expect(store.resolveConnection()).resolves.toMatchObject({
      endpoint: 'https://dav.example.com/base',
      password: 'webdav-password',
      recoveryKey,
      username: 'alice',
    });
    expect([...vault.values.values()]).toEqual(expect.arrayContaining(['webdav-password', recoveryKey]));

    await store.disconnect();
    expect(vault.values.size).toBe(0);
    await expect(store.resolveConnection()).resolves.toBeNull();
  });

  it('disables the implicit version 1 automatic backup until the user enables it again', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-migration-'));
    temporaryRoots.push(root);
    const configPath = path.join(root, 'webdav-sync.json');
    await writeFile(configPath, JSON.stringify({
      version: 1,
      deviceId: '55bc8840-ac7a-435a-b5a7-88c2e91e7d87',
      deviceName: 'Work laptop',
      automaticBackup: true,
      categories: DEFAULT_DESKTOP_WEBDAV_SYNC_CATEGORIES,
      pendingCredentialCleanupKeys: [],
    }));
    const store = createTestWebDavSyncConfigStore(configPath, new MemoryCredentialVault());

    const migrated = await store.initialize();
    expect(migrated.automaticBackup).toBe(false);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({
      version: 2,
      automaticBackup: false,
    });

    await expect(store.updatePreferences({ automaticBackup: true }))
      .resolves.toMatchObject({ automaticBackup: true });
  });

  it('refuses an empty category selection', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-categories-'));
    temporaryRoots.push(root);
    const store = createTestWebDavSyncConfigStore(
      path.join(root, 'webdav-sync.json'),
      new MemoryCredentialVault(),
    );
    await store.initialize();
    await expect(store.updatePreferences({ categories: [] })).rejects.toThrow('至少一种');
  });

  it('preserves damaged metadata and resets only the local sync configuration', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-damaged-config-'));
    temporaryRoots.push(root);
    const configPath = path.join(root, 'webdav-sync.json');
    await writeFile(configPath, '{ invalid json', 'utf8');
    const store = createTestWebDavSyncConfigStore(configPath, new MemoryCredentialVault());

    await expect(store.initialize()).rejects.toThrow('无法读取 WebDAV 同步配置');
    const reset = await store.resetDamagedConfig();
    expect(reset.automaticBackup).toBe(false);
    expect(reset.connection).toBeUndefined();

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({
      version: 2,
      automaticBackup: false,
    });
    expect((await readdir(root)).some((name) => name.startsWith('webdav-sync.json.invalid-')))
      .toBe(true);
  });
});

class MemoryCredentialVault implements WebDavSyncCredentialVault {
  readonly values = new Map<string, string>();

  async status() { return { available: true, backend: 'memory' }; }
  async get(key: string) { return this.values.get(key); }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}
