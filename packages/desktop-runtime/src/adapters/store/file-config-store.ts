import type {
  ProviderConfigInput,
  ProviderConfigState,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeConfiguredModelReference,
  RuntimeDesktopSettings,
  RuntimeHookEventName,
  RuntimeHookHandlerConfig,
  RuntimeHookMatcherGroup,
  RuntimeHooksConfig,
  RuntimeImageGenerationConfigInput,
  RuntimeImageGenerationConfigState,
  RuntimeMemorySettings,
} from '@setsuna-desktop/contracts';
import {
  defaultModelMaxOutputTokens,
  normalizeImageGenerationServiceUrl,
  normalizeDesktopNetworkProxyRoute,
  normalizeModelIconConfig,
  normalizeNpmRegistryUrl,
  normalizeProviderIconConfig,
  normalizePythonPackageIndexUrl,
  normalizeRuntimeAccessModeConfig,
} from '@setsuna-desktop/contracts';
import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ConfigStore,
  RuntimeImageGenerationProviderConfig,
  RuntimeProviderConfig,
} from '../../ports/config-store.js';
import { withFileStateUpdate } from './file-state-coordinator.js';
import { readJsonFile, writeJsonFile } from './json-file.js';
import {
  normalizeConfiguredModelReference,
  taskModelSettingsForSave,
  taskModelSettingsForState,
} from './task-model-config.js';

const MAX_GLOBAL_PROMPT_CHARS = 8000;
const CONFIG_SCHEMA_VERSION = 5;
// Network access changed from an implicit deny to an explicit, user-controllable
// setting in schema v2. Later schema changes must not replay that one-time migration.
const NETWORK_ACCESS_MIGRATION_SCHEMA_VERSION = 2;
const ACCESS_MODE_MIGRATION_SCHEMA_VERSION = 4;
const PROVIDER_PROXY_ROUTE_MIGRATION_SCHEMA_VERSION = 5;

const HOOK_EVENT_NAMES: RuntimeHookEventName[] = [
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PreCompact',
  'PostCompact',
  'SessionStart',
  'UserPromptSubmit',
  'SubagentStart',
  'SubagentStop',
  'Stop',
];

type StoredImageGenerationConfig = Omit<RuntimeImageGenerationConfigState, 'apiKeySet' | 'apiKeyPreview'>;

type StoredConfig = Omit<
  RuntimeConfigState,
  'configPath' | 'dataPath' | 'storagePath' | 'providers' | 'memory' | 'memoryEnabled' | 'imageGeneration' | 'visionRecognition'
> & {
  schemaVersion?: number;
  /** Pre-v3 compatibility input. It is consumed once and never written again. */
  storagePath?: string;
  memory?: Partial<RuntimeMemorySettings>;
  memoryEnabled?: boolean;
  imageGeneration?: StoredImageGenerationConfig;
  visionRecognition?: RuntimeConfiguredModelReference;
  providers: Omit<ProviderConfigState, 'apiKeySet' | 'apiKeyPreview'>[];
};

type StoredSecrets = {
  providerApiKeys: Record<string, string>;
  imageGenerationApiKey?: string;
};

type FileConfigStoreOptions = {
  validateProxyServerReferences?(proxyServerIds: readonly string[]): Promise<void>;
};

export class ProviderProxyReferenceError extends Error {
  constructor(readonly providerNames: string[]) {
    super(`代理服务器仍被模型厂商 ${providerNames.join('、')} 使用，请先修改厂商代理。`);
    this.name = 'ProviderProxyReferenceError';
  }
}

export class FileConfigStore implements ConfigStore {
  private readonly configPath: string;
  private readonly secretsPath: string;

  constructor(
    private readonly dataDir: string,
    private readonly options: FileConfigStoreOptions = {},
  ) {
    this.configPath = path.join(dataDir, 'config.json');
    this.secretsPath = path.join(dataDir, 'secrets.json');
  }

