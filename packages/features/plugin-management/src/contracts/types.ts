import type {
  RuntimeExtensionStatus,
  RuntimeHookManagementProjection,
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

/** Safe renderer projection. Local config and managed Plugin paths never cross this boundary. */
export type PluginManagementHook = RuntimeHookManagementProjection;

export type PluginManagementHookSnapshot = Readonly<{
  hooks: readonly PluginManagementHook[];
}>;

export type PluginManagementHookQuery = Readonly<{
  cwd?: string;
}>;

export type PluginManagementHookTarget = PluginManagementHookQuery & Readonly<{
  currentHash: string;
  managementId: string;
}>;

export type PluginManagementHookStateInput = PluginManagementHookTarget & Readonly<{
  enabled?: boolean;
  trusted?: boolean;
}>;
