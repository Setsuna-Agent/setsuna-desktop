import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  deleteStandalonePluginHook,
  installMarketplacePlugin,
  readInstalledPlugins,
  readInstalledPluginItem,
  readInstalledPluginRendererUiState,
  readPluginExtensionStatuses,
  readMarketplacePluginItem,
  readPluginManagementSnapshot,
  readPluginHooks,
  removeInstalledPlugin,
  runInstalledPluginRendererUiAction,
  setPluginHookState,
  setInstalledPluginExtensionTrust,
  updateMarketplacePlugin,
  type PluginManagementExtensionTrustInput,
  type PluginManagementHookQuery,
  type PluginManagementHookStateInput,
  type PluginManagementHookTarget,
  type PluginManagementItemTarget,
  type PluginManagementPluginTarget,
} from '../contracts/index.js';
import type { RuntimePluginUiActionInput, RuntimePluginUiStateInput } from '@setsuna-desktop/contracts';

export function createPluginManagementClient(transport: FeatureOperationTransport) {
  return Object.freeze({
    deleteStandaloneHook: (
      input: PluginManagementHookTarget,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => transport.call(deleteStandalonePluginHook, input, options),
    getInstalledItem: (input: PluginManagementItemTarget, options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(readInstalledPluginItem, input, options)
    ),
    getMarketplaceItem: (input: PluginManagementItemTarget, options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(readMarketplacePluginItem, input, options)
    ),
    installMarketplace: (input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(installMarketplacePlugin, input, options)
    ),
    readInstalled: (options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(readInstalledPlugins, undefined, options)
    ),
    readRendererUiState: (
      input: RuntimePluginUiStateInput,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => transport.call(readInstalledPluginRendererUiState, input, options),
    readHooks: (input: PluginManagementHookQuery, options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(readPluginHooks, input, options)
    ),
    readExtensions: (options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(readPluginExtensionStatuses, undefined, options)
    ),
    readSnapshot: (options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(readPluginManagementSnapshot, undefined, options)
    ),
    remove: (input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(removeInstalledPlugin, input, options)
    ),
    runRendererUiAction: (
      input: RuntimePluginUiActionInput,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => transport.call(runInstalledPluginRendererUiAction, input, options),
    setExtensionTrust: (
      input: PluginManagementExtensionTrustInput,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => transport.call(setInstalledPluginExtensionTrust, input, options),
    setHookState: (
      input: PluginManagementHookStateInput,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => transport.call(setPluginHookState, input, options),
    updateMarketplace: (input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(updateMarketplacePlugin, input, options)
    ),
  });
}

export type PluginManagementClient = ReturnType<typeof createPluginManagementClient>;