  async getConfig(): Promise<RuntimeConfigState> {
    return withFileStateUpdate(this.configPath, async () => {
      const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
      if (migrateStoredConfig(stored)) {
        await writeJsonFile(this.configPath, stored);
      }
      const secrets = await this.readSecrets();
      return this.toState(stored, secrets);
    });
  }

  async getActiveProviderConfig(): Promise<RuntimeProviderConfig | null> {
    return withFileStateUpdate(this.configPath, async () => {
      const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
      const secrets = await this.readSecrets();
      const provider =
        stored.providers.find((item) => item.id === stored.activeProviderId && item.enabled) ??
        stored.providers.find((item) => item.enabled) ??
        stored.providers[0];
      return runtimeProviderConfig(provider, secrets);
    });
  }

  async getProviderConfig(providerId: string): Promise<RuntimeProviderConfig | null> {
    return withFileStateUpdate(this.configPath, async () => {
      const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
      const secrets = await this.readSecrets();
      return runtimeProviderConfig(stored.providers.find((provider) => provider.id === providerId), secrets);
    });
  }

  async getImageGenerationConfig(): Promise<RuntimeImageGenerationProviderConfig> {
    return withFileStateUpdate(this.configPath, async () => {
      const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
      const secrets = await this.readSecrets();
      return {
        ...normalizeStoredImageGeneration(stored.imageGeneration),
        apiKey: secrets.imageGenerationApiKey ?? '',
      };
    });
  }

  async getLegacyStoragePath(): Promise<string> {
    return withFileStateUpdate(this.configPath, async () => {
      const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
      return normalizeStoragePath(stored.storagePath);
    });
  }

  async clearLegacyStoragePath(): Promise<void> {
    await withFileStateUpdate(this.configPath, async () => {
      const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
      if (!Object.hasOwn(stored, 'storagePath')) return;
      migrateStoredConfig(stored);
      delete stored.storagePath;
      stored.schemaVersion = CONFIG_SCHEMA_VERSION;
      await writeJsonFile(this.configPath, stored);
    });
  }

  async saveConfig(input: RuntimeConfigInput): Promise<RuntimeConfigState> {
    return withFileStateUpdate(this.configPath, async () => {
      await mkdir(this.dataDir, { recursive: true });
      const previous = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
      const secrets = await this.readSecrets();
      const providers = normalizeProviders(input.providers ?? previous.providers, previous.providers, secrets);
      await this.validateProviderProxyReferences(providers);
      pruneRemovedProviderSecrets(secrets, providers);
      const activeProviderId = activeProviderIdForSave(input.activeProviderId ?? previous.activeProviderId, providers);
      const memory = memorySettingsForSave(input, previous);
      const taskModels = taskModelSettingsForSave(input.taskModels, previous.taskModels);
      if (input.taskModels && Object.hasOwn(input.taskModels, 'memoryExtraction')) {
        delete memory.extractModel;
      }
      if (input.taskModels && Object.hasOwn(input.taskModels, 'memoryConsolidation')) {
        delete memory.consolidationModel;
      }
      const imageGeneration = imageGenerationSettingsForSave(
        input.imageGeneration,
        previous.imageGeneration,
        secrets,
      );
      const visionRecognition = input.visionRecognition === undefined
        ? normalizeConfiguredModelReference(previous.visionRecognition)
        : normalizeConfiguredModelReference(input.visionRecognition);
      const previousAccessMode = accessModeForStoredConfig(previous);

      const stored: StoredConfig = {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        activeProviderId,
        globalPrompt: normalizeGlobalPrompt(input.globalPrompt ?? previous.globalPrompt),
        memory,
        memoryEnabled: memory.useMemories || memory.generateMemories,
        taskModels,
        setsunaStyle: normalizeSetsunaStyle(input.setsunaStyle ?? previous.setsunaStyle),
        approvalPolicy: normalizeApprovalPolicy(input.approvalPolicy ?? previousAccessMode.approvalPolicy),
        permissionProfile: normalizePermissionProfile(input.permissionProfile ?? previousAccessMode.permissionProfile),
        sandboxWorkspaceWrite: normalizeSandboxWorkspaceWrite(
          input.sandboxWorkspaceWrite ?? previous.sandboxWorkspaceWrite,
          {
            migrateNetworkDefault:
              input.sandboxWorkspaceWrite === undefined
              && (previous.schemaVersion ?? 0) < NETWORK_ACCESS_MIGRATION_SCHEMA_VERSION,
          },
        ),
        hooks: normalizeHooksConfig(input.hooks ?? previous.hooks),
        bypassHookTrust: booleanOrUndefined(input.bypassHookTrust ?? previous.bypassHookTrust),
        features: normalizeFeatureFlags(input.features ?? previous.features),
        desktopSettings: normalizeDesktopSettings(input.desktopSettings ?? previous.desktopSettings),
        imageGeneration,
        ...(visionRecognition ? { visionRecognition } : {}),
        providers: providers.map(({ apiKey: _apiKey, ...provider }) => provider),
      };

      // 先写入密钥可保证失败安全：只有私密文件完成持久替换后，配置提交才能引用新密钥。
      await this.writeSecrets(secrets);
      await writeJsonFile(this.configPath, stored);
      return this.toState(stored, secrets);
    });
  }

