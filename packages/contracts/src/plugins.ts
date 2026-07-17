import type { RuntimeMcpTransport } from './mcp.js';
import type { RuntimeHookEventName } from './config.js';

/** 与 runtime 活动一同存储、可安全提供给渲染进程的稳定归属信息。 */
export type RuntimePluginReference = {
  id: string;
  name: string;
  icon?: string;
};

export type RuntimePluginSkill = {
  id: string;
  name: string;
  description?: string;
};

export type RuntimePluginMcpServerDescriptor = {
  key: string;
  label: string;
  description?: string;
  transport: RuntimeMcpTransport;
};

export type RuntimePluginMcpServer = RuntimePluginMcpServerDescriptor & {
  owned: boolean;
};

/** 插件 Hook 在市场中的安全投影；可执行命令始终留在 runtime 内部。 */
export type RuntimePluginHook = {
  id: string;
  name: string;
  description?: string;
  eventName: RuntimeHookEventName;
  matcher?: string;
  statusMessage?: string;
};

export type RuntimePluginResource = {
  id: string;
  label: string;
  path: string;
  size: number;
};

export type RuntimePluginItemKind = 'skill' | 'mcp' | 'hook' | 'resource';

/** 插件包内普通文件的受限投影，可安全提供给渲染进程。 */
export type RuntimePluginFilePreview = {
  path: string;
  size: number;
  mimeType: string;
  text?: string;
  base64?: string;
};

export type RuntimePluginItemContent = {
  pluginId: string;
  itemId: string;
  kind: RuntimePluginItemKind;
  files: RuntimePluginFilePreview[];
};

export type RuntimePluginSummary = {
  id: string;
  name: string;
  /** 由渲染进程管理的图标令牌；插件包不能提供标记或文件系统路径。 */
  icon?: string;
  version?: string;
  description?: string;
  publisher?: string;
  tags?: string[];
  installedAt: string;
  skills: RuntimePluginSkill[];
  mcpServers: RuntimePluginMcpServer[];
  hooks: RuntimePluginHook[];
  hookCount: number;
  resources: RuntimePluginResource[];
};

export type RuntimePluginList = {
  plugins: RuntimePluginSummary[];
};

export type RuntimePluginMarketplaceItem = {
  id: string;
  name: string;
  icon?: string;
  version?: string;
  description?: string;
  publisher?: string;
  tags: string[];
  featured: boolean;
  skills: RuntimePluginSkill[];
  mcpServers: RuntimePluginMcpServerDescriptor[];
  hooks: RuntimePluginHook[];
  resources: RuntimePluginResource[];
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
  /** 包含 .setsuna-plugin/plugin.json 的本地插件包绝对路径。 */
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
