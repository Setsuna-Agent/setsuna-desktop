import type { RuntimeMcpTransport } from './mcp.js';
import type { RuntimeHookEventName } from './config.js';

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

/** Safe marketplace projection of a plugin Hook. Executable commands stay inside the runtime. */
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

/** Bounded, renderer-safe projection of a regular file inside a plugin bundle. */
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
  /** Renderer-owned icon token. Plugin bundles cannot provide markup or filesystem paths. */
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
