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

  it('persists only valid HTTP package index URLs', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await expect(store.saveConfig({
      desktopSettings: { pythonPackageIndexUrl: '  https://mirror.example/simple  ' },
    })).resolves.toMatchObject({
      desktopSettings: {
        pythonPackageIndexUrl: 'https://mirror.example/simple',
        workspaceDependenciesEnabled: true,
      },
    });
    await expect(store.saveConfig({
      desktopSettings: { pythonPackageIndexUrl: 'file:///tmp/simple' },
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
