import type {
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginMarketplaceList,
} from '@setsuna-desktop/contracts';

export type PluginMarketplaceListOptions = {
  refreshRepositories?: boolean;
  /** False returns the known catalog while the repository's disk cache is loading. */
  waitForInitialization?: boolean;
};

export type PluginMarketplace = {
  listPlugins(options?: PluginMarketplaceListOptions): Promise<RuntimePluginMarketplaceList>;
  readItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string): Promise<RuntimePluginItemContent>;
  installPlugin(pluginId: string): Promise<RuntimePluginInstallResult>;
  updatePlugin(pluginId: string): Promise<RuntimePluginInstallResult>;
};
