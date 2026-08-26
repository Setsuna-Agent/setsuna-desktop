import type { RuntimePluginInstallResult } from '@setsuna-desktop/contracts';
import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import type { PluginManagementSnapshot } from '../../src/contracts/index.js';
import type { PluginManagementClient } from '../../src/renderer/client.js';
import { RendererPluginManagementService } from '../../src/renderer/index.js';

describe('RendererPluginManagementService', () => {
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
    const client = { readExtensions, readInstalled, readSnapshot } as unknown as PluginManagementClient;
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
    expect(readExtensions).toHaveBeenCalledTimes(1);
    expect(readInstalled).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(4);

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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
