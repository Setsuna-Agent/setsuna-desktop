import type { RuntimeConfigInput } from '@setsuna-desktop/contracts';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileConfigStore } from '../../../src/adapters/store/file-config-store.js';

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

  it('preserves an explicit network denial from schema v2 when upgrading the config', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    await store.saveConfig({ sandboxWorkspaceWrite: { networkAccess: false } });
    const configPath = path.join(dataDir, 'config.json');
    const schemaV2 = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    schemaV2.schemaVersion = 2;
    await writeFile(configPath, `${JSON.stringify(schemaV2, null, 2)}\n`, 'utf8');

    await expect(store.getConfig()).resolves.toMatchObject({
      sandboxWorkspaceWrite: { networkAccess: false },
    });
    await expect(store.saveConfig({ globalPrompt: 'preserve explicit network denial' }))
      .resolves.toMatchObject({
        sandboxWorkspaceWrite: { networkAccess: false },
      });
    const upgraded = JSON.parse(await readFile(configPath, 'utf8')) as {
      schemaVersion?: number;
      sandboxWorkspaceWrite?: { networkAccess?: boolean };
    };
    expect(upgraded).toMatchObject({
      schemaVersion: 3,
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

  it('persists task model references, migrates legacy memory models, and supports clearing assignments', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    const initial = await store.getConfig();
    const provider = initial.providers[0];
    const model = provider?.models[0];
    if (!provider || !model) throw new Error('Expected the default provider and model fixtures.');

    await expect(store.saveConfig({
      memory: {
        extractModel: model.code,
        consolidationModel: model.code,
      },
    })).resolves.toMatchObject({
      taskModels: {
        memoryExtraction: { providerId: provider.id, modelId: model.id },
        memoryConsolidation: { providerId: provider.id, modelId: model.id },
      },
    });

    await expect(store.saveConfig({
      taskModels: {
        memoryExtraction: { providerId: provider.id, modelId: model.id },
        memoryConsolidation: { providerId: provider.id, modelId: model.id },
        contextCompaction: { providerId: provider.id, modelId: model.id },
      },
    })).resolves.toMatchObject({
      taskModels: {
        memoryExtraction: { providerId: provider.id, modelId: model.id },
        memoryConsolidation: { providerId: provider.id, modelId: model.id },
        contextCompaction: { providerId: provider.id, modelId: model.id },
      },
    });

    const stored = JSON.parse(await readFile(path.join(dataDir, 'config.json'), 'utf8')) as {
      memory?: Record<string, unknown>;
    };
    expect(stored.memory).not.toHaveProperty('extractModel');
    expect(stored.memory).not.toHaveProperty('consolidationModel');

    await expect(store.saveConfig({
      taskModels: { memoryExtraction: null },
    })).resolves.toMatchObject({
      taskModels: {
        memoryConsolidation: { providerId: provider.id, modelId: model.id },
        contextCompaction: { providerId: provider.id, modelId: model.id },
      },
    });
    expect((await store.getConfig()).taskModels).not.toHaveProperty('memoryExtraction');
  });

  it('normalizes missing Anthropic output limits to the provider-specific fallback', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    const initial = await store.getConfig();
    const baseProvider = initial.providers[0];
    const baseModel = baseProvider?.models[0];
    if (!baseProvider || !baseModel) throw new Error('Expected the default provider and model fixtures.');
    await store.saveConfig({
      activeProviderId: 'anthropic-provider',
      providers: [{
        ...baseProvider,
        id: 'anthropic-provider',
        provider: 'anthropic',
        models: [{ ...baseModel, id: 'claude', code: 'claude', maxOutputTokens: 4096 }],
      }],
    });
    const configPath = path.join(dataDir, 'config.json');
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as {
      providers: Array<{ models: Array<Record<string, unknown>> }>;
    };
    const storedModel = stored.providers[0]?.models[0];
    if (!storedModel) throw new Error('Expected a stored Anthropic model fixture.');
    delete storedModel.maxOutputTokens;
    await writeFile(configPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    await expect(store.getConfig()).resolves.toMatchObject({
      providers: [{ models: [{ maxOutputTokens: 8192 }] }],
    });
    await expect(store.getActiveProviderConfig()).resolves.toMatchObject({
      activeModel: { maxOutputTokens: 8192 },
    });
  });

  it('reports corrupted config instead of silently replacing it with defaults', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    await writeFile(path.join(dataDir, 'config.json'), '{broken', 'utf8');
    const store = new FileConfigStore(dataDir);

    await expect(store.getConfig()).rejects.toThrow('Invalid JSON');
    await expect(store.saveConfig({ globalPrompt: 'must not overwrite' })).rejects.toThrow('Invalid JSON');
  });

  it('consumes the legacy memory path without persisting it in schema v3', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const configPath = path.join(dataDir, 'config.json');
    const store = new FileConfigStore(dataDir);
    await store.saveConfig({ globalPrompt: 'legacy memory migration' });
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    stored.storagePath = '/Volumes/legacy-memory';
    stored.schemaVersion = 2;
    await writeFile(configPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    await expect(store.getLegacyStoragePath()).resolves.toBe('/Volumes/legacy-memory');
    await expect(store.getConfig()).resolves.toMatchObject({
      storagePath: path.join(dataDir, 'memories'),
    });

    await store.clearLegacyStoragePath();
    const migrated = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    expect(migrated.storagePath).toBeUndefined();
    expect(migrated.schemaVersion).toBe(3);

    await store.saveConfig({ globalPrompt: 'still unified' });
    await expect(readFile(configPath, 'utf8')).resolves.not.toContain('storagePath');
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

  it('persists only supported interface languages', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await expect(store.saveConfig({ desktopSettings: { interfaceLanguage: 'en-US' } })).resolves.toMatchObject({
      desktopSettings: { interfaceLanguage: 'en-US' },
    });
    const invalidDesktopSettings = { interfaceLanguage: 'fr-FR' } as unknown as RuntimeConfigInput['desktopSettings'];
    const normalized = await store.saveConfig({ desktopSettings: invalidDesktopSettings });
    expect(normalized).toMatchObject({
      desktopSettings: { workspaceDependenciesEnabled: true },
    });
    expect(normalized.desktopSettings?.interfaceLanguage).toBeUndefined();
  });

  it('persists only valid HTTP package source URLs', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await expect(store.saveConfig({
      desktopSettings: {
        npmRegistryUrl: '  https://registry.example/npm/  ',
        pythonPackageIndexUrl: '  https://mirror.example/simple  ',
      },
    })).resolves.toMatchObject({
      desktopSettings: {
        npmRegistryUrl: 'https://registry.example/npm/',
        pythonPackageIndexUrl: 'https://mirror.example/simple',
        workspaceDependenciesEnabled: true,
      },
    });
    await expect(store.saveConfig({
      desktopSettings: {
        npmRegistryUrl: 'file:///tmp/registry',
        pythonPackageIndexUrl: 'file:///tmp/simple',
      },
    })).resolves.toMatchObject({
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

  it('persists preset and custom provider icons and supports restoring automatic matching', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    const initial = await store.getConfig();
    const baseProvider = initial.providers[0];
    if (!baseProvider) throw new Error('Expected the default provider fixture.');

    await expect(store.saveConfig({
      providers: [{ ...baseProvider, icon: { type: 'preset', key: 'minimax' } }],
    })).resolves.toMatchObject({
      providers: [{ icon: { type: 'preset', key: 'minimax' } }],
    });

    const dataUrl = `data:image/png;base64,${Buffer.from('provider icon').toString('base64')}`;
    await expect(store.saveConfig({
      providers: [{ ...baseProvider, icon: { type: 'custom', dataUrl } }],
    })).resolves.toMatchObject({
      providers: [{ icon: { type: 'custom', dataUrl } }],
    });

    const restored = await store.saveConfig({ providers: [{ ...baseProvider, icon: null }] });
    expect(restored.providers[0]).not.toHaveProperty('icon');
    expect(await readFile(path.join(dataDir, 'config.json'), 'utf8')).not.toContain(dataUrl);

    const configPath = path.join(dataDir, 'config.json');
    const tampered = JSON.parse(await readFile(configPath, 'utf8')) as { providers: Array<Record<string, unknown>> };
    if (!tampered.providers[0]) throw new Error('Expected a stored provider fixture.');
    tampered.providers[0].icon = { type: 'custom', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' };
    await writeFile(configPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
    expect((await store.getConfig()).providers[0]).not.toHaveProperty('icon');
  });

  it('persists valid model icons and drops unsafe model icon data', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    const initial = await store.getConfig();
    const baseProvider = initial.providers[0];
    const baseModel = baseProvider?.models[0];
    if (!baseProvider || !baseModel) throw new Error('Expected the default provider and model fixtures.');

    await expect(store.saveConfig({
      providers: [{
        ...baseProvider,
        models: [{ ...baseModel, icon: { type: 'preset', key: 'openai' } }],
      }],
    })).resolves.toMatchObject({
      providers: [{ models: [{ icon: { type: 'preset', key: 'openai' } }] }],
    });

    const configPath = path.join(dataDir, 'config.json');
    const tampered = JSON.parse(await readFile(configPath, 'utf8')) as {
      providers: Array<{ models: Array<Record<string, unknown>> }>;
    };
    const storedModel = tampered.providers[0]?.models[0];
    if (!storedModel) throw new Error('Expected a stored model fixture.');
    storedModel.icon = { type: 'custom', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' };
    await writeFile(configPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
    expect((await store.getConfig()).providers[0]?.models[0]).not.toHaveProperty('icon');
  });

  it('stores the image generation API key only in secrets and supports clearing it', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);

    await expect(store.saveConfig({
      imageGeneration: {
        baseUrl: '  http://127.0.0.1:8000  ',
        model: ' image-model ',
        apiKey: ' image-secret ',
      },
    })).resolves.toMatchObject({
      imageGeneration: {
        baseUrl: 'http://127.0.0.1:8000',
        model: 'image-model',
        apiKeySet: true,
      },
    });
    await expect(store.getImageGenerationConfig()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:8000',
      model: 'image-model',
      apiKey: 'image-secret',
    });
    expect(await readFile(path.join(dataDir, 'config.json'), 'utf8')).not.toContain('image-secret');
    expect(await readFile(path.join(dataDir, 'secrets.json'), 'utf8')).toContain('image-secret');

    await expect(store.saveConfig({ imageGeneration: { clearApiKey: true } })).resolves.toMatchObject({
      imageGeneration: { apiKeySet: false },
    });
    await expect(store.getImageGenerationConfig()).resolves.toMatchObject({ apiKey: '' });
  });
});
