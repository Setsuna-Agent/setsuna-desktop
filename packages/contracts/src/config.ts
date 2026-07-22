import type { ModelProviderKind } from './provider.js';

export const BRAND_ICON_MAX_BYTES = 512 * 1024;
export const BRAND_ICON_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 68000;
export const DEFAULT_ANTHROPIC_MODEL_MAX_OUTPUT_TOKENS = 8192;
// Backwards-compatible names for callers added with provider icon configuration.
export const PROVIDER_CUSTOM_ICON_MAX_BYTES = BRAND_ICON_MAX_BYTES;
export const PROVIDER_CUSTOM_ICON_MIME_TYPES = BRAND_ICON_MIME_TYPES;

export type BrandIconMimeType = typeof BRAND_ICON_MIME_TYPES[number];
export type ProviderCustomIconMimeType = BrandIconMimeType;

export type BrandIconConfig =
  | { type: 'preset'; key: string }
  | { type: 'custom'; dataUrl: string };

export type ProviderIconConfig = BrandIconConfig;
export type ModelIconConfig = BrandIconConfig;

export type ProviderConfigState = {
  id: string;
  name: string;
  provider: ModelProviderKind;
  baseUrl: string;
  enabled: boolean;
  icon?: ProviderIconConfig;
  apiKeySet: boolean;
  apiKeyPreview: string;
  models: ProviderModelConfig[];
};

export function defaultModelMaxOutputTokens(provider: ModelProviderKind): number {
  return provider === 'anthropic'
    ? DEFAULT_ANTHROPIC_MODEL_MAX_OUTPUT_TOKENS
    : DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
}

/** Brand icons live in config.json, so reject unsafe formats and unexpectedly large inline images at the contract boundary. */
export function normalizeBrandIconConfig(value: unknown): BrandIconConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;

  if (record.type === 'preset' && typeof record.key === 'string') {
    const key = record.key.trim().toLocaleLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,63}$/.test(key) ? { type: 'preset', key } : undefined;
  }

  if (record.type !== 'custom' || typeof record.dataUrl !== 'string') return undefined;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/]+={0,2})$/i.exec(record.dataUrl.trim());
  if (!match) return undefined;
  const mimeType = match[1]?.toLocaleLowerCase() as BrandIconMimeType | undefined;
  const payload = match[2];
  if (!mimeType || !payload || payload.length % 4 !== 0) return undefined;
  const paddingBytes = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const decodedBytes = Math.floor((payload.length * 3) / 4) - paddingBytes;
  if (decodedBytes <= 0 || decodedBytes > BRAND_ICON_MAX_BYTES) return undefined;
  return { type: 'custom', dataUrl: `data:${mimeType};base64,${payload}` };
}

export const normalizeProviderIconConfig = normalizeBrandIconConfig;
export const normalizeModelIconConfig = normalizeBrandIconConfig;

export type ProviderModelConfig = {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
  icon?: ModelIconConfig;
  contextWindowTokens?: number;
  maxOutputTokens: number;
  thinkingEnabled: boolean;
  thinkingEfforts: string[];
  defaultThinkingEffort?: string;
  supportsImages?: boolean;
};

export type RuntimeSetsunaStyle = 'developer' | 'daily';

export type RuntimeMarkdownLinkOpenMode = 'in-app' | 'external';

export type RuntimeDesktopSettings = {
  [key: string]: unknown;
  markdownLinkOpenMode?: RuntimeMarkdownLinkOpenMode;
  npmRegistryUrl?: string;
  pythonPackageIndexUrl?: string;
  workspaceDependenciesEnabled?: boolean;
};

export type RuntimeImageGenerationConfigState = {
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
  apiKeyPreview: string;
};

export type RuntimeImageGenerationConfigInput = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

/** 接受用户自定义的 HTTP/HTTPS OpenAI Images 服务地址，不强制公网 HTTPS。 */
export function normalizeImageGenerationServiceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export const DEFAULT_NPM_REGISTRY_URL = 'https://registry.npmmirror.com';
export const DEFAULT_PYTHON_PACKAGE_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple';

/** 空值返回空字符串，无效 URL 返回 null。 */
function normalizePackageSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
      ? normalized
      : null;
  } catch {
    return null;
  }
}

export function normalizeNpmRegistryUrl(value: unknown): string | null {
  return normalizePackageSourceUrl(value);
}

export function normalizePythonPackageIndexUrl(value: unknown): string | null {
  return normalizePackageSourceUrl(value);
}

export type RuntimeMemorySettings = {
  useMemories: boolean;
  generateMemories: boolean;
  dedicatedTools: boolean;
  disableOnExternalContext: boolean;
  extractModel?: string;
  consolidationModel?: string;
  minRateLimitRemainingPercent?: number;
  maxRolloutsPerStartup?: number;
  maxRolloutAgeDays?: number;
  minRolloutIdleHours?: number;
  maxUnusedDays?: number;
  maxRawMemoriesForConsolidation?: number;
};

export type RuntimeHookEventName =
  | 'PreToolUse'
  | 'PermissionRequest'
  | 'PostToolUse'
  | 'PreCompact'
  | 'PostCompact'
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Stop';

