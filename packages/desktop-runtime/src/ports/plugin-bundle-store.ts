import type {
  RuntimeMcpServerInput,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
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
  'installed' | 'installedVersion' | 'updateAvailable'
> & {
  /** 仅供内置市场排序使用，不投影给 renderer。 */
  featuredOrder?: number;
  sourcePath: string;
};

export type PluginBundleMutationOptions = {
  /**
   * 仅供已经校验过应用内置目录的调用方使用。普通本地插件必须保留手动信任，
   * 避免把“选择一个目录安装”隐式升级为执行其中任意 Hook 命令的授权。
   */
  trustHooks?: boolean;
};

export type PluginBundleStore = {
  listPlugins(): Promise<RuntimePluginList>;
  inspectPlugin(input: RuntimePluginInstallInput): Promise<PluginBundleInspection>;
  installPlugin(input: RuntimePluginInstallInput, options?: PluginBundleMutationOptions): Promise<RuntimePluginInstallResult>;
  updatePlugin(input: RuntimePluginInstallInput, options?: PluginBundleMutationOptions): Promise<RuntimePluginInstallResult>;
  removePlugin(pluginId: string): Promise<RuntimePluginRemoveResult>;
  listInstalledRecords(): Promise<InstalledPluginRecord[]>;
  readResource(pluginId: string, resourceId: string): Promise<PluginResourceRead>;
  readItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string): Promise<RuntimePluginItemContent>;
  readBundleItemContent(input: RuntimePluginInstallInput, kind: RuntimePluginItemKind, itemId: string): Promise<RuntimePluginItemContent>;
};
