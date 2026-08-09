import type { InstalledPluginRecord, PluginBundleStore } from '../../ports/plugin-bundle-store.js';

export type MarketplacePluginStateStore = Pick<PluginBundleStore, 'listInstalledRecords'>;

/**
 * Built-in runtime tools are enabled only by the matching marketplace install.
 * Reading the persisted record avoids the bundle rehash required by the public
 * plugin list while preserving local bundles that happen to reuse a reserved id.
 */
export async function installedMarketplacePlugin(
  store: MarketplacePluginStateStore,
  pluginId: string,
): Promise<InstalledPluginRecord | undefined> {
  return (await store.listInstalledRecords()).find((plugin) =>
    plugin.id === pluginId && plugin.installationSource === 'marketplace');
}
