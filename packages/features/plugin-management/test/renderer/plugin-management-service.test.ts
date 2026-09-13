import type { RuntimePluginInstallResult, RuntimePluginUiActionInput } from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import type {
  PluginManagementHook,
  PluginManagementHookSnapshot,
  PluginManagementSnapshot,
} from '../../src/contracts/index.js';
import type { PluginManagementClient } from '../../src/renderer/client.js';
import { RendererPluginManagementService } from '../../src/renderer/index.js';

describe('RendererPluginManagementService', () => {
  it('publishes a refreshed repository even when navigation reads the old cache during the download', async () => {
    const downloaded = deferred<PluginManagementSnapshot>();
    const cached = snapshot('cached');
    const refreshed = snapshot('refreshed');
    const readSnapshot = vi.fn().mockResolvedValueOnce(cached).mockResolvedValueOnce(cached).mockResolvedValueOnce(refreshed);
    const client = { readSnapshot, refreshMarketplace: vi.fn(() => downloaded.promise) } as unknown as PluginManagementClient;
    const scope = createFeatureScope({ featureId: 'plugin-management', process: 'renderer', scopeId: 'repository-refresh-test' });
    scope.activate();
    const service = new RendererPluginManagementService({ bridge: null, client, scope: scope.scope });
    const refresh = service.refresh({ refreshRepositories: true });
    await service.refresh();
    expect(service.getSnapshot()).toEqual(cached);
    downloaded.resolve(refreshed);
    await refresh;
    expect(service.getSnapshot()).toEqual(refreshed);
    await scope.finishDispose();
  });

  it('publishes local plugins and completes their installation while a repository refresh is pending or fails', async () => {
    const downloaded = deferred<PluginManagementSnapshot>();
    const published = deferred<void>();
    const cached = { ...snapshot('local'), marketplace: [{ id: 'bundled' }] as PluginManagementSnapshot['marketplace'] };
    const installed = { ...cached, plugins: [{ id: 'installed-locally' }] as PluginManagementSnapshot['plugins'] };
    const result = { plugin: { id: 'installed-locally' } } as RuntimePluginInstallResult;
    const client = {
      readSnapshot: vi.fn().mockResolvedValueOnce(cached).mockResolvedValueOnce(installed),
      refreshMarketplace: vi.fn(() => downloaded.promise),
      installMarketplace: vi.fn(async () => result),
      readHooks: vi.fn(async () => ({ hooks: [] })),
    } as unknown as PluginManagementClient;
    const scope = createFeatureScope({ featureId: 'plugin-management', process: 'renderer', scopeId: 'independent-repository-test' });
    scope.activate();
    const service = new RendererPluginManagementService({ bridge: null, client, scope: scope.scope });
    const unsubscribe = service.subscribe(() => published.resolve());
    const refresh = service.refresh({ refreshRepositories: true });
    const failed = expect(refresh).rejects.toThrow('Repository offline');
    await published.promise;
    unsubscribe();
    expect(service.getSnapshot()).toEqual(cached);
    await expect(service.installMarketplace({ pluginId: 'bundled' })).resolves.toBe(result);
    expect(service.getSnapshot()).toEqual(installed);
    downloaded.reject(new Error('Repository offline'));
    await failed;
    expect(service.getSnapshot()).toEqual(installed);
    await scope.finishDispose();
  });

  it('keeps the newest overlapping refresh and refreshes after native installation', async () => {
    const first = deferred<PluginManagementSnapshot>();
    const second = deferred<PluginManagementSnapshot>();
    const installedSnapshot = snapshot('installed');
    const extensions = [{
      events: [],
      pluginId: 'installed',
      state: 'running',
      tools: [],
    }] as PluginManagementSnapshot['extensions'];
    const readSnapshot = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockResolvedValueOnce(installedSnapshot);
    const readExtensions = vi.fn(async () => ({
      catalogRevision: installedSnapshot.catalogRevision,
      extensions,
    }));
    const readInstalled = vi.fn(async () => ({
      plugins: [{ id: 'updated-installed' }] as PluginManagementSnapshot['plugins'],
    }));
    const readHooks = vi.fn(async () => ({ hooks: [] }));
    const client = {
      readExtensions,
      readHooks,
      readInstalled,
      readSnapshot,
    } as unknown as PluginManagementClient;
    const installResult = {
      installedMcpServers: [],
      plugin: { id: 'installed' },
      reusedMcpServers: [],
    } as unknown as RuntimePluginInstallResult;
    const bridge = { installLocal: vi.fn(async () => installResult) };
    const scope = createFeatureScope({
      featureId: 'plugin-management',
      process: 'renderer',
      scopeId: 'plugin-management-renderer-test',
    });
    scope.activate();
    const service = new RendererPluginManagementService({ bridge, client, scope: scope.scope });
    const listener = vi.fn();
    service.subscribe(listener);

    const olderRefresh = service.refresh();
    const newerRefresh = service.refresh();
    second.resolve(snapshot('newer'));
    await newerRefresh;
    first.resolve(snapshot('older'));
    await olderRefresh;

    expect(service.getSnapshot().plugins[0]?.id).toBe('newer');
    await expect(service.installLocal()).resolves.toBe(installResult);
    expect(service.getSnapshot()).toEqual(installedSnapshot);
    await expect(service.refreshExtensions()).resolves.toEqual({
      catalogRevision: installedSnapshot.catalogRevision,
      extensions,
    });
    expect(service.getSnapshot()).toMatchObject({
      extensions,
      plugins: [{ id: 'installed' }],
    });
    await service.refreshInstalled();
    expect(service.getSnapshot()).toMatchObject({
      extensions,
      plugins: [{ id: 'updated-installed' }],
    });
    expect(readSnapshot).toHaveBeenCalledTimes(3);
    expect(readHooks).toHaveBeenCalledTimes(1);
    expect(readExtensions).toHaveBeenCalledTimes(1);
    expect(readInstalled).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(5);

    await scope.finishDispose();
  });

  it('merges newer domain refreshes without discarding a pending full snapshot', async () => {
    const fullSnapshot = deferred<PluginManagementSnapshot>();
    const extensionStatuses = deferred<Readonly<{
      catalogRevision: string;
      extensions: PluginManagementSnapshot['extensions'];
    }>>();
    const installedPlugins = deferred<Readonly<{
      plugins: PluginManagementSnapshot['plugins'];
    }>>();
    const client = {
      readExtensions: vi.fn(() => extensionStatuses.promise),
      readInstalled: vi.fn(() => installedPlugins.promise),
      readSnapshot: vi.fn(() => fullSnapshot.promise),
    } as unknown as PluginManagementClient;
    const scope = createFeatureScope({
      featureId: 'plugin-management',
      process: 'renderer',
      scopeId: 'plugin-management-cross-refresh-test',
    });
    scope.activate();
    const service = new RendererPluginManagementService({ bridge: null, client, scope: scope.scope });

    const fullRefresh = service.refresh();
    const extensionRefresh = service.refreshExtensions();
    const installedRefresh = service.refreshInstalled();
    const extensions = [{
      events: [],
      pluginId: 'extension-only',
      state: 'running',
      tools: [],
    }] as PluginManagementSnapshot['extensions'];
    extensionStatuses.resolve({ catalogRevision: '__uninitialized__', extensions });
    installedPlugins.resolve({
      plugins: [{ id: 'updated-installed' }] as PluginManagementSnapshot['plugins'],
    });
    await Promise.all([extensionRefresh, installedRefresh]);
    fullSnapshot.resolve(snapshot('stale-installed'));
    await fullRefresh;

    expect(service.getSnapshot()).toMatchObject({
      extensions,
      plugins: [{ id: 'updated-installed' }],
    });

    await scope.finishDispose();
  });

  it('reloads the complete catalog when the runtime revision changes outside the current thread', async () => {
    const initialSnapshot = snapshot('initial', 'catalog-1');
    const changedSnapshot = snapshot('installed-by-child', 'catalog-2');
    const readSnapshot = vi.fn()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(changedSnapshot);
    const readExtensions = vi.fn(async () => ({
      catalogRevision: 'catalog-2',
      extensions: [],
    }));
    const client = { readExtensions, readSnapshot } as unknown as PluginManagementClient;
    const scope = createFeatureScope({
      featureId: 'plugin-management',
      process: 'renderer',
      scopeId: 'plugin-management-catalog-revision-test',
    });
    scope.activate();
    const service = new RendererPluginManagementService({ bridge: null, client, scope: scope.scope });

    await service.refresh();
    await service.refreshExtensions();

    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toEqual(changedSnapshot);

    await scope.finishDispose();
  });

  it('does not let an older Hook refresh overwrite a completed mutation', async () => {
    const staleRefresh = deferred<PluginManagementHookSnapshot>();
    const hook = pluginHook({ enabled: true });
    const mutatedHook = pluginHook({ enabled: false });
    const setHookState = vi.fn(async () => ({ hooks: [mutatedHook] }));
    const client = {
      readHooks: vi.fn(() => staleRefresh.promise),
      setHookState,
    } as unknown as PluginManagementClient;
    const scope = createFeatureScope({
      featureId: 'plugin-management',
      process: 'renderer',
      scopeId: 'plugin-management-hook-refresh-test',
    });
    scope.activate();
    const service = new RendererPluginManagementService({ bridge: null, client, scope: scope.scope });

    const refresh = service.refreshHooks({ cwd: '/workspace/demo' });
    await service.setHookEnabled(hook, false);
    staleRefresh.resolve({ hooks: [hook] });
    await refresh;

    expect(setHookState).toHaveBeenCalledWith({
      currentHash: hook.currentHash,
      cwd: '/workspace/demo',
      enabled: false,
      managementId: hook.managementId,
    }, expect.anything());
    expect(service.getHookSnapshot()).toEqual({ hooks: [mutatedHook] });

    await scope.finishDispose();
  });

  it('invalidates Renderer UI data for the acting Plugin after every settled action', async () => {
    const input = {
      actionId: 'weather.refresh',
      context: { contributionId: 'weather.page', surface: 'renderer.plugin.page' },
      pluginId: 'weather',
      values: {},
    } satisfies RuntimePluginUiActionInput;
    const runRendererUiAction = vi.fn()
      .mockResolvedValueOnce({ status: 'completed' })
      .mockRejectedValueOnce(new Error('action failed'));
    const client = { runRendererUiAction } as unknown as PluginManagementClient;
    const scope = createFeatureScope({
      featureId: 'plugin-management',
      process: 'renderer',
      scopeId: 'plugin-management-ui-data-invalidation-test',
    });
    scope.activate();
    const service = new RendererPluginManagementService({ bridge: null, client, scope: scope.scope });
    const weatherListener = vi.fn();
    const otherListener = vi.fn();
    const unsubscribe = service.subscribeRendererUiData('weather', weatherListener);
    service.subscribeRendererUiData('other-plugin', otherListener);

    await expect(service.runRendererUiAction(input)).resolves.toEqual({ status: 'completed' });
    expect(weatherListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();

    await expect(service.runRendererUiAction(input)).rejects.toThrow('action failed');
    expect(weatherListener).toHaveBeenCalledTimes(2);
    unsubscribe();

    await scope.finishDispose();
  });
});

function snapshot(pluginId: string, catalogRevision = `revision:${pluginId}`): PluginManagementSnapshot {
  return {
    catalogRevision,
    extensions: [],
    marketplace: [],
    marketplaceErrors: [],
    plugins: [{ id: pluginId }] as PluginManagementSnapshot['plugins'],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function pluginHook(patch: Partial<PluginManagementHook> = {}): PluginManagementHook {
  return {
    command: null,
    currentHash: 'current-hash',
    displayOrder: 0,
    enabled: true,
    eventName: 'preToolUse',
    handlerType: 'command',
    isManaged: true,
    managementId: 'hook-id',
    matcher: 'shell',
    pluginHookId: 'guard-shell',
    pluginId: 'guard',
    source: 'plugin',
    statusMessage: null,
    timeoutSec: 30,
    trustStatus: 'managed',
    ...patch,
  };
}