  /**
   * Holds the same config-file lock used by saveConfig while the main process
   * deletes a proxy. A queued stale provider save is then revalidated after the
   * deletion instead of persisting a dangling proxy ID.
   */
  async deleteProxyServerIfUnreferenced<T>(
    proxyServerId: string,
    deleteServer: () => Promise<T>,
  ): Promise<T> {
    const canonicalProxyServerId = proxyServerId.trim().toLowerCase();
    if (!canonicalProxyServerId) throw new Error('代理服务器 ID 无效。');
    return withFileStateUpdate(this.configPath, async () => {
      const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
      const providerNames = stored.providers.flatMap((provider) => {
        const route = normalizeDesktopNetworkProxyRoute(provider.proxyRoute);
        return route?.mode === 'proxy' && route.proxyServerId === canonicalProxyServerId
          ? [provider.name || provider.id]
          : [];
      });
      if (providerNames.length) throw new ProviderProxyReferenceError(providerNames);
      return deleteServer();
    });
  }

  private async validateProviderProxyReferences(
    providers: Array<StoredConfig['providers'][number] & { apiKey?: string }>,
  ): Promise<void> {
    const proxyServerIds = [...new Set(providers.flatMap((provider) => {
      const route = normalizeDesktopNetworkProxyRoute(provider.proxyRoute);
      return route?.mode === 'proxy' ? [route.proxyServerId] : [];
    }))];
    if (proxyServerIds.length) {
      await this.options.validateProxyServerReferences?.(proxyServerIds);
    }
  }

  private async readSecrets(): Promise<StoredSecrets> {
    return normalizeSecrets(await readJsonFile<StoredSecrets>(this.secretsPath, { providerApiKeys: {} }));
  }

  private async writeSecrets(secrets: StoredSecrets): Promise<void> {
    await writeJsonFile(this.secretsPath, secrets, { mode: 0o600 });
    await chmod(this.secretsPath, 0o600).catch(() => undefined);
  }

