import type { RuntimeHookEventName } from './hooks.js';
import type { RuntimeMcpTransport } from './mcp.js';

export type { RuntimePluginReference } from './plugin-reference.js';

export const RUNTIME_EXTENSION_API_VERSION = 1 as const;

export const RUNTIME_EXTENSION_EVENT_NAMES = [
  'session.start',
  'prompt.before',
  'tool.before',
  'tool.after',
  'compact.before',
  'turn.settled',
] as const;

export type RuntimeExtensionEventName = typeof RUNTIME_EXTENSION_EVENT_NAMES[number];
export type RuntimeExtensionCapability =
  | 'tools'
  | 'events'
  | 'ui'
  | 'state'
  | 'network'
  | 'image-generation'
  | 'vision-recognition';
export type RuntimeExtensionNetworkPolicy = {
  /** Exact HTTP(S) origins that the host-managed network client may contact. */
  allowedOrigins: string[];
};
export type RuntimeExtensionManifest = {
  apiVersion: typeof RUNTIME_EXTENSION_API_VERSION;
  runtime: 'node-worker';
  capabilities: RuntimeExtensionCapability[];
  network?: RuntimeExtensionNetworkPolicy;
  /** Cards generated at runtime by declared tools; source stays in each tool result. */
  uiCards?: readonly import('./plugin-ui-card.js').RuntimePluginUiCardDeclaration[];
  rendererUi?: import('./plugin-ui.js').RuntimePluginUiManifest;
};
export type RuntimeExtensionTrustState = 'trusted' | 'untrusted' | 'modified';
export type RuntimeInstalledExtension = RuntimeExtensionManifest & { trust: RuntimeExtensionTrustState };
export type RuntimeExtensionProcessState = 'stopped' | 'starting' | 'running' | 'failed';
export type RuntimeExtensionRegisteredTool = { name: string; description: string };
export type RuntimeExtensionStatus = {
  pluginId: string;
  state: RuntimeExtensionProcessState;
  tools: RuntimeExtensionRegisteredTool[];
  events: RuntimeExtensionEventName[];
  error?: string;
};
export type RuntimeExtensionStatusList = { extensions: RuntimeExtensionStatus[] };
export type RuntimeExtensionTrustInput = { trusted: boolean };

export const OPENAI_IMAGE_GENERATION_PLUGIN_ID = 'openai-image-generation';
export const OPENAI_IMAGE_GENERATION_TOOL_NAME = 'generate_image';
export const OPENAI_VISION_RECOGNITION_PLUGIN_ID = 'openai-vision-recognition';
export const OPENAI_VISION_RECOGNITION_TOOL_NAME = 'analyze_image';
export const WEB_SEARCH_PLUGIN_ID = 'web-search';
export const WEB_SEARCH_TOOL_NAME = 'web_search';

export type RuntimePluginSkill = {
  id: string;
  name: string;
  description?: string;
};

/** 插件清单声明的 runtime 工具元数据；声明本身不会注册或执行工具。 */
export type RuntimePluginTool = {
  name: string;
  description?: string;
  /** Curated marketplace extensions may expose this stable name without an extension__ prefix. */
  exposure?: 'namespaced' | 'direct';
  /** Execution hints are honored only for extensions installed from the bundled marketplace. */
  supportsParallel?: boolean;
  requiresApproval?: boolean;
  requiresSandboxBypassApproval?: boolean;
};

export type RuntimePluginMcpServerDescriptor = {
  key: string;
  label: string;
  description?: string;
  transport: RuntimeMcpTransport;
  /** Credential variable name only; its value stays in the runtime. */
  bearerTokenEnvVar?: string;
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

/** Repository provenance contains public source coordinates, never local cache paths. */
export type RuntimePluginRepositorySource = {
  marketplaceId: string;
  url: string;
  path: string;
  revision: string;
  bundleHash?: string;
};

/** Inert image data for img elements only; never inject SVG markup into the DOM. */
export type RuntimePluginIconImage = { light: string; dark?: string };

export function isRuntimePluginIconDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 132 * 1024
    && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

export type RuntimePluginSummary = {
  id: string;
  name: string;
  /** 由渲染进程管理的图标令牌；插件包不能提供标记或文件系统路径。 */
  icon?: string;
  iconImage?: RuntimePluginIconImage;
  version?: string;
  description?: string;
  publisher?: string;
  /** Optional OpenAI Apps that the imported plugin declares but Setsuna cannot provide. */
  unsupportedApps?: string[];
  /** Supplemental definitions retained in the bundle but not registered by this host. */
  unsupportedComponents?: string[];
  connectors?: import('./plugin-connectors.js').RuntimePluginConnector[];
  tags?: string[];
  installedAt: string;
  /** Missing only on indexes written before installation provenance was recorded. */
  installationSource?: 'local' | 'marketplace' | 'repository';
  repository?: RuntimePluginRepositorySource;
  tools?: RuntimePluginTool[];
  skills: RuntimePluginSkill[];
  mcpServers: RuntimePluginMcpServer[];
  hooks: RuntimePluginHook[];
  hookCount: number;
  resources: RuntimePluginResource[];
  extension?: RuntimeInstalledExtension;
};

export type RuntimePluginList = {
  plugins: RuntimePluginSummary[];
};

export type RuntimePluginMarketplaceItem = {
  id: string;
  /** The bundle keeps its own id; the marketplace id is qualified by its source. */
  bundleId?: string;
  repository?: RuntimePluginRepositorySource;
  unavailableReason?: string;
  name: string;
  icon?: string;
  iconImage?: RuntimePluginIconImage;
  version?: string;
  description?: string;
  publisher?: string;
  unsupportedApps?: string[];
  unsupportedComponents?: string[];
  connectors?: import('./plugin-connectors.js').RuntimePluginConnector[];
  tags: string[];
  featured: boolean;
  tools?: RuntimePluginTool[];
  skills: RuntimePluginSkill[];
  mcpServers: RuntimePluginMcpServerDescriptor[];
  hooks: RuntimePluginHook[];
  resources: RuntimePluginResource[];
  extension?: RuntimeExtensionManifest;
  capabilities: {
    skills: number;
    mcpServers: number;
    hooks: number;
    resources: number;
    tools?: number;
    extension?: number;
  };
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
};

export type RuntimePluginMarketplaceList = {
  plugins: RuntimePluginMarketplaceItem[];
  errors: string[];
};

export type RuntimePluginInstallInput = {
  /** 包含 .setsuna-plugin/plugin.json 或 .codex-plugin/plugin.json 的本地插件包绝对路径。 */
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
