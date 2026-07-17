import { chmod, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ProviderConfigInput,
  ProviderConfigState,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeDesktopSettings,
  RuntimeHookEventName,
  RuntimeHookHandlerConfig,
  RuntimeHookMatcherGroup,
  RuntimeHooksConfig,
  RuntimeMemorySettings,
} from '@setsuna-desktop/contracts';
import type { ConfigStore, RuntimeProviderConfig } from '../../ports/config-store.js';
import { withFileStateUpdate } from './file-state-coordinator.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 68000;
const MAX_GLOBAL_PROMPT_CHARS = 8000;
const CONFIG_SCHEMA_VERSION = 2;

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

type StoredConfig = Omit<RuntimeConfigState, 'configPath' | 'dataPath' | 'providers' | 'memory' | 'memoryEnabled'> & {
  schemaVersion?: number;
  memory?: Partial<RuntimeMemorySettings>;
  memoryEnabled?: boolean;
  providers: Omit<ProviderConfigState, 'apiKeySet' | 'apiKeyPreview'>[];
};

type StoredSecrets = {
  providerApiKeys: Record<string, string>;
};

export class FileConfigStore implements ConfigStore {
  private readonly configPath: string;
  private readonly secretsPath: string;

  constructor(private readonly dataDir: string) {
    this.configPath = path.join(dataDir, 'config.json');
    this.secretsPath = path.join(dataDir, 'secrets.json');
  }