  private toState(stored: StoredConfig, secrets: StoredSecrets): RuntimeConfigState {
    const memory = normalizeMemorySettings(stored.memory, stored.memoryEnabled);
    const providers = stored.providers.map((provider) => {
      const apiKey = secrets.providerApiKeys[provider.id] ?? '';
      const icon = normalizeProviderIconConfig(provider.icon);
      const { icon: _storedIcon, ...providerWithoutIcon } = provider;
      return {
        ...providerWithoutIcon,
        proxyRoute: normalizeDesktopNetworkProxyRoute(provider.proxyRoute) ?? { mode: 'inherit' },
        ...(icon ? { icon } : {}),
        models: normalizeModels(provider.models, provider.provider),
        apiKeySet: apiKey.length > 0,
        apiKeyPreview: maskApiKey(apiKey),
      };
    });
    const visionRecognition = normalizeConfiguredModelReference(stored.visionRecognition);
    return {
      configPath: this.configPath,
      dataPath: this.dataDir,
      storagePath: path.join(this.dataDir, 'memories'),
      activeProviderId: stored.activeProviderId,
      globalPrompt: normalizeGlobalPrompt(stored.globalPrompt),
      memory,
      memoryEnabled: memory.useMemories || memory.generateMemories,
      taskModels: taskModelSettingsForState(
        stored.taskModels,
        memory,
        providers,
        stored.activeProviderId,
      ),
      setsunaStyle: normalizeSetsunaStyle(stored.setsunaStyle),
      approvalPolicy: normalizeApprovalPolicy(stored.approvalPolicy),
      permissionProfile: normalizePermissionProfile(stored.permissionProfile),
      sandboxWorkspaceWrite: normalizeSandboxWorkspaceWrite(stored.sandboxWorkspaceWrite, {
        migrateNetworkDefault:
          (stored.schemaVersion ?? 0) < NETWORK_ACCESS_MIGRATION_SCHEMA_VERSION,
      }),
      hooks: normalizeHooksConfig(stored.hooks),
      bypassHookTrust: stored.bypassHookTrust === true,
      features: normalizeFeatureFlags(stored.features),
      desktopSettings: normalizeDesktopSettings(stored.desktopSettings),
      imageGeneration: imageGenerationState(stored.imageGeneration, secrets),
      ...(visionRecognition ? { visionRecognition } : {}),
      providers,
    };
  }
}

function pruneRemovedProviderSecrets(
  secrets: StoredSecrets,
  providers: Array<StoredConfig['providers'][number] & { apiKey?: string }>,
): void {
  const retainedProviderIds = new Set(providers.map((provider) => provider.id));
  for (const providerId of Object.keys(secrets.providerApiKeys)) {
    if (!retainedProviderIds.has(providerId)) delete secrets.providerApiKeys[providerId];
  }
}

function defaultConfig(): StoredConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProviderId: 'local-test',
    globalPrompt: '',
    memory: defaultMemorySettings(),
    memoryEnabled: true,
    taskModels: {},
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: { networkAccess: true },
    hooks: {},
    bypassHookTrust: false,
    features: { request_permissions_tool: true },
    desktopSettings: { workspaceDependenciesEnabled: true },
    imageGeneration: defaultImageGenerationSettings(),
    providers: [
      {
        id: 'local-test',
        name: 'Local test provider',
        provider: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:11434/v1',
        enabled: true,
        models: [
          {
            id: 'local-runtime-smoke',
            name: 'Local runtime smoke',
            code: 'local-runtime-smoke',
            enabled: true,
            contextWindowTokens: 256_000,
            maxOutputTokens: defaultModelMaxOutputTokens('openai-compatible'),
            thinkingEnabled: false,
            thinkingEfforts: [],
            supportsImages: false,
          },
        ],
      },
    ],
  };
}

function activeProviderIdForSave(activeProviderId: string | undefined, providers: StoredConfig['providers']): string | undefined {
  return providers.find((provider) => provider.id === activeProviderId && provider.enabled)?.id
    ?? providers.find((provider) => provider.enabled)?.id
    ?? providers[0]?.id;
}

