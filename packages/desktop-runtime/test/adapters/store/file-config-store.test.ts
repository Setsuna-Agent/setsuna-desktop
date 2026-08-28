import type { RuntimeConfigInput } from '@setsuna-desktop/contracts';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileConfigStore } from '../../../src/adapters/store/file-config-store.js';

describe('file config store', () => {
  it('enables workspace sandbox networking by default', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await expect(store.getConfig()).resolves.toMatchObject({
      approvalReviewer: 'automatic',
      desktopSettings: {},
      sandboxWorkspaceWrite: { networkAccess: true },
    });
    await expect(store.saveConfig({ sandboxWorkspaceWrite: { networkAccess: false } })).resolves.toMatchObject({
      sandboxWorkspaceWrite: { networkAccess: false },
    });
  });

  it('hands the legacy developer flag to Conversation Debug exactly once', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    await store.saveConfig({ features: { developer_features: true, request_permissions_tool: true } });
    const configPath = path.join(dataDir, 'config.json');
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as { features?: Record<string, boolean> };
    stored.features = { ...stored.features, developer_features: true };
    await writeFile(configPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    const legacy = store.conversationDebugLegacySettingsAdapter();
    await expect(legacy.read()).resolves.toEqual({ enabled: true });
    await expect(store.getConfig()).resolves.toMatchObject({
      features: { request_permissions_tool: true },
    });

    await store.saveConfig({ globalPrompt: 'preserve unconsumed debug settings' });
    const preserved = JSON.parse(await readFile(configPath, 'utf8')) as { features?: Record<string, boolean> };
    expect(preserved.features).toMatchObject({
      developer_features: true,
      request_permissions_tool: true,
    });

    await legacy.retire();
    await store.saveConfig({ globalPrompt: 'do not resurrect retired debug settings' });
    const retired = JSON.parse(await readFile(configPath, 'utf8')) as { features?: Record<string, boolean> };
    expect(retired.features).not.toHaveProperty('developer_features');
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
      schemaVersion: 6,
      sandboxWorkspaceWrite: { networkAccess: false },
    });
  });

  it.each([
    ['strict', 'read-only'],
    ['strict', 'danger-full-access'],
    ['on-request', 'read-only'],
    ['on-request', 'danger-full-access'],
    ['full', 'read-only'],
    ['full', 'workspace-write'],
  ] as const)('automatically persists the legacy %s + %s access combination as agent approval', async (
    approvalPolicy,
    permissionProfile,
  ) => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const configPath = path.join(dataDir, 'config.json');
    const store = new FileConfigStore(dataDir);
    await store.saveConfig({ globalPrompt: 'legacy access migration' });
    const legacy = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    legacy.schemaVersion = 3;
    legacy.approvalPolicy = approvalPolicy;
    legacy.permissionProfile = permissionProfile;
    await writeFile(configPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    await expect(store.getConfig()).resolves.toMatchObject({
      approvalPolicy: 'on-request',
      approvalReviewer: 'automatic',
      permissionProfile: 'workspace-write',
    });
    await expect(readFile(configPath, 'utf8').then((content) => JSON.parse(content))).resolves.toMatchObject({
      schemaVersion: 6,
      approvalPolicy: 'on-request',
      approvalReviewer: 'automatic',
      permissionProfile: 'workspace-write',
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

  it('persists provider proxy overrides and migrates older providers to inherit', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const configPath = path.join(dataDir, 'config.json');
    const store = new FileConfigStore(dataDir);
    const initial = await store.getConfig();
    const provider = initial.providers[0]!;

    await expect(store.saveConfig({
      providers: [{
        ...provider,
        proxyRoute: { mode: 'proxy', proxyServerId: 'proxy-example' },
      }],
    })).resolves.toMatchObject({
      providers: [{ proxyRoute: { mode: 'proxy', proxyServerId: 'proxy-example' } }],
    });

    const legacy = JSON.parse(await readFile(configPath, 'utf8')) as {
      providers: Array<Record<string, unknown>>;
      schemaVersion: number;
    };
    legacy.schemaVersion = 4;
    delete legacy.providers[0]?.proxyRoute;
    await writeFile(configPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    await expect(store.getConfig()).resolves.toMatchObject({
      providers: [{ proxyRoute: { mode: 'inherit' } }],
    });
    await expect(readFile(configPath, 'utf8').then((content) => JSON.parse(content)))
      .resolves.toMatchObject({
        schemaVersion: 6,
        providers: [{ proxyRoute: { mode: 'inherit' } }],
    });
  });

  it('preserves a provider with an empty endpoint and model catalog', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));
    const provider = (await store.getConfig()).providers[0]!;

    await expect(store.saveConfig({
      providers: [{
        ...provider,
        id: 'blank-provider',
        baseUrl: '',
        models: [],
      }],
    })).resolves.toMatchObject({
      providers: [{ id: 'blank-provider', baseUrl: '', models: [] }],
    });

    await expect(store.getConfig()).resolves.toMatchObject({
      providers: [{ id: 'blank-provider', baseUrl: '', models: [] }],
    });
  });

  it('rejects a queued stale provider save after the referenced proxy is deleted', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const availableProxyIds = new Set(['proxy-example']);
    const store = new FileConfigStore(dataDir, {
      validateProxyServerReferences: async (proxyServerIds) => {
        const missing = proxyServerIds.find((proxyServerId) => !availableProxyIds.has(proxyServerId));
        if (missing) throw new Error(`选择的代理服务器不存在：${missing}`);
      },
    });
    const provider = (await store.getConfig()).providers[0]!;
    let releaseDeletion!: () => void;
    let markDeletionStarted!: () => void;
    const deletionStarted = new Promise<void>((resolve) => { markDeletionStarted = resolve; });
    const holdDeletion = new Promise<void>((resolve) => { releaseDeletion = resolve; });
    const deletion = store.deleteProxyServerIfUnreferenced('proxy-example', async () => {
      availableProxyIds.delete('proxy-example');
      markDeletionStarted();
      await holdDeletion;
      return 'deleted';
    });
    await deletionStarted;

    const staleSave = store.saveConfig({
      providers: [{
        ...provider,
        proxyRoute: { mode: 'proxy', proxyServerId: 'proxy-example' },
      }],
    });
    releaseDeletion();

    await expect(deletion).resolves.toBe('deleted');
    await expect(staleSave).rejects.toThrow('选择的代理服务器不存在');
    await expect(store.getConfig()).resolves.toMatchObject({
      providers: [{ proxyRoute: { mode: 'inherit' } }],
    });
  });

  it('blocks proxy deletion while a saved provider still references it', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    const provider = (await store.getConfig()).providers[0]!;
    await store.saveConfig({
      providers: [{
        ...provider,
        name: 'Local models',
        proxyRoute: { mode: 'proxy', proxyServerId: 'PROXY-EXAMPLE' },
      }],
    });

    await expect(store.getConfig()).resolves.toMatchObject({
      providers: [{ proxyRoute: { mode: 'proxy', proxyServerId: 'proxy-example' } }],
    });
    await expect(store.deleteProxyServerIfUnreferenced('proxy-example', async () => 'deleted'))
      .rejects.toThrow('Local models');
  });

  it('keeps Feature-owned task-model migrations separate from host task models', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    const initial = await store.getConfig();
    const provider = initial.providers[0];
    const model = provider?.models[0];
    if (!provider || !model) throw new Error('Expected the default provider and model fixtures.');

    await expect(store.saveConfig({
      taskModels: {
        review: { providerId: provider.id, modelId: model.id },
        approvalReview: { providerId: provider.id, modelId: model.id },
        contextCompaction: { providerId: provider.id, modelId: model.id },
      },
    })).resolves.toMatchObject({
      taskModels: {
        review: { providerId: provider.id, modelId: model.id },
        approvalReview: { providerId: provider.id, modelId: model.id },
        contextCompaction: { providerId: provider.id, modelId: model.id },
      },
    });

    const configPath = path.join(dataDir, 'config.json');
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    stored.memory = {
      useMemories: false,
      generateMemories: true,
      disableOnExternalContext: true,
      extractModel: model.code,
    };
    stored.memoryEnabled = true;
    stored.taskModels = {
      ...(stored.taskModels as Record<string, unknown>),
      threadTitle: { providerId: provider.id, modelId: model.id },
      memoryExtraction: { providerId: provider.id, modelId: model.id },
      memoryConsolidation: { providerId: provider.id, modelId: model.id },
    };
    await writeFile(configPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    // An unrelated host config save must not erase migration input that a Feature has not consumed yet.
    await store.saveConfig({ setsunaStyle: 'daily' });

    const memoryLegacy = store.memoryLegacySettingsAdapter();
    const titleLegacy = store.threadTitleGenerationLegacySettingsAdapter();
    await expect(memoryLegacy.read()).resolves.toMatchObject({
      value: {
        useMemories: false,
        generateMemories: true,
        extractionModel: { providerId: provider.id, modelId: model.id },
        consolidationModel: { providerId: provider.id, modelId: model.id },
        extractionModelCode: model.code,
      },
    });
    await expect(titleLegacy.read()).resolves.toEqual({
      providerId: provider.id,
      modelId: model.id,
    });
    expect((await store.getConfig()).taskModels).toEqual({
      review: { providerId: provider.id, modelId: model.id },
      approvalReview: { providerId: provider.id, modelId: model.id },
      contextCompaction: { providerId: provider.id, modelId: model.id },
    });

    await memoryLegacy.retire();
    await titleLegacy.retire();
    const migrated = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    expect(migrated).not.toHaveProperty('memory');
    expect(migrated).not.toHaveProperty('memoryEnabled');
    expect(migrated.taskModels).not.toHaveProperty('memoryExtraction');
    expect(migrated.taskModels).not.toHaveProperty('memoryConsolidation');
    expect(migrated.taskModels).not.toHaveProperty('threadTitle');
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

  it('consumes the legacy memory path without persisting it in the current schema', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const configPath = path.join(dataDir, 'config.json');
    const store = new FileConfigStore(dataDir);
    await store.saveConfig({ globalPrompt: 'legacy memory migration' });
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    stored.storagePath = '/Volumes/legacy-memory';
    stored.schemaVersion = 2;
    stored.approvalPolicy = 'full';
    stored.permissionProfile = 'workspace-write';
    await writeFile(configPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    await expect(store.getLegacyStoragePath()).resolves.toBe('/Volumes/legacy-memory');
    await expect(store.getConfig()).resolves.toMatchObject({
      storagePath: path.join(dataDir, 'memories'),
    });

    await store.clearLegacyStoragePath();
    const migrated = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    expect(migrated.storagePath).toBeUndefined();
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated).toMatchObject({
      approvalPolicy: 'on-request',
      approvalReviewer: 'automatic',
      permissionProfile: 'workspace-write',
    });

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
      desktopSettings: {},
    });
  });

  it('persists only a boolean transcript thinking preference', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));

    await expect(store.saveConfig({ desktopSettings: { showThinkingInTranscript: true } })).resolves.toMatchObject({
      desktopSettings: { showThinkingInTranscript: true },
    });
    const invalidDesktopSettings = { showThinkingInTranscript: 'yes' } as unknown as RuntimeConfigInput['desktopSettings'];
    await expect(store.saveConfig({ desktopSettings: invalidDesktopSettings })).resolves.toMatchObject({
      desktopSettings: {},
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
      desktopSettings: {},
    });
    expect(normalized.desktopSettings?.interfaceLanguage).toBeUndefined();
  });

  it('preserves hidden workspace dependency settings until the Feature retires them', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    await store.saveConfig({});
    const configPath = path.join(dataDir, 'config.json');
    const legacy = JSON.parse(await readFile(configPath, 'utf8')) as {
      desktopSettings?: Record<string, unknown>;
    };
    legacy.desktopSettings = {
      npmRegistryUrl: '  https://registry.example/npm/  ',
      pythonPackageIndexUrl: '  https://mirror.example/simple  ',
      workspaceDependenciesEnabled: true,
    };
    await writeFile(configPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

    await expect(store.getConfig()).resolves.toMatchObject({ desktopSettings: {} });
    await store.saveConfig({ globalPrompt: 'preserve pending migration' });
    await expect(store.workspaceDependenciesLegacySettingsAdapter().read()).resolves.toEqual({
      npmRegistryUrl: 'https://registry.example/npm/',
      pythonPackageIndexUrl: 'https://mirror.example/simple',
    });

    await store.workspaceDependenciesLegacySettingsAdapter().retire();
    await store.saveConfig({ globalPrompt: 'do not resurrect retired settings' });
    const retired = JSON.parse(await readFile(configPath, 'utf8')) as {
      desktopSettings?: Record<string, unknown>;
    };
    expect(retired.desktopSettings).not.toHaveProperty('npmRegistryUrl');
    expect(retired.desktopSettings).not.toHaveProperty('pythonPackageIndexUrl');
    expect(retired.desktopSettings).not.toHaveProperty('workspaceDependenciesEnabled');
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

  it('persists an explicitly cleared provider display name', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));
    const initial = await store.getConfig();
    const baseProvider = initial.providers[0];
    if (!baseProvider) throw new Error('Expected the default provider fixture.');

    await expect(store.saveConfig({
      providers: [{ ...baseProvider, name: '' }],
    })).resolves.toMatchObject({
      providers: [{ id: baseProvider.id, name: '' }],
    });
    await expect(store.getConfig()).resolves.toMatchObject({
      providers: [{ id: baseProvider.id, name: '' }],
    });
  });

  it('persists and explicitly detaches a Pi catalog provider identity', async () => {
    const store = new FileConfigStore(await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-')));
    const initial = await store.getConfig();
    const baseProvider = initial.providers[0];
    if (!baseProvider) throw new Error('Expected the default provider fixture.');

    await expect(store.saveConfig({
      providers: [{ ...baseProvider, catalogProviderId: 'deepseek' }],
    })).resolves.toMatchObject({
      providers: [{ id: baseProvider.id, catalogProviderId: 'deepseek' }],
    });
    await expect(store.getConfig()).resolves.toMatchObject({
      providers: [{ id: baseProvider.id, catalogProviderId: 'deepseek' }],
    });

    const detached = await store.saveConfig({
      providers: [{ ...baseProvider, catalogProviderId: null }],
    });
    expect(detached.providers[0]).toHaveProperty('catalogProviderId', null);
    await expect(store.getConfig()).resolves.toMatchObject({
      providers: [{ id: baseProvider.id, catalogProviderId: null }],
    });
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

  it('exposes and retires the legacy vision model selection without projecting it into root config', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-config-store-test-'));
    const store = new FileConfigStore(dataDir);
    await store.saveConfig({});
    const configPath = path.join(dataDir, 'config.json');
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    stored.visionRecognition = {
      providerId: ' vision-provider ',
      modelId: ' vision-model ',
    };
    await writeFile(configPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');

    const adapter = store.visionRecognitionLegacySettingsAdapter();
    await expect(adapter.read()).resolves.toEqual({
      providerId: 'vision-provider',
      modelId: 'vision-model',
    });
    expect(await store.getConfig()).not.toHaveProperty('visionRecognition');
    expect(await readFile(path.join(dataDir, 'secrets.json'), 'utf8')).not.toContain('vision');
    await adapter.retire();
    expect(await readFile(configPath, 'utf8')).not.toContain('"visionRecognition"');
  });
});
