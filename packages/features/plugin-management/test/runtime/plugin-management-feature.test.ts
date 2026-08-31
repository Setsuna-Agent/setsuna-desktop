import { createFeatureScope } from '@setsuna-desktop/feature-core/scope';
import { FeatureOperationCancelledError } from '@setsuna-desktop/feature-core/status';
import { describe, expect, it, vi } from 'vitest';
import {
  installLocalPlugin,
  pluginManagementFeature,
  readInstalledPlugins,
  readInstalledPluginRendererUiState,
  readPluginExtensionStatuses,
  readPluginHooks,
  readPluginManagementSnapshot,
  runInstalledPluginRendererUiAction,
  setPluginHookState,
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
    const readRendererUiState = vi.fn(async () => ({ values: { maxResults: '5' } }));
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
      listHooks: vi.fn(async () => ({ hooks: [] })),
      listMarketplace: vi.fn(async () => ({ errors: ['catalog warning'], plugins: [] })),
      listPlugins: vi.fn(async () => ({ plugins: [] })),
      readRendererUiState,
      deleteStandaloneHook: vi.fn(),
      remove: vi.fn(),
      setExtensionTrust: vi.fn(),
      setHookState: vi.fn(async () => ({ status: 'changed' as const })),
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
    await expect(routes.get(readInstalledPluginRendererUiState.id)?.({
      contributionId: 'preferences.settings',
      pluginId: 'web-search',
    })).resolves.toEqual({ values: { maxResults: '5' } });
    await expect(routes.get(readPluginHooks.id)?.({ cwd: '/tmp/workspace' })).resolves.toEqual({
      hooks: [],
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
    await expect(routes.get(setPluginHookState.id)?.({
      currentHash: 'old-hash',
      enabled: false,
      managementId: 'hook-id',
    })).rejects.toMatchObject({
      code: 'PLUGIN_HOOK_CHANGED',
      retryable: false,
    });

    await scope.finishDispose();
  });

  it('forwards route cancellation to Renderer UI actions without converting it to a plugin failure', async () => {
    const controller = new AbortController();
    const cancellation = new FeatureOperationCancelledError('Feature scope is draining.');
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const runRendererUiAction = vi.fn((_input, signal?: AbortSignal) => (
      new Promise<never>((_resolve, reject) => {
        notifyStarted();
        const cancel = () => reject(signal?.reason);
        if (signal?.aborted) cancel();
        else signal?.addEventListener('abort', cancel, { once: true });
      })
    ));
    const routes = new Map<string, (
      input: unknown,
      signal: AbortSignal,
    ) => unknown | PromiseLike<unknown>>();
    const scope = createFeatureScope({
      featureId: pluginManagementFeature.id,
      process: 'runtime',
      scopeId: 'plugin-management-action-cancellation-test',
    });

    await pluginManagementRuntimeFeature.setup({
      dependencies: {
        host: { runRendererUiAction } as unknown as PluginManagementRuntimeHost,
        routes: {
          register(_scope, operation, handler) {
            routes.set(operation.id, (input, signal) => handler(input as never, { signal }));
            return Object.freeze({ dispose() {} });
          },
        },
      },
      health: { setCondition() {} },
      provide() {},
      scope: scope.scope,
    });

    const input = {
      actionId: 'profile.save',
      context: {
        contributionId: 'profile.settings',
        surface: 'renderer.capabilities.plugin.details',
      },
      pluginId: 'worker-demo',
      values: { displayName: 'Setsuna' },
    } as const;
    const action = Promise.resolve(
      routes.get(runInstalledPluginRendererUiAction.id)?.(input, controller.signal),
    );
    await started;
    controller.abort(cancellation);

    await expect(action).rejects.toBe(cancellation);
    expect(runRendererUiAction).toHaveBeenCalledWith(input, controller.signal);
    await scope.finishDispose();
  });
});