function normalizeProviders(
  inputProviders: ProviderConfigInput[] | StoredConfig['providers'],
  previousProviders: StoredConfig['providers'],
  secrets: StoredSecrets,
): Array<StoredConfig['providers'][number] & { apiKey?: string }> {
  const previousById = new Map(previousProviders.map((provider) => [provider.id, provider]));
  return inputProviders.map((provider, index) => {
    const id = nonEmpty(provider.id) ?? `provider-${index + 1}`;
    const previous = previousById.get(id);
    const icon = normalizeProviderIconConfig(Object.hasOwn(provider, 'icon') ? provider.icon : previous?.icon);
    if ('apiKey' in provider && typeof provider.apiKey === 'string' && provider.apiKey.trim()) {
      secrets.providerApiKeys[id] = provider.apiKey.trim();
    }
    if ('clearApiKey' in provider && provider.clearApiKey) {
      delete secrets.providerApiKeys[id];
    }
    return {
      id,
      // An explicit empty string means the user cleared the display name.
      name: typeof provider.name === 'string' ? provider.name : previous?.name ?? 'Local provider',
      provider: provider.provider ?? previous?.provider ?? 'openai-compatible',
      baseUrl: normalizeBaseUrl(provider.baseUrl ?? previous?.baseUrl ?? ''),
      enabled: provider.enabled ?? previous?.enabled ?? true,
      proxyRoute: normalizeDesktopNetworkProxyRoute(
        Object.hasOwn(provider, 'proxyRoute') ? provider.proxyRoute : previous?.proxyRoute,
      ) ?? { mode: 'inherit' },
      ...(icon ? { icon } : {}),
      models: normalizeModels(
        provider.models ?? previous?.models ?? [],
        provider.provider ?? previous?.provider ?? 'openai-compatible',
      ),
    };
  });
}

function normalizeModels(
  models: ProviderConfigState['models'],
  provider: ProviderConfigState['provider'],
): ProviderConfigState['models'] {
  const normalized = models.map((model, index) => {
    const code = nonEmpty(model.code) ?? nonEmpty(model.id) ?? `model-${index + 1}`;
    const icon = normalizeModelIconConfig(model.icon);
    return {
      id: nonEmpty(model.id) ?? code,
      name: nonEmpty(model.name) ?? code,
      code,
      enabled: model.enabled ?? true,
      ...(icon ? { icon } : {}),
      contextWindowTokens: positiveOptionalInt(model.contextWindowTokens),
      maxOutputTokens: positiveInt(model.maxOutputTokens, defaultModelMaxOutputTokens(provider)),
      thinkingEnabled: model.thinkingEnabled ?? false,
      thinkingEfforts: Array.isArray(model.thinkingEfforts) ? model.thinkingEfforts : [],
      defaultThinkingEffort: nonEmpty(model.defaultThinkingEffort),
      supportsImages: model.supportsImages ?? false,
    };
  });
  return normalized.length ? normalized : defaultConfig().providers[0].models;
}

function normalizeSecrets(value: unknown): StoredSecrets {
  if (!value || typeof value !== 'object') return { providerApiKeys: {} };
  const record = value as {
    providerApiKeys?: unknown;
    imageGenerationApiKey?: unknown;
  };
  const providerApiKeys = record.providerApiKeys;
  return {
    providerApiKeys: providerApiKeys && typeof providerApiKeys === 'object'
      ? Object.fromEntries(
          Object.entries(providerApiKeys).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : {},
    imageGenerationApiKey: typeof record.imageGenerationApiKey === 'string'
      ? record.imageGenerationApiKey
      : undefined,
  };
}

function defaultImageGenerationSettings(): StoredImageGenerationConfig {
  return {
    baseUrl: '',
    model: '',
  };
}

function normalizeStoredImageGeneration(value: unknown): StoredImageGenerationConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultImageGenerationSettings();
  const record = value as Record<string, unknown>;
  return {
    baseUrl: normalizeImageGenerationServiceUrl(record.baseUrl) ?? '',
    model: nonEmpty(record.model) ?? '',
  };
}

function imageGenerationSettingsForSave(
  input: RuntimeImageGenerationConfigInput | undefined,
  previous: StoredImageGenerationConfig | undefined,
  secrets: StoredSecrets,
): StoredImageGenerationConfig {
  const base = normalizeStoredImageGeneration(previous);
  if (typeof input?.apiKey === 'string' && input.apiKey.trim()) {
    secrets.imageGenerationApiKey = input.apiKey.trim();
  }
  if (input?.clearApiKey === true) delete secrets.imageGenerationApiKey;
  return {
    baseUrl: normalizeImageGenerationServiceUrl(input?.baseUrl ?? base.baseUrl) ?? '',
    model: typeof input?.model === 'string' ? input.model.trim() : base.model,
  };
}

