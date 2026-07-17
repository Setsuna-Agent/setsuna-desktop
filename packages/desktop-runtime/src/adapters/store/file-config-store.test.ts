import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeConfigInput } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { FileConfigStore } from './file-config-store.js';

describe('file config store', () => {
  it('enables workspace sandbox networking and managed dependencies by default', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await expect(store.getConfig()).resolves.toMatchObject({
      desktopSettings: { workspaceDependenciesEnabled: true },
      sandboxWorkspaceWrite: { networkAccess: true },
    });
    await expect(store.saveConfig({ sandboxWorkspaceWrite: { networkAccess: false } })).resolves.toMatchObject({
      sandboxWorkspaceWrite: { networkAccess: false },
    });
  });

  it('migrates the old implicit network denial once and then respects an explicit disable', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    await store.saveConfig({ sandboxWorkspaceWrite: { networkAccess: false } });
    const configPath = path.join(dataDir, 'config.json');
    const legacy = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    delete legacy.schemaVersion;
    await writeFile(configPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    await expect(store.getConfig()).resolves.toMatchObject({
      sandboxWorkspaceWrite: { networkAccess: true },
    });
    await expect(store.saveConfig({ globalPrompt: 'persist migration' })).resolves.toMatchObject({
      sandboxWorkspaceWrite: { networkAccess: true },
    });
    await expect(store.saveConfig({ sandboxWorkspaceWrite: { networkAccess: false } })).resolves.toMatchObject({
      sandboxWorkspaceWrite: { networkAccess: false },
    });
  });

  it('serializes partial config updates without losing unrelated fields', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await Promise.all([
      store.saveConfig({ globalPrompt: 'Keep responses concise.' }),
      store.saveConfig({ approvalPolicy: 'strict' }),
    ]);

    await expect(store.getConfig()).resolves.toMatchObject({
      globalPrompt: 'Keep responses concise.',
      approvalPolicy: 'strict',
    });
  });

  it('reports corrupted config instead of silently replacing it with defaults', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    await writeFile(path.join(dataDir, 'config.json'), '{broken', 'utf8');
    const store = new FileConfigStore(dataDir);

    await expect(store.getConfig()).rejects.toThrow('Invalid JSON');
    await expect(store.saveConfig({ globalPrompt: 'must not overwrite' })).rejects.toThrow('Invalid JSON');
  });

  it('persists a valid Markdown link opening preference and drops invalid values', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await expect(store.saveConfig({ desktopSettings: { markdownLinkOpenMode: 'external' } })).resolves.toMatchObject({
      desktopSettings: { markdownLinkOpenMode: 'external' },
    });
    const invalidDesktopSettings = { markdownLinkOpenMode: 'unsupported' } as unknown as RuntimeConfigInput['desktopSettings'];
    await expect(store.saveConfig({ desktopSettings: invalidDesktopSettings })).resolves.toMatchObject({
      desktopSettings: { workspaceDependenciesEnabled: true },
    });
  });

  it('removes API keys for providers deleted from config', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    const initial = await store.getConfig();
    const baseProvider = initial.providers[0];
    if (!baseProvider) throw new Error('Expected the default provider fixture.');

    await store.saveConfig({
      providers: [
        { ...baseProvider, apiKey: 'retained-secret' },
        { ...baseProvider, id: 'removed-provider', name: 'Removed provider', apiKey: 'removed-secret' },
      ],
    });
    await store.saveConfig({ providers: [baseProvider] });

    const secrets = JSON.parse(await readFile(path.join(dataDir, 'secrets.json'), 'utf8')) as {
      providerApiKeys: Record<string, string>;
    };
    expect(secrets.providerApiKeys).toEqual({ [baseProvider.id]: 'retained-secret' });
  });
});
