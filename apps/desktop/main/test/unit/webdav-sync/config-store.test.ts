import { DEFAULT_DESKTOP_WEBDAV_SYNC_CATEGORIES } from '@setsuna-desktop/contracts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CredentialVault } from '../../../src/security/credential-vault.js';
import { WebDavSyncConfigStore } from '../../../src/webdav-sync/config-store.js';
import { generateWebDavRecoveryKey } from '../../../src/webdav-sync/crypto.js';

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
    const store = new WebDavSyncConfigStore(configPath, vault);
    const initial = await store.initialize();
    expect(initial.automaticBackup).toBe(true);
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

  it('refuses an empty category selection', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'setsuna-webdav-categories-'));
    temporaryRoots.push(root);
    const store = new WebDavSyncConfigStore(
      path.join(root, 'webdav-sync.json'),
      new MemoryCredentialVault(),
    );
    await store.initialize();
    await expect(store.updatePreferences({ categories: [] })).rejects.toThrow('至少一种');
  });
});

class MemoryCredentialVault implements CredentialVault {
  readonly values = new Map<string, string>();

  async status() { return { available: true, backend: 'memory' }; }
  async get(key: string) { return this.values.get(key); }
  async set(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}