function imageGenerationState(
  value: StoredImageGenerationConfig | undefined,
  secrets: StoredSecrets,
): RuntimeImageGenerationConfigState {
  return {
    ...normalizeStoredImageGeneration(value),
    apiKeySet: Boolean(secrets.imageGenerationApiKey),
    apiKeyPreview: maskApiKey(secrets.imageGenerationApiKey ?? ''),
  };
}

function normalizeBaseUrl(value: string): string {
  // 设置会在输入时自动保存；如果在此移除末尾斜杠，输入中的 `https:/` 会退回 `https:`，
  // 导致无法输入 `https://`。
  return value.trim();
}

function runtimeProviderConfig(
  provider: StoredConfig['providers'][number] | undefined,
  secrets: StoredSecrets,
): RuntimeProviderConfig | null {
  if (!provider) return null;
  const models = normalizeModels(provider.models, provider.provider);
  return {
    ...provider,
    proxyRoute: normalizeDesktopNetworkProxyRoute(provider.proxyRoute) ?? { mode: 'inherit' },
    models,
    apiKey: secrets.providerApiKeys[provider.id] ?? '',
    activeModel: models.find((model) => model.enabled) ?? models[0],
  };
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizePermissionProfile(value: unknown): RuntimeConfigState['permissionProfile'] {
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') return value;
  return 'workspace-write';
}

function normalizeApprovalPolicy(value: unknown): RuntimeConfigState['approvalPolicy'] {
  if (value === 'strict' || value === 'on-request' || value === 'full') return value;
  if (value === 'suggest') return 'on-request';
  return 'on-request';
}

function accessModeForStoredConfig(stored: StoredConfig) {
  const accessMode = {
    approvalPolicy: normalizeApprovalPolicy(stored.approvalPolicy),
    permissionProfile: normalizePermissionProfile(stored.permissionProfile),
  };
  return (stored.schemaVersion ?? 0) < ACCESS_MODE_MIGRATION_SCHEMA_VERSION
    ? normalizeRuntimeAccessModeConfig(accessMode)
    : accessMode;
}

function migrateStoredConfig(stored: StoredConfig): boolean {
  const schemaVersion = stored.schemaVersion ?? 0;
  if (schemaVersion >= CONFIG_SCHEMA_VERSION) return false;

  if (schemaVersion < NETWORK_ACCESS_MIGRATION_SCHEMA_VERSION) {
    stored.sandboxWorkspaceWrite = normalizeSandboxWorkspaceWrite(stored.sandboxWorkspaceWrite, {
      migrateNetworkDefault: true,
    });
  }
  if (schemaVersion < ACCESS_MODE_MIGRATION_SCHEMA_VERSION) {
    const accessMode = accessModeForStoredConfig(stored);
    stored.approvalPolicy = accessMode.approvalPolicy;
    stored.permissionProfile = accessMode.permissionProfile;
  }
  if (schemaVersion < PROVIDER_PROXY_ROUTE_MIGRATION_SCHEMA_VERSION) {
    stored.providers = stored.providers.map((provider) => ({
      ...provider,
      proxyRoute: normalizeDesktopNetworkProxyRoute(provider.proxyRoute) ?? { mode: 'inherit' },
    }));
  }
  stored.schemaVersion = CONFIG_SCHEMA_VERSION;
  return true;
}

function normalizeGlobalPrompt(value: unknown): string {
  const chars = Array.from(typeof value === 'string' ? value.trim() : '');
  return chars.length > MAX_GLOBAL_PROMPT_CHARS ? chars.slice(0, MAX_GLOBAL_PROMPT_CHARS).join('') : chars.join('');
}

function normalizeStoragePath(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function defaultMemorySettings(): RuntimeMemorySettings {
  return {
    useMemories: true,
    generateMemories: true,
    disableOnExternalContext: false,
  };
}

function memorySettingsForSave(input: RuntimeConfigInput, previous: StoredConfig): RuntimeMemorySettings {
  const previousMemory = normalizeMemorySettings(previous.memory, previous.memoryEnabled);
  const base = typeof input.memoryEnabled === 'boolean'
    ? {
        ...previousMemory,
        useMemories: input.memoryEnabled,
        generateMemories: input.memoryEnabled,
      }
    : previousMemory;
  return normalizeMemorySettings(input.memory ? { ...base, ...input.memory } : base);
}

function normalizeMemorySettings(value: unknown, legacyMemoryEnabled?: unknown): RuntimeMemorySettings {
  const legacyEnabled = typeof legacyMemoryEnabled === 'boolean' ? legacyMemoryEnabled : undefined;
  const fallback = legacyEnabled === undefined
    ? defaultMemorySettings()
    : {
        ...defaultMemorySettings(),
        useMemories: legacyEnabled,
        generateMemories: legacyEnabled,
      };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  return {
    useMemories: booleanValue(record.useMemories, fallback.useMemories),
    generateMemories: booleanValue(record.generateMemories, fallback.generateMemories),
    disableOnExternalContext: booleanValue(record.disableOnExternalContext, fallback.disableOnExternalContext),
    extractModel: nonEmpty(record.extractModel),
    consolidationModel: nonEmpty(record.consolidationModel),
    minRateLimitRemainingPercent: percentOptionalInt(record.minRateLimitRemainingPercent),
    maxRolloutsPerStartup: positiveOptionalInt(record.maxRolloutsPerStartup),
    maxRolloutAgeDays: positiveOptionalInt(record.maxRolloutAgeDays),
    minRolloutIdleHours: positiveOptionalInt(record.minRolloutIdleHours),
    maxUnusedDays: positiveOptionalInt(record.maxUnusedDays),
    maxRawMemoriesForConsolidation: positiveOptionalInt(record.maxRawMemoriesForConsolidation),
  };
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function positiveOptionalInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function percentOptionalInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.floor(value) : undefined;
}

function normalizeSetsunaStyle(value: unknown): RuntimeConfigState['setsunaStyle'] {
  switch (String(value || '').trim().toLowerCase()) {
    case 'daily':
    case 'casual':
    case 'everyday':
    case '生活':
    case '日常':
      return 'daily';
    case 'developer':
    case 'development':
    case 'dev':
    case 'code':
    case 'coding':
    case '开发':
    default:
      return 'developer';
  }
}

function normalizeFeatureFlags(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => (
      typeof entry[0] === 'string' && typeof entry[1] === 'boolean'
    )),
  );
}

