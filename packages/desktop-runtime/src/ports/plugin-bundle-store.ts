import type {
  RuntimeExtensionManifest,
  RuntimeMcpServerInput,
  RuntimePluginInstallInput,
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginItemKind,
  RuntimePluginList,
  RuntimePluginMarketplaceItem,
  RuntimePluginRemoveResult,
  RuntimePluginSummary,
} from '@setsuna-desktop/contracts';

export type InstalledPluginExtensionRecord = RuntimeExtensionManifest & {
  entry: string;
  bundleHash: string;
  trustedHash?: string;
};

export type InstalledPluginRecord = Omit<RuntimePluginSummary, 'extension'> & {
  sourcePath: string;
  installPath: string;
  manifestPath: string;
  skillEntries: Array<{ id: string; relativePath: string }>;
  mcpServerInputs: RuntimeMcpServerInput[];
  extension?: InstalledPluginExtensionRecord;
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
  /** Records whether the installed snapshot came from the bundled catalog or a local bundle. */
  installationSource?: 'local' | 'marketplace';
  /**
   * 仅供已经校验过应用内置目录，或把完整生成内容绑定到显式用户审批的调用方使用。
   * 普通“选择目录安装”不能隐式升级为执行其中任意 Hook 命令的授权。
   */
  trustHooks?: boolean;
  /** Trust the exact staged bundle hash after a controlled-source check or content-bound approval. */
  trustExtension?: boolean;
};

export type PluginRuntimeMutationCoordinator = {
  beginPluginMutation(pluginId: string): Promise<() => Promise<void>>;
};

export type PluginBundleStore = {
  listPlugins(): Promise<RuntimePluginList>;
  inspectPlugin(input: RuntimePluginInstallInput): Promise<PluginBundleInspection>;
  installPlugin(input: RuntimePluginInstallInput, options?: PluginBundleMutationOptions): Promise<RuntimePluginInstallResult>;
  updatePlugin(input: RuntimePluginInstallInput, options?: PluginBundleMutationOptions): Promise<RuntimePluginInstallResult>;
  removePlugin(pluginId: string): Promise<RuntimePluginRemoveResult>;
  setExtensionTrust(pluginId: string, trusted: boolean): Promise<RuntimePluginList>;
  listInstalledRecords(): Promise<InstalledPluginRecord[]>;
  readResource(pluginId: string, resourceId: string): Promise<PluginResourceRead>;
  readItemContent(pluginId: string, kind: RuntimePluginItemKind, itemId: string): Promise<RuntimePluginItemContent>;
  readBundleItemContent(input: RuntimePluginInstallInput, kind: RuntimePluginItemKind, itemId: string): Promise<RuntimePluginItemContent>;
};
