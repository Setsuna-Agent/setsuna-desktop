import type {
  RuntimeExtensionStatus,
  RuntimePluginMarketplaceItem,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';

export type PluginManagementSnapshot = Readonly<{
  catalogRevision: string;
  extensions: readonly RuntimeExtensionStatus[];
  marketplace: readonly RuntimePluginMarketplaceItem[];
  marketplaceErrors: readonly string[];
  plugins: readonly RuntimePluginSummary[];
}>;

export type PluginManagementExtensionSnapshot = Readonly<{
  catalogRevision: string;
  extensions: readonly RuntimeExtensionStatus[];
}>;

export type PluginManagementPluginTarget = Readonly<{
  pluginId: string;
}>;

export type PluginManagementExtensionTrustInput = PluginManagementPluginTarget & Readonly<{
  trusted: boolean;
}>;

export type PluginManagementItemTarget = PluginManagementPluginTarget & Readonly<{
  itemId: string;
  kind: 'skill' | 'mcp' | 'hook' | 'resource';
}>;

export type PluginManagementLocalInstallInput = Readonly<{
  path: string;
}>;