function normalizeSandboxWorkspaceWrite(
  value: unknown,
  options: { migrateNetworkDefault?: boolean } = {},
): RuntimeConfigState['sandboxWorkspaceWrite'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { networkAccess: true };
  const record = value as Record<string, unknown>;
  return {
    readableRoots: Array.isArray(record.readableRoots)
      ? record.readableRoots.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    writableRoots: Array.isArray(record.writableRoots)
      ? record.writableRoots.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    deniedRoots: Array.isArray(record.deniedRoots)
      ? record.deniedRoots.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    deniedGlobPatterns: Array.isArray(record.deniedGlobPatterns)
      ? record.deniedGlobPatterns.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    globScanMaxDepth: typeof record.globScanMaxDepth === 'number' && Number.isFinite(record.globScanMaxDepth)
      ? Math.max(1, Math.floor(record.globScanMaxDepth))
      : undefined,
    // 本地工作区沙箱应当开箱即用；用户仍可在高级设置中显式禁用网络访问。
    networkAccess: options.migrateNetworkDefault === true || record.networkAccess !== false,
    excludeTmpdirEnvVar: record.excludeTmpdirEnvVar === true,
    excludeSlashTmp: record.excludeSlashTmp === true,
  };
}

function normalizeHooksConfig(value: unknown): RuntimeHooksConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const hooks: RuntimeHooksConfig = {};
  for (const eventName of HOOK_EVENT_NAMES) {
    const groups = normalizeHookMatcherGroups(record[eventName]);
    if (groups.length) hooks[eventName] = groups;
  }
  const state = normalizeHookState(record.state);
  if (Object.keys(state).length) hooks.state = state;
  return hooks;
}

