import type { FeatureOperationTransport } from '@setsuna-desktop/feature-core/operation';
import {
  installMarketplacePlugin,
  readInstalledPlugins,
  readInstalledPluginItem,
  readPluginExtensionStatuses,
  readMarketplacePluginItem,
  readPluginManagementSnapshot,
  removeInstalledPlugin,
  setInstalledPluginExtensionTrust,
  updateMarketplacePlugin,
  type PluginManagementExtensionTrustInput,
  type PluginManagementItemTarget,
  type PluginManagementPluginTarget,
} from '../contracts/index.js';

export function createPluginManagementClient(transport: FeatureOperationTransport) {
  return Object.freeze({
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
    readExtensions: (options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(readPluginExtensionStatuses, undefined, options)
    ),
    readSnapshot: (options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(readPluginManagementSnapshot, undefined, options)
    ),
    remove: (input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(removeInstalledPlugin, input, options)
    ),
    setExtensionTrust: (
      input: PluginManagementExtensionTrustInput,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => transport.call(setInstalledPluginExtensionTrust, input, options),
    updateMarketplace: (input: PluginManagementPluginTarget, options?: Readonly<{ signal?: AbortSignal }>) => (
      transport.call(updateMarketplacePlugin, input, options)
    ),
  });
}

export type PluginManagementClient = ReturnType<typeof createPluginManagementClient>;
