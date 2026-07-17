import type {
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginInstallResult,
  RuntimePluginMarketplaceList,
} from '@setsuna-desktop/contracts';

export type PluginMarketplace = {
  listPlugins(): Promise<RuntimePluginMarketplaceList>;
  readItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string): Promise<RuntimePluginItemContent>;
  installPlugin(pluginId: string): Promise<RuntimePluginInstallResult>;
};