function normalizeHookMatcherGroups(value: unknown): RuntimeHookMatcherGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: RuntimeHookMatcherGroup[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const hooks = normalizeHookHandlers(record.hooks);
    if (!hooks.length) continue;
    const matcher = nonEmpty(record.matcher);
    groups.push({
      ...(matcher ? { matcher } : {}),
      hooks,
    });
  }
  return groups;
}

function normalizeHookHandlers(value: unknown): RuntimeHookHandlerConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const type = record.type;
      if (type !== 'command' && type !== 'prompt' && type !== 'agent') return null;
      const handler: RuntimeHookHandlerConfig = { type };
      const command = nonEmpty(record.command);
      if (command) handler.command = command;
      const commandWindows = nonEmpty(record.commandWindows ?? record.command_windows);
      if (commandWindows) handler.commandWindows = commandWindows;
      const timeout = positiveOptionalInt(record.timeoutSec ?? record.timeout_sec ?? record.timeout);
      if (timeout !== undefined) handler.timeoutSec = timeout;
      if (record.async === true) handler.async = true;
      const statusMessage = nonEmpty(record.statusMessage ?? record.status_message);
      if (statusMessage) handler.statusMessage = statusMessage;
      const pluginId = nonEmpty(record.pluginId ?? record.plugin_id);
      if (pluginId) handler.pluginId = pluginId;
      const pluginHookId = nonEmpty(record.pluginHookId ?? record.plugin_hook_id);
      if (pluginHookId) handler.pluginHookId = pluginHookId;
      const sourcePath = nonEmpty(record.sourcePath ?? record.source_path);
      if (sourcePath) handler.sourcePath = sourcePath;
      return handler;
    })
    .filter((item): item is RuntimeHookHandlerConfig => Boolean(item));
}

function normalizeHookState(value: unknown): NonNullable<RuntimeHooksConfig['state']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const state: NonNullable<RuntimeHooksConfig['state']> = {};
  for (const [key, rawState] of Object.entries(value)) {
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) continue;
    const record = rawState as Record<string, unknown>;
    const next = {
      enabled: booleanOrUndefined(record.enabled),
      trustedHash: nonEmpty(record.trustedHash ?? record.trusted_hash),
    };
    if (next.enabled !== undefined || next.trustedHash) state[key] = next;
  }
  return state;
}

function normalizeDesktopSettings(value: unknown): RuntimeDesktopSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { workspaceDependenciesEnabled: true };
  const settings = Object.fromEntries(
    Object.entries(value).filter(([key, setting]) => (
      typeof key === 'string' &&
      setting !== undefined &&
      typeof setting !== 'function' &&
      typeof setting !== 'symbol'
    )),
  );
  if (settings.markdownLinkOpenMode !== 'in-app' && settings.markdownLinkOpenMode !== 'external') {
    delete settings.markdownLinkOpenMode;
  }
  if (settings.interfaceLanguage !== 'zh-CN' && settings.interfaceLanguage !== 'en-US') {
    delete settings.interfaceLanguage;
  }
  const npmRegistryUrl = normalizeNpmRegistryUrl(settings.npmRegistryUrl);
  if (npmRegistryUrl) settings.npmRegistryUrl = npmRegistryUrl;
  else delete settings.npmRegistryUrl;
  const pythonPackageIndexUrl = normalizePythonPackageIndexUrl(settings.pythonPackageIndexUrl);
  if (pythonPackageIndexUrl) settings.pythonPackageIndexUrl = pythonPackageIndexUrl;
  else delete settings.pythonPackageIndexUrl;
  if (typeof settings.workspaceDependenciesEnabled !== 'boolean') {
    settings.workspaceDependenciesEnabled = true;
  }
  return settings;
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '••••';
  return `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}`;
}
