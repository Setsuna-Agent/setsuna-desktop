export type RuntimePluginSkill = {
  id: string;
  name: string;
};

export type RuntimePluginMcpServer = {
  key: string;
  owned: boolean;
};

export type RuntimePluginResource = {
  id: string;
  label: string;
  path: string;
  size: number;
};

export type RuntimePluginSummary = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  publisher?: string;
  tags?: string[];
  installedAt: string;
  skills: RuntimePluginSkill[];
  mcpServers: RuntimePluginMcpServer[];
  hookCount: number;
  resources: RuntimePluginResource[];
};

export type RuntimePluginList = {
  plugins: RuntimePluginSummary[];
};

export type RuntimePluginMarketplaceItem = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  publisher?: string;
  tags: string[];
  featured: boolean;
  capabilities: {
    skills: number;
    mcpServers: number;
    hooks: number;
    resources: number;
  };
  installed: boolean;
  installedVersion?: string;
};

export type RuntimePluginMarketplaceList = {
  plugins: RuntimePluginMarketplaceItem[];
  errors: string[];
};

export type RuntimePluginInstallInput = {
  /** Absolute path to a local bundle containing .setsuna-plugin/plugin.json. */
  path: string;
};

export type RuntimePluginInstallResult = {
  plugin: RuntimePluginSummary;
  installedMcpServers: string[];
  reusedMcpServers: string[];
};

export type RuntimePluginRemoveResult = {
  pluginId: string;
  removedMcpServers: string[];
  preservedMcpServers: string[];
};