  async getConfig(): Promise<RuntimeConfigState> {
    return withFileStateUpdate(this.configPath, async () => {
      const stored = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
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

  async saveConfig(input: RuntimeConfigInput): Promise<RuntimeConfigState> {
    return withFileStateUpdate(this.configPath, async () => {
      await mkdir(this.dataDir, { recursive: true });
      const previous = await readJsonFile<StoredConfig>(this.configPath, defaultConfig());
      const secrets = await this.readSecrets();
      const providers = normalizeProviders(input.providers ?? previous.providers, previous.providers, secrets);
      pruneRemovedProviderSecrets(secrets, providers);
      const activeProviderId = activeProviderIdForSave(input.activeProviderId ?? previous.activeProviderId, providers);
      const memory = memorySettingsForSave(input, previous);

      const stored: StoredConfig = {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        activeProviderId,
        globalPrompt: normalizeGlobalPrompt(input.globalPrompt ?? previous.globalPrompt),
        storagePath: normalizeStoragePath(input.storagePath ?? previous.storagePath),
        memory,
        memoryEnabled: memory.useMemories || memory.generateMemories,
        setsunaStyle: normalizeSetsunaStyle(input.setsunaStyle ?? previous.setsunaStyle),
        approvalPolicy: normalizeApprovalPolicy(input.approvalPolicy ?? previous.approvalPolicy),
        permissionProfile: normalizePermissionProfile(input.permissionProfile ?? previous.permissionProfile),
        sandboxWorkspaceWrite: normalizeSandboxWorkspaceWrite(
          input.sandboxWorkspaceWrite ?? previous.sandboxWorkspaceWrite,
          { migrateNetworkDefault: input.sandboxWorkspaceWrite === undefined && (previous.schemaVersion ?? 0) < CONFIG_SCHEMA_VERSION },
        ),
        hooks: normalizeHooksConfig(input.hooks ?? previous.hooks),
        bypassHookTrust: booleanOrUndefined(input.bypassHookTrust ?? previous.bypassHookTrust),
        features: normalizeFeatureFlags(input.features ?? previous.features),
        desktopSettings: normalizeDesktopSettings(input.desktopSettings ?? previous.desktopSettings),
        providers: providers.map(({ apiKey: _apiKey, ...provider }) => provider),
      };

      // Secrets first is fail-safe: a config commit can reference the new key only
      // after the private file has been durably replaced.
      await this.writeSecrets(secrets);
      await writeJsonFile(this.configPath, stored);
      return this.toState(stored, secrets);
    });
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
    return {
      configPath: this.configPath,
      dataPath: this.dataDir,
      storagePath: normalizeStoragePath(stored.storagePath),
      activeProviderId: stored.activeProviderId,
      globalPrompt: normalizeGlobalPrompt(stored.globalPrompt),
      memory,
      memoryEnabled: memory.useMemories || memory.generateMemories,
      setsunaStyle: normalizeSetsunaStyle(stored.setsunaStyle),
      approvalPolicy: normalizeApprovalPolicy(stored.approvalPolicy),
      permissionProfile: normalizePermissionProfile(stored.permissionProfile),
      sandboxWorkspaceWrite: normalizeSandboxWorkspaceWrite(stored.sandboxWorkspaceWrite, {
        migrateNetworkDefault: (stored.schemaVersion ?? 0) < CONFIG_SCHEMA_VERSION,
      }),
      hooks: normalizeHooksConfig(stored.hooks),
      bypassHookTrust: stored.bypassHookTrust === true,
      features: normalizeFeatureFlags(stored.features),
      desktopSettings: normalizeDesktopSettings(stored.desktopSettings),
      providers: stored.providers.map((provider) => {
        const apiKey = secrets.providerApiKeys[provider.id] ?? '';
        return {
          ...provider,
          apiKeySet: apiKey.length > 0,
          apiKeyPreview: maskApiKey(apiKey),
        };
      }),
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
    storagePath: '',
    memory: defaultMemorySettings(),
    memoryEnabled: true,
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
    sandboxWorkspaceWrite: { networkAccess: true },
    hooks: {},
    bypassHookTrust: false,
    features: { request_permissions_tool: true },
    desktopSettings: { workspaceDependenciesEnabled: true },
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
            maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
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
    if ('apiKey' in provider && typeof provider.apiKey === 'string' && provider.apiKey.trim()) {
      secrets.providerApiKeys[id] = provider.apiKey.trim();
    }
    if ('clearApiKey' in provider && provider.clearApiKey) {
      delete secrets.providerApiKeys[id];
    }
    return {
      id,
      name: nonEmpty(provider.name) ?? previous?.name ?? 'Local provider',
      provider: provider.provider ?? previous?.provider ?? 'openai-compatible',
      baseUrl: normalizeBaseUrl(provider.baseUrl ?? previous?.baseUrl ?? ''),
      enabled: provider.enabled ?? previous?.enabled ?? true,
      models: normalizeModels(provider.models ?? previous?.models ?? []),
    };
  });
}

function normalizeModels(models: ProviderConfigState['models']): ProviderConfigState['models'] {
  const normalized = models.map((model, index) => {
    const code = nonEmpty(model.code) ?? nonEmpty(model.id) ?? `model-${index + 1}`;
    return {
      id: nonEmpty(model.id) ?? code,
      name: nonEmpty(model.name) ?? code,
      code,
      enabled: model.enabled ?? true,
      contextWindowTokens: positiveOptionalInt(model.contextWindowTokens),
      maxOutputTokens: positiveInt(model.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
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
  const providerApiKeys = (value as { providerApiKeys?: unknown }).providerApiKeys;
  if (!providerApiKeys || typeof providerApiKeys !== 'object') return { providerApiKeys: {} };
  return {
    providerApiKeys: Object.fromEntries(
      Object.entries(providerApiKeys).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  };
}

function normalizeBaseUrl(value: string): string {
  // Settings are auto-saved while typing; stripping a trailing slash here turns
  // an in-progress `https:/` back into `https:` and makes `https://` impossible to enter.
  return value.trim();
}

function runtimeProviderConfig(
  provider: StoredConfig['providers'][number] | undefined,
  secrets: StoredSecrets,
): RuntimeProviderConfig | null {
  if (!provider) return null;
  return {
    ...provider,
    apiKey: secrets.providerApiKeys[provider.id] ?? '',
    activeModel: provider.models.find((model) => model.enabled) ?? provider.models[0],
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
    dedicatedTools: false,
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
    dedicatedTools: booleanValue(record.dedicatedTools, fallback.dedicatedTools),
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
    // A local workspace sandbox should be useful out of the box. Users can
    // still explicitly disable network access from Advanced Settings.
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
