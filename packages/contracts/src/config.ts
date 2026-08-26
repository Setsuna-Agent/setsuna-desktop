import type { RuntimeHooksConfig } from './hooks.js';
import type { ModelProviderKind } from './model-provider.js';
import type { DesktopNetworkProxyRoute } from './network-proxy/index.js';
import type { RuntimePermissionProfile, RuntimeSandboxWorkspaceWrite } from './permissions.js';

export type * from './hooks.js';
export type * from './permissions.js';

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
  /** Pi built-in provider identity. `null` marks an explicitly custom service; omitted values are legacy records. */
  catalogProviderId?: string | null;
  provider: ModelProviderKind;
  baseUrl: string;
  enabled: boolean;
  icon?: ProviderIconConfig;
  apiKeySet: boolean;
  apiKeyPreview: string;
  proxyRoute?: DesktopNetworkProxyRoute;
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

export const RUNTIME_INTERFACE_LANGUAGES = ['zh-CN', 'en-US'] as const;

export type RuntimeInterfaceLanguage = typeof RUNTIME_INTERFACE_LANGUAGES[number];

export type RuntimeDesktopSettings = {
  [key: string]: unknown;
  interfaceLanguage?: RuntimeInterfaceLanguage;
  markdownLinkOpenMode?: RuntimeMarkdownLinkOpenMode;
  showThinkingInTranscript?: boolean;
};

export const RUNTIME_TASK_MODEL_IDS = [
  'threadTitle',
  'review',
  'approvalReview',
  'contextCompaction',
] as const;

export type RuntimeTaskModelId = typeof RUNTIME_TASK_MODEL_IDS[number];

export type RuntimeConfiguredModelReference = {
  providerId: string;
  modelId: string;
};

export type RuntimeTaskModelSettings = Partial<
  Record<RuntimeTaskModelId, RuntimeConfiguredModelReference>
>;

export type RuntimeTaskModelSettingsInput = Partial<
  Record<RuntimeTaskModelId, RuntimeConfiguredModelReference | null>
>;

export type RuntimeApprovalReviewer = 'user' | 'automatic';

export type RuntimeConfigState = {
  configPath: string;
  dataPath: string;
  storagePath: string;
  activeProviderId?: string;
  providers: ProviderConfigState[];
  globalPrompt: string;
  taskModels?: RuntimeTaskModelSettings;
  setsunaStyle: RuntimeSetsunaStyle;
  approvalPolicy: 'strict' | 'on-request' | 'full';
  /**
   * Selects who resolves interactive approval requests. Older snapshots omit
   * this field and are normalized by the config store during migration.
   */
  approvalReviewer?: RuntimeApprovalReviewer;
  permissionProfile: RuntimePermissionProfile;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
  hooks?: RuntimeHooksConfig;
  bypassHookTrust?: boolean;
  features?: Record<string, boolean>;
  desktopSettings?: RuntimeDesktopSettings;
};

export type RuntimeAccessMode =
  | 'request-approval'
  | 'agent-approval'
  | 'full-access';

export type RuntimeAccessModeConfig = Pick<
  RuntimeConfigState,
  'approvalPolicy' | 'approvalReviewer' | 'permissionProfile'
>;

/**
 * Desktop exposes permissions as three atomic modes. Legacy releases persisted
 * the two underlying fields independently, so any other combination is migrated
 * to the default risk-based approval mode instead of merely looking canonical in UI.
 */
export function runtimeAccessModeForConfig(config: RuntimeAccessModeConfig): RuntimeAccessMode {
  if (config.approvalPolicy === 'full' && config.permissionProfile === 'danger-full-access') {
    return 'full-access';
  }
  if (
    config.approvalPolicy === 'strict'
    && config.permissionProfile === 'workspace-write'
    && config.approvalReviewer !== 'automatic'
  ) {
    return 'request-approval';
  }
  return 'agent-approval';
}

export function runtimeAccessModeSelection(mode: RuntimeAccessMode): RuntimeAccessModeConfig {
  if (mode === 'full-access') {
    return {
      approvalPolicy: 'full',
      approvalReviewer: 'user',
      permissionProfile: 'danger-full-access',
    };
  }
  if (mode === 'agent-approval') {
    return {
      approvalPolicy: 'on-request',
      approvalReviewer: 'automatic',
      permissionProfile: 'workspace-write',
    };
  }
  return {
    approvalPolicy: 'strict',
    approvalReviewer: 'user',
    permissionProfile: 'workspace-write',
  };
}

export function normalizeRuntimeAccessModeConfig(config: RuntimeAccessModeConfig): RuntimeAccessModeConfig {
  return runtimeAccessModeSelection(runtimeAccessModeForConfig(config));
}

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
  proxyRoute?: DesktopNetworkProxyRoute;
};

export type RuntimeAvailableModelsResponse = {
  models: RuntimeAvailableModel[];
};

export type ProviderConfigInput = {
  id?: string;
  name?: string;
  /** `null` explicitly detaches a service from the Pi built-in catalog. */
  catalogProviderId?: string | null;
  provider?: ModelProviderKind;
  baseUrl?: string;
  enabled?: boolean;
  icon?: ProviderIconConfig | null;
  apiKey?: string;
  clearApiKey?: boolean;
  proxyRoute?: DesktopNetworkProxyRoute;
  models?: ProviderModelConfig[];
};

export type RuntimeConfigInput = {
  activeProviderId?: string;
  globalPrompt?: string;
  storagePath?: string;
  taskModels?: RuntimeTaskModelSettingsInput;
  setsunaStyle?: RuntimeSetsunaStyle | string;
  approvalPolicy?: RuntimeConfigState['approvalPolicy'];
  approvalReviewer?: RuntimeApprovalReviewer;
  permissionProfile?: RuntimePermissionProfile;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
  hooks?: RuntimeHooksConfig;
  bypassHookTrust?: boolean;
  features?: Record<string, boolean>;
  desktopSettings?: RuntimeDesktopSettings;
  providers?: ProviderConfigInput[];
};
