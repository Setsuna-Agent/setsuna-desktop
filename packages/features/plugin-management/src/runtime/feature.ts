import { requiredCapability } from '@setsuna-desktop/feature-core/capability';
import { FeatureOperationFailure } from '@setsuna-desktop/feature-core/operation';
import { FeatureOperationCancelledError } from '@setsuna-desktop/feature-core/status';
import {
  defineRuntimeDependencies,
  defineRuntimeFeature,
  runtimeRouteRegistrarCapability,
} from '@setsuna-desktop/feature-core/runtime';
import {
  deleteStandalonePluginHook,
  installLocalPlugin,
  installMarketplacePlugin,
  pluginManagementFeature,
  pluginManagementRuntimeHostCapability,
  readInstalledPlugins,
  readInstalledPluginItem,
  readPluginExtensionStatuses,
  readMarketplacePluginItem,
  readInstalledPluginRendererUiState,
  readPluginManagementSnapshot,
  readPluginHooks,
  removeInstalledPlugin,
  runInstalledPluginRendererUiAction,
  setInstalledPluginExtensionTrust,
  setPluginHookState,
  type PluginManagementRuntimeHost,
  updateMarketplacePlugin,
} from '../contracts/index.js';

const dependencies = defineRuntimeDependencies({
  host: requiredCapability(pluginManagementRuntimeHostCapability),
  routes: requiredCapability(runtimeRouteRegistrarCapability),
});

export const pluginManagementRuntimeFeature = defineRuntimeFeature({
  definition: pluginManagementFeature,
  dependencies,
  setup(context) {
    const { host, routes } = context.dependencies;

    routes.register(context.scope, readPluginManagementSnapshot, async () => {
      const catalogRevision = await host.catalogRevision();
      const [plugins, marketplace, extensions] = await Promise.all([
        host.listPlugins(),
        host.listMarketplace(),
        host.listExtensions(),
      ]);
      return Object.freeze({
        catalogRevision,
        extensions: Object.freeze([...extensions.extensions]),
        marketplace: Object.freeze([...marketplace.plugins]),
        marketplaceErrors: Object.freeze([...marketplace.errors]),
        plugins: Object.freeze([...plugins.plugins]),
      });
    });
    routes.register(context.scope, readPluginExtensionStatuses, async () => {
      const [catalogRevision, extensions] = await Promise.all([
        host.catalogRevision(),
        host.listExtensions(),
      ]);
      return Object.freeze({
        catalogRevision,
        extensions: Object.freeze([...extensions.extensions]),
      });
    });
    routes.register(context.scope, readInstalledPlugins, () => host.listPlugins());
    routes.register(context.scope, readPluginHooks, (input) => host.listHooks(input));
    routes.register(context.scope, readInstalledPluginItem, (input) => (
      preservePluginOperationError(() => host.getInstalledItem(input))
    ));
    routes.register(context.scope, readMarketplacePluginItem, (input) => (
      preservePluginOperationError(() => host.getMarketplaceItem(input))
    ));
    routes.register(context.scope, installLocalPlugin, (input) => (
      preservePluginOperationError(() => host.installLocal(input))
    ));
    routes.register(context.scope, installMarketplacePlugin, (input) => (
      preservePluginOperationError(() => host.installMarketplace(input))
    ));
    routes.register(context.scope, updateMarketplacePlugin, (input) => (
      preservePluginOperationError(() => host.updateMarketplace(input))
    ));
    routes.register(context.scope, removeInstalledPlugin, (input) => (
      preservePluginOperationError(() => host.remove(input))
    ));
    routes.register(context.scope, readInstalledPluginRendererUiState, (input) => (
      preservePluginOperationError(() => host.readRendererUiState(input))
    ));
    routes.register(context.scope, runInstalledPluginRendererUiAction, (input, operation) => (
      preservePluginOperationError(
        () => host.runRendererUiAction(input, operation.signal),
        operation.signal,
      )
    ));
    routes.register(context.scope, setInstalledPluginExtensionTrust, (input) => (
      preservePluginOperationError(() => host.setExtensionTrust(input))
    ));
    routes.register(context.scope, setPluginHookState, async (input) => (
      pluginHookMutationResult(await host.setHookState(input))
    ));
    routes.register(context.scope, deleteStandalonePluginHook, async (input) => (
      pluginHookMutationResult(await host.deleteStandaloneHook(input))
    ));
  },
});

function pluginHookMutationResult(
  result: Awaited<ReturnType<PluginManagementRuntimeHost['setHookState']>>,
) {
  if (result.status === 'updated') return result.snapshot;
  if (result.status === 'not-found') {
    throw new FeatureOperationFailure({
      code: 'PLUGIN_HOOK_NOT_FOUND',
      message: 'Hook no longer exists.',
      retryable: false,
    });
  }
  if (result.status === 'changed') {
    throw new FeatureOperationFailure({
      code: 'PLUGIN_HOOK_CHANGED',
      message: 'Hook command changed after it was loaded. Refresh and review it again.',
      retryable: false,
    });
  }
  if (result.status === 'not-manageable') {
    throw new FeatureOperationFailure({
      code: 'PLUGIN_HOOK_NOT_MANAGEABLE',
      message: 'This Hook is managed by its source and cannot be changed here.',
      retryable: false,
    });
  }
  throw new FeatureOperationFailure({
    code: 'PLUGIN_HOOK_NOT_STANDALONE',
    message: 'Only standalone user Hooks can be deleted here.',
    retryable: false,
  });
}

async function preservePluginOperationError<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new FeatureOperationCancelledError();
    }
    if (error instanceof FeatureOperationFailure) throw error;
    throw new FeatureOperationFailure({
      code: 'PLUGIN_OPERATION_FAILED',
      message: error instanceof Error && error.message.trim()
        ? error.message
        : 'Plugin operation failed.',
      retryable: false,
    });
  }
}
