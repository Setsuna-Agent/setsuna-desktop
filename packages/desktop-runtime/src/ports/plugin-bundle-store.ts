import type {
  RuntimeMcpServerInput,
  RuntimePluginInstallInput,
  RuntimePluginInstallResult,
  RuntimePluginList,
  RuntimePluginMarketplaceItem,
  RuntimePluginRemoveResult,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';

export type InstalledPluginRecord = RuntimePluginSummary & {
  sourcePath: string;
  installPath: string;
  manifestPath: string;
  skillEntries: Array<{ id: string; relativePath: string }>;
  mcpServerInputs: RuntimeMcpServerInput[];
};

export type PluginResourceRead = {
  pluginId: string;
  resourceId: string;
  label: string;
  path: string;
  size: number;
  mimeType?: string;
  text?: string;
  base64?: string;
};

export type PluginBundleInspection = Omit<
  RuntimePluginMarketplaceItem,
  'installed' | 'installedVersion'
> & {
  sourcePath: string;
};

export type PluginBundleStore = {
  listPlugins(): Promise<RuntimePluginList>;
  inspectPlugin(input: RuntimePluginInstallInput): Promise<PluginBundleInspection>;
  installPlugin(input: RuntimePluginInstallInput): Promise<RuntimePluginInstallResult>;
  removePlugin(pluginId: string): Promise<RuntimePluginRemoveResult>;
  listInstalledRecords(): Promise<InstalledPluginRecord[]>;
  readResource(pluginId: string, resourceId: string): Promise<PluginResourceRead>;
};
