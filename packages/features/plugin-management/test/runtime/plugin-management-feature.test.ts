import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { describe, expect, it, vi } from 'vitest';
import {
  installLocalPlugin,
  pluginManagementFeature,
  readInstalledPlugins,
  readPluginExtensionStatuses,
  readPluginManagementSnapshot,
  updateMarketplacePlugin,
  type PluginManagementRuntimeHost,
} from '../../src/contracts/index.js';
import { pluginManagementRuntimeFeature } from '../../src/runtime/index.js';

describe('plugin management runtime feature', () => {
  it('owns the aggregate management snapshot and main-only local install operation', async () => {
    const installLocal = vi.fn(async () => ({
      installedMcpServers: [],
      plugin: { id: 'local-plugin' },
      reusedMcpServers: [],
    }));
    const updateMarketplace = vi.fn(async () => {
      throw new Error('Marketplace plugin update is not available: local-plugin');
    });
    const host = {
      catalogRevision: vi.fn(async () => 'catalog-1'),
      getInstalledItem: vi.fn(),
      getMarketplaceItem: vi.fn(),
      installLocal,
      installMarketplace: vi.fn(),
      listExtensions: vi.fn(async () => ({ extensions: [] })),
      listMarketplace: vi.fn(async () => ({ errors: ['catalog warning'], plugins: [] })),
      listPlugins: vi.fn(async () => ({ plugins: [] })),
      remove: vi.fn(),
      setExtensionTrust: vi.fn(),
      updateMarketplace,
    } as unknown as PluginManagementRuntimeHost;
    const routes = new Map<string, (input: unknown) => unknown | PromiseLike<unknown>>();
    const scope = createFeatureScope({
      featureId: pluginManagementFeature.id,
      process: 'runtime',
      scopeId: 'plugin-management-feature-test',
    });

    await pluginManagementRuntimeFeature.setup({
      dependencies: {
        host,
        routes: {
          register(_scope, operation, handler) {
            routes.set(operation.id, (input) => handler(input as never, {
              signal: new AbortController().signal,
            }));
            return Object.freeze({ dispose() {} });
          },
        },
      },
      health: { setCondition() {} },
      provide() {},
      scope: scope.scope,
    });

    await expect(routes.get(readPluginManagementSnapshot.id)?.(undefined)).resolves.toEqual({
      catalogRevision: 'catalog-1',
      extensions: [],
      marketplace: [],
      marketplaceErrors: ['catalog warning'],
      plugins: [],
    });
    await expect(routes.get(readPluginExtensionStatuses.id)?.(undefined)).resolves.toEqual({
      catalogRevision: 'catalog-1',
      extensions: [],
    });
    await expect(routes.get(readInstalledPlugins.id)?.(undefined)).resolves.toEqual({
      plugins: [],
    });
    await expect(routes.get(installLocalPlugin.id)?.({ path: '/tmp/local-plugin' })).resolves.toMatchObject({
      plugin: { id: 'local-plugin' },
    });
    expect(installLocal).toHaveBeenCalledWith({ path: '/tmp/local-plugin' });
    expect(installLocalPlugin.path.startsWith('/v1/features/plugin-management/')).toBe(true);
    await expect(routes.get(updateMarketplacePlugin.id)?.({ pluginId: 'local-plugin' })).rejects.toMatchObject({
      code: 'PLUGIN_OPERATION_FAILED',
      message: 'Marketplace plugin update is not available: local-plugin',
      retryable: false,
    });

    await scope.finishDispose();
  });
});