export type RuntimeHookHandlerConfig = {
  type: 'command' | 'prompt' | 'agent';
  command?: string;
  commandWindows?: string;
  timeoutSec?: number;
  async?: boolean;
  statusMessage?: string;
  /** 由本地插件 runtime 设置；插件 Hook 在获批前始终不受信任。 */
  pluginId?: string;
  sourcePath?: string;
};

export type RuntimeHookMatcherGroup = {
  matcher?: string;
  hooks: RuntimeHookHandlerConfig[];
};

export type RuntimeHookState = {
  enabled?: boolean;
  trustedHash?: string;
};

export type RuntimeHooksConfig = Partial<Record<RuntimeHookEventName, RuntimeHookMatcherGroup[]>> & {
  state?: Record<string, RuntimeHookState>;
};

export type RuntimeHookInput = {
  eventName: RuntimeHookEventName;
  matcher?: string;
  command: string;
  commandWindows?: string;
  timeoutSec?: number;
  statusMessage?: string;
};

export type RuntimeHookProtocolEventName =
  | 'preToolUse'
  | 'permissionRequest'
  | 'postToolUse'
  | 'preCompact'
  | 'postCompact'
  | 'sessionStart'
  | 'userPromptSubmit'
  | 'subagentStart'
  | 'subagentStop'
  | 'stop';

export type RuntimeHookSource =
  | 'system'
  | 'user'
  | 'project'
  | 'mdm'
  | 'sessionFlags'
  | 'plugin'
  | 'cloudRequirements'
  | 'cloudManagedConfig'
  | 'legacyManagedConfigFile'
  | 'legacyManagedConfigMdm'
  | 'unknown';

export type RuntimeHookTrustStatus = 'managed' | 'untrusted' | 'trusted' | 'modified';

export type RuntimeHookMetadata = {
  key: string;
  eventName: RuntimeHookProtocolEventName;
  handlerType: 'command' | 'prompt' | 'agent';
  matcher: string | null;
  command: string | null;
  timeoutSec: number;
  statusMessage: string | null;
  sourcePath: string;
  source: RuntimeHookSource;
  pluginId: string | null;
  displayOrder: number;
  enabled: boolean;
  isManaged: boolean;
  currentHash: string;
  trustStatus: RuntimeHookTrustStatus;
};

export type RuntimeHookListEntry = {
  cwd: string;
  hooks: RuntimeHookMetadata[];
  warnings: string[];
  errors: Array<{ path?: string; message: string }>;
};

export type RuntimeHookListResponse = {
  data: RuntimeHookListEntry[];
};

export type RuntimeConfigState = {
  configPath: string;
  dataPath: string;
  storagePath: string;
  activeProviderId?: string;
  providers: ProviderConfigState[];
  globalPrompt: string;
  memory: RuntimeMemorySettings;
  memoryEnabled: boolean;
  setsunaStyle: RuntimeSetsunaStyle;
  approvalPolicy: 'strict' | 'on-request' | 'full';
  permissionProfile: RuntimePermissionProfile;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
  hooks?: RuntimeHooksConfig;
  bypassHookTrust?: boolean;
  features?: Record<string, boolean>;
  desktopSettings?: RuntimeDesktopSettings;
  imageGeneration?: RuntimeImageGenerationConfigState;
};

export type RuntimePermissionProfile = 'read-only' | 'workspace-write' | 'danger-full-access';

export type RuntimeSandboxWorkspaceWrite = {
  readableRoots?: string[];
  writableRoots?: string[];
  deniedRoots?: string[];
  deniedGlobPatterns?: string[];
  globScanMaxDepth?: number;
  networkAccess?: boolean;
  excludeTmpdirEnvVar?: boolean;
  excludeSlashTmp?: boolean;
};

export type RuntimeAvailableModel = {
  id: string;
  name: string;
  maxOutputTokens?: number;
  contextWindowTokens?: number;
  thinkingEnabled?: boolean;
  thinkingEfforts?: string[];
  defaultThinkingEffort?: string;
  supportsImages?: boolean;
};

export type RuntimeFetchModelsInput = {
  providerId?: string;
  provider?: ModelProviderKind;
  baseUrl?: string;
  apiKey?: string;
};

export type RuntimeAvailableModelsResponse = {
  models: RuntimeAvailableModel[];
};

export type ProviderConfigInput = {
  id?: string;
  name?: string;
  provider?: ModelProviderKind;
  baseUrl?: string;
  enabled?: boolean;
  icon?: ProviderIconConfig | null;
  apiKey?: string;
  clearApiKey?: boolean;
  models?: ProviderModelConfig[];
};

export type RuntimeConfigInput = {
  activeProviderId?: string;
  globalPrompt?: string;
  storagePath?: string;
  memory?: Partial<RuntimeMemorySettings>;
  memoryEnabled?: boolean;
  setsunaStyle?: RuntimeSetsunaStyle | string;
  approvalPolicy?: RuntimeConfigState['approvalPolicy'];
  permissionProfile?: RuntimePermissionProfile;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
  hooks?: RuntimeHooksConfig;
  bypassHookTrust?: boolean;
  features?: Record<string, boolean>;
  desktopSettings?: RuntimeDesktopSettings;
  imageGeneration?: RuntimeImageGenerationConfigInput;
  providers?: ProviderConfigInput[];
};
