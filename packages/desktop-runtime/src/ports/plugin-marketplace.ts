import type {
  RuntimePluginInstallResult,
  RuntimePluginMarketplaceList,
} from '@setsuna-desktop/contracts';

export type PluginMarketplace = {
  listPlugins(): Promise<RuntimePluginMarketplaceList>;
  installPlugin(pluginId: string): Promise<RuntimePluginInstallResult>;
};
