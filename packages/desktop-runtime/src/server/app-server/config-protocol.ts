import type {
  ProviderConfigState,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeConfiguredModelReference,
  RuntimeMcpServerStatus,
} from '@setsuna-desktop/contracts';
import type {
  MemoryPreferences,
  MemoryPreferencesPatch,
} from '@setsuna-desktop/feature-memory/contracts';
import path from 'node:path';
import type { RuntimeFactory } from '../types.js';
import { AppServerRpcError } from './errors.js';
import { appServerConfigFeatureEnablement } from './feature-protocol.js';
import {
  hasOwn,
  numericInput,
  recordInput,
  requiredRawString,
  requiredString,
  stringInput,
} from './input.js';
import { sweOffsetPage } from './pagination.js';
import {
  appServerMemoryConfig,
  appServerMemorySettingInput,
  appServerMemorySettingsInput,
} from './memory-config-protocol.js';

type AppServerModelCatalogItem = {
  id: string;
  model: string;
  upgrade: string | null;
  upgradeInfo: null;
  availabilityNux: null;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
  inputModalities: string[];
  supportsPersonality: boolean;
  additionalSpeedTiers: string[];
  serviceTiers: Array<{ id: string; name: string; description: string }>;
  defaultServiceTier: string | null;
  isDefault: boolean;
};

type AppServerPermissionProfileSummary = {
  id: string;
  description: string | null;
  allowed: boolean;
};

type AppServerConfigLayerSource = {
  type: 'user';
  file: string;
  profile: string | null;
};

type AppServerConfigLayerMetadata = {
  name: AppServerConfigLayerSource;
  version: string;
};

type AppServerConfigEdit = {
  keyPath: string;
  value: unknown;
  mergeStrategy: 'replace' | 'upsert';
};

const APP_SERVER_CONFIG_LAYER_VERSION = '1';
export function appServerConfigReadResponse(
  config: RuntimeConfigState,
  memory: MemoryPreferences,
  input: Record<string, unknown>,
) {
  const cwd = stringInput(input.cwd) || process.cwd();
  const configValue = sweEffectiveConfig(config, memory, cwd);
  const metadata = appServerConfigLayerMetadata(config);
  const origins = appServerConfigOrigins(configValue, metadata);
  const includeLayers = input.includeLayers === true || input.include_layers === true;
  return {
    config: configValue,
    origins,
    ...(includeLayers
      ? {
          layers: [
            {
              name: metadata.name,
              version: metadata.version,
              config: configValue,
            },
          ],
        }
      : {}),
  };
}

function sweEffectiveConfig(
  config: RuntimeConfigState,
  memory: MemoryPreferences,
  cwd: string,
): Record<string, unknown> {
  const reasoningEffort = activeModelReasoningEffort(config);
  return {
    model: activeModelCode(config),
    review_model: appServerReviewModel(config),
    model_context_window: activeModelConfig(config)?.contextWindowTokens ?? null,
    model_auto_compact_token_limit: appServerModelAutoCompactTokenLimit(config),
    model_auto_compact_token_limit_scope: null,
    model_provider: activeModelProvider(config),
    approval_policy: appServerApprovalPolicy(config.approvalPolicy),
    approvals_reviewer: config.approvalReviewer ?? 'user',
    sandbox_mode: sweSandboxMode(config.permissionProfile),
    sandbox_workspace_write: sweSandboxWorkspaceWrite(config, cwd),
    forced_chatgpt_workspace_id: null,
    forced_login_method: null,
    web_search: null,
    tools: null,
    instructions: config.globalPrompt || null,
    developer_instructions: null,
    compact_prompt: null,
    hooks: config.hooks ?? {},
    bypass_hook_trust: config.bypassHookTrust === true,
    model_reasoning_effort: reasoningEffort,
    model_reasoning_summary: null,
    model_verbosity: null,
    service_tier: null,
    analytics: null,
    apps: null,
    desktop: {
      ...(config.desktopSettings ?? {}),
      data_path: config.dataPath,
      storage_path: config.storagePath,
      setsuna_style: config.setsunaStyle,
      memory_enabled: memory.useMemories || memory.generateMemories,
    },
    memories: appServerMemoryConfig(config, memory),
    features: appServerConfigFeatureEnablement(config),
  };
}

function appServerConfigOrigins(
  configValue: Record<string, unknown>,
  metadata: AppServerConfigLayerMetadata,
): Record<string, AppServerConfigLayerMetadata> {
  const origins: Record<string, AppServerConfigLayerMetadata> = {};
  for (const key of Object.keys(configValue)) {
    origins[key] = metadata;
  }
  const sandbox = recordInput(configValue.sandbox_workspace_write);
  if (Array.isArray(sandbox.writable_roots)) {
    origins['sandbox_workspace_write.writable_roots'] = metadata;
    for (const index of sandbox.writable_roots.keys()) {
      origins[`sandbox_workspace_write.writable_roots.${index}`] = metadata;
    }
  }
  if (hasOwn(sandbox, 'network_access')) origins['sandbox_workspace_write.network_access'] = metadata;
  if (hasOwn(sandbox, 'exclude_tmpdir_env_var')) {
    origins['sandbox_workspace_write.exclude_tmpdir_env_var'] = metadata;
  }
  if (hasOwn(sandbox, 'exclude_slash_tmp')) origins['sandbox_workspace_write.exclude_slash_tmp'] = metadata;
  const memories = recordInput(configValue.memories);
  for (const key of Object.keys(memories)) {
    origins[`memories.${key}`] = metadata;
  }
  const hooks = recordInput(configValue.hooks);
  for (const key of Object.keys(hooks)) {
    origins[`hooks.${key}`] = metadata;
  }
  return origins;
}

function appServerConfigLayerMetadata(config: RuntimeConfigState): AppServerConfigLayerMetadata {
  return {
    name: {
      type: 'user',
      file: path.resolve(config.configPath),
      profile: null,
    },
    version: APP_SERVER_CONFIG_LAYER_VERSION,
  };
}

export function appServerConfigEdit(input: Record<string, unknown>, index?: number): AppServerConfigEdit {
  const prefix = index === undefined ? '' : `edits[${index}].`;
  const keyPath = requiredString(input.keyPath ?? input.key_path, `${prefix}keyPath`);
  const mergeStrategy = stringInput(input.mergeStrategy ?? input.merge_strategy) ?? 'replace';
  if (mergeStrategy !== 'replace' && mergeStrategy !== 'upsert') {
    throw new AppServerRpcError(-32602, `${prefix}mergeStrategy must be replace or upsert`);
  }
  if (!hasOwn(input, 'value')) throw new AppServerRpcError(-32602, `Missing required parameter: ${prefix}value`);
  return { keyPath, value: input.value, mergeStrategy };
}

export function sweValidateConfigWriteTarget(
  config: RuntimeConfigState,
  filePath: unknown,
  expectedVersion: unknown,
): void {
  const requestedFile = stringInput(filePath);
  if (requestedFile && path.resolve(requestedFile) !== path.resolve(config.configPath)) {
    throw appServerConfigWriteError('configPathNotFound', `config file is not writable: ${requestedFile}`);
  }
  const version = stringInput(expectedVersion);
  if (version && version !== APP_SERVER_CONFIG_LAYER_VERSION) {
    throw appServerConfigWriteError('configVersionConflict', `config version conflict: expected ${version}`);
  }
}

function appServerConfigWriteError(code: string, message: string): AppServerRpcError {
  return new AppServerRpcError(-32602, message, { config_write_error_code: code });
}

export function appServerConfigWriteResponse(config: RuntimeConfigState) {
  return {
    status: 'ok',
    version: APP_SERVER_CONFIG_LAYER_VERSION,
    filePath: path.resolve(config.configPath),
    overriddenMetadata: null,
  };
}

export type AppServerConfigMutation = Readonly<{
  config: RuntimeConfigInput;
  memoryPatch: MemoryPreferencesPatch;
  writesConfig: boolean;
}>;

export function appServerRuntimeConfigInputFromEdits(
  config: RuntimeConfigState,
  edits: AppServerConfigEdit[],
): AppServerConfigMutation {
  const next: RuntimeConfigInput = {
    features: { ...(config.features ?? {}) },
    desktopSettings: { ...(config.desktopSettings ?? {}) },
    sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}) },
  };
  let memoryPatch: MemoryPreferencesPatch = {};
  let writesConfig = false;
  let providers: RuntimeConfigInput['providers'];

  const ensureProviders = () => {
    providers ??= config.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      icon: provider.icon ?? null,
      models: provider.models.map((model) => ({ ...model })),
    }));
    return providers;
  };
  const activeProviderIdForEdit = () => (
    next.activeProviderId ?? config.activeProviderId ?? ensureProviders()[0]?.id
  );
  const currentReviewModelForEdit = () => (
    next.taskModels && hasOwn(next.taskModels, 'review')
      ? next.taskModels.review
      : config.taskModels?.review
  );

  for (const edit of edits) {
    switch (edit.keyPath) {
      case 'model':
        writesConfig = true;
        providers = sweProvidersWithActiveModel(
          activeProviderIdForEdit(),
          ensureProviders(),
          requiredRawString(edit.value, 'model'),
        );
        break;
      case 'model_context_window':
        writesConfig = true;
        providers = sweProvidersWithModelContextWindow(
          activeProviderIdForEdit(),
          ensureProviders(),
          edit.value,
        );
        break;
      case 'model_auto_compact_token_limit':
        writesConfig = true;
        next.desktopSettings = {
          ...(next.desktopSettings ?? {}),
          model_auto_compact_token_limit: edit.value === null ? null : positiveRequiredConfigInt(edit.value, 'model_auto_compact_token_limit'),
        };
        break;
      case 'model_provider':
        writesConfig = true;
        next.activeProviderId = sweProviderIdForWrite(
          ensureProviders(),
          requiredRawString(edit.value, 'model_provider'),
        );
        break;
      case 'approval_policy':
        writesConfig = true;
        next.approvalPolicy = appServerApprovalPolicyToRuntime(requiredRawString(edit.value, 'approval_policy'));
        break;
      case 'approvals_reviewer':
        writesConfig = true;
        next.approvalReviewer = appServerApprovalReviewerToRuntime(
          requiredRawString(edit.value, 'approvals_reviewer'),
        );
        break;
      case 'review_model':
        writesConfig = true;
        next.taskModels = {
          ...(next.taskModels ?? {}),
          review: appServerReviewModelInput(edit.value, {
            activeProviderId: activeProviderIdForEdit(),
            current: currentReviewModelForEdit(),
            providers: ensureProviders(),
          }),
        };
        break;
      case 'sandbox_mode':
        writesConfig = true;
        next.permissionProfile = sweSandboxModeToRuntime(requiredRawString(edit.value, 'sandbox_mode'));
        break;
      case 'sandbox_workspace_write':
        writesConfig = true;
        next.sandboxWorkspaceWrite = sweSandboxWorkspaceWriteInput(edit.value);
        break;
      case 'instructions':
        writesConfig = true;
        next.globalPrompt = edit.value === null ? '' : requiredRawString(edit.value, 'instructions');
        break;
      case 'model_reasoning_effort':
        writesConfig = true;
        providers = sweProvidersWithReasoningEffort(
          activeProviderIdForEdit(),
          ensureProviders(),
          edit.value,
        );
        break;
      case 'features':
        writesConfig = true;
        next.features = sweMergeObject(next.features ?? {}, sweBooleanRecord(edit.value, 'features'), edit.mergeStrategy);
        break;
      case 'memories':
        memoryPatch = { ...memoryPatch, ...appServerMemorySettingsInput(edit.value) };
        break;
      case 'hooks':
        writesConfig = true;
        next.hooks = appServerHooksConfigInput(edit.value);
        break;
      case 'bypass_hook_trust':
        writesConfig = true;
        if (typeof edit.value !== 'boolean') throw new AppServerRpcError(-32602, 'bypass_hook_trust must be a boolean');
        next.bypassHookTrust = edit.value;
        break;
      case 'desktop':
        writesConfig = true;
        next.desktopSettings = sweMergeObject(next.desktopSettings ?? {}, recordInput(edit.value), edit.mergeStrategy);
        memoryPatch = { ...memoryPatch, ...sweApplyDesktopSettings(next, next.desktopSettings) };
        break;
      default:
        if (edit.keyPath.startsWith('features.')) {
          writesConfig = true;
          const name = edit.keyPath.slice('features.'.length);
          if (typeof edit.value !== 'boolean') throw new AppServerRpcError(-32602, `${edit.keyPath} must be a boolean`);
          next.features = { ...(next.features ?? {}), [name]: edit.value };
          break;
        }
        if (edit.keyPath.startsWith('desktop.')) {
          const key = edit.keyPath.slice('desktop.'.length);
          if (key !== 'memory_enabled') writesConfig = true;
          next.desktopSettings = { ...(next.desktopSettings ?? {}), [key]: edit.value };
          memoryPatch = { ...memoryPatch, ...sweApplyDesktopSettings(next, { [key]: edit.value }) };
          break;
        }
        if (edit.keyPath.startsWith('memories.')) {
          const key = edit.keyPath.slice('memories.'.length);
          memoryPatch = {
            ...memoryPatch,
            ...appServerMemorySettingInput(key, edit.value),
          };
          break;
        }
        throw appServerConfigWriteError('configValidationError', `Unsupported config key path: ${edit.keyPath}`);
    }
  }

  if (providers) next.providers = providers;
  return { config: next, memoryPatch, writesConfig };
}

function sweProvidersWithActiveModel(
  activeProviderId: string | undefined,
  providers: NonNullable<RuntimeConfigInput['providers']>,
  modelCode: string,
): NonNullable<RuntimeConfigInput['providers']> {
  const selectedProviderId = activeProviderId ?? providers[0]?.id;
  return providers.map((provider) => {
    if (provider.id !== selectedProviderId) return provider;
    const models = provider.models?.length ? provider.models.map((model) => ({ ...model })) : [];
    const existing = models.find((model) => model.code === modelCode || model.id === modelCode || model.name === modelCode);
    if (existing) {
      return {
        ...provider,
        models: models.map((model) => ({ ...model, enabled: model === existing })),
      };
    }
    return {
      ...provider,
      models: [
        { id: modelCode, name: modelCode, code: modelCode, enabled: true, contextWindowTokens: 256_000, maxOutputTokens: 68000, thinkingEnabled: false, thinkingEfforts: [] },
        ...models.map((model) => ({ ...model, enabled: false })),
      ],
    };
  });
}

function sweProvidersWithReasoningEffort(
  activeProviderId: string | undefined,
  providers: NonNullable<RuntimeConfigInput['providers']>,
  value: unknown,
): NonNullable<RuntimeConfigInput['providers']> {
  const selectedProviderId = activeProviderId ?? providers[0]?.id;
  const effort = value === null ? undefined : requiredRawString(value, 'model_reasoning_effort');
  return providers.map((provider) => {
    if (provider.id !== selectedProviderId) return provider;
    return {
      ...provider,
      models: provider.models?.map((model) => (
        model.enabled
          ? {
              ...model,
              thinkingEnabled: effort ? true : model.thinkingEnabled,
              thinkingEfforts: effort && !model.thinkingEfforts.includes(effort)
                ? [...model.thinkingEfforts, effort]
                : model.thinkingEfforts,
              defaultThinkingEffort: effort,
            }
          : model
      )) ?? [],
    };
  });
}

function sweProvidersWithModelContextWindow(
  activeProviderId: string | undefined,
  providers: NonNullable<RuntimeConfigInput['providers']>,
  value: unknown,
): NonNullable<RuntimeConfigInput['providers']> {
  const selectedProviderId = activeProviderId ?? providers[0]?.id;
  const contextWindowTokens = value === null ? undefined : positiveRequiredConfigInt(value, 'model_context_window');
  return providers.map((provider) => {
    if (provider.id !== selectedProviderId) return provider;
    return {
      ...provider,
      models: provider.models?.map((model) => {
        if (!model.enabled) return model;
        const next = { ...model };
        if (contextWindowTokens === undefined) delete next.contextWindowTokens;
        else next.contextWindowTokens = contextWindowTokens;
        return next;
      }) ?? [],
    };
  });
}

function sweProviderIdForWrite(
  providers: NonNullable<RuntimeConfigInput['providers']>,
  value: string,
): string {
  const exact = providers.find((provider) => provider.id === value);
  if (exact?.id) return exact.id;
  const byKind = providers.filter((provider) => provider.provider === value);
  if (byKind.length === 1 && byKind[0]?.id) return byKind[0].id;
  throw appServerConfigWriteError('configValidationError', `Unknown model_provider: ${value}`);
}

function appServerApprovalPolicyToRuntime(value: string): RuntimeConfigState['approvalPolicy'] {
  if (value === 'never') return 'full';
  if (value === 'untrusted') return 'strict';
  if (value === 'on-request') return 'on-request';
  throw appServerConfigWriteError('configValidationError', `Unsupported approval_policy: ${value}`);
}

function appServerApprovalReviewerToRuntime(
  value: string,
): NonNullable<RuntimeConfigState['approvalReviewer']> {
  if (value === 'user' || value === 'automatic') return value;
  throw appServerConfigWriteError(
    'configValidationError',
    `Unsupported approvals_reviewer: ${value}`,
  );
}

function appServerReviewModel(config: RuntimeConfigState): string | null {
  const reference = config.taskModels?.review;
  if (!reference) return null;
  const provider = config.providers.find((item) => (
    item.enabled && item.id === reference.providerId
  ));
  const model = provider?.models.find((item) => (
    item.id === reference.modelId && Boolean(item.code.trim())
  ));
  return model?.code.trim() || null;
}

function appServerReviewModelInput(
  value: unknown,
  source: {
    activeProviderId?: string;
    current?: RuntimeConfiguredModelReference | null;
    providers: NonNullable<RuntimeConfigInput['providers']>;
  },
): RuntimeConfiguredModelReference | null {
  if (value === null) return null;
  const modelCode = requiredRawString(value, 'review_model');
  const candidates = source.providers.flatMap((provider) => {
    if (provider.enabled === false || !provider.id) return [];
    const providerId = provider.id;
    return (provider.models ?? [])
      .filter((model) => (
        model.code === modelCode || model.id === modelCode || model.name === modelCode
      ))
      .map((model) => ({ providerId, modelId: model.id }));
  });
  const current = source.current;
  const selected = candidates.find((candidate) => (
    candidate.providerId === current?.providerId
    && candidate.modelId === current?.modelId
  )) ?? candidates.find((candidate) => candidate.providerId === source.activeProviderId)
    ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (selected) return selected;
  throw appServerConfigWriteError(
    'configValidationError',
    `Unknown or ambiguous review_model: ${modelCode}`,
  );
}

function sweSandboxModeToRuntime(value: string): RuntimeConfigState['permissionProfile'] {
  if (value === 'read-only') return 'read-only';
  if (value === 'workspace-write') return 'workspace-write';
  if (value === 'danger-full-access') return 'danger-full-access';
  throw appServerConfigWriteError('configValidationError', `Unsupported sandbox_mode: ${value}`);
}

function sweSandboxWorkspaceWriteInput(value: unknown): RuntimeConfigInput['sandboxWorkspaceWrite'] {
  const input = recordInput(value);
  return {
    readableRoots: Array.isArray(input.readable_roots)
      ? input.readable_roots.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    writableRoots: Array.isArray(input.writable_roots)
      ? input.writable_roots.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    deniedRoots: Array.isArray(input.denied_roots)
      ? input.denied_roots.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    deniedGlobPatterns: Array.isArray(input.denied_glob_patterns)
      ? input.denied_glob_patterns.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    globScanMaxDepth: typeof input.glob_scan_max_depth === 'number' && Number.isFinite(input.glob_scan_max_depth)
      ? Math.max(1, Math.floor(input.glob_scan_max_depth))
      : undefined,
    networkAccess: input.network_access === true,
    excludeTmpdirEnvVar: input.exclude_tmpdir_env_var === true,
    excludeSlashTmp: input.exclude_slash_tmp === true,
  };
}

function appServerHooksConfigInput(value: unknown): RuntimeConfigInput['hooks'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw appServerConfigWriteError('configValidationError', 'hooks must be an object');
  }
  return value as RuntimeConfigInput['hooks'];
}

function sweBooleanRecord(value: unknown, name: string): Record<string, boolean> {
  const input = recordInput(value);
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(input)) {
    if (typeof item !== 'boolean') throw new AppServerRpcError(-32602, `${name}.${key} must be a boolean`);
    result[key] = item;
  }
  return result;
}

function sweMergeObject<T extends Record<string, unknown>>(current: T, update: Record<string, unknown>, strategy: AppServerConfigEdit['mergeStrategy']): T {
  return (strategy === 'replace' ? { ...update } : { ...current, ...update }) as T;
}

function sweApplyDesktopSettings(
  input: RuntimeConfigInput,
  settings: Record<string, unknown>,
): MemoryPreferencesPatch {
  const patch: MemoryPreferencesPatch = hasOwn(settings, 'memory_enabled')
    ? {
        useMemories: settings.memory_enabled === true,
        generateMemories: settings.memory_enabled === true,
      }
    : {};
  if (input.desktopSettings && hasOwn(input.desktopSettings, 'memory_enabled')) {
    delete input.desktopSettings.memory_enabled;
  }
  if (hasOwn(settings, 'setsuna_style')) input.setsunaStyle = settings.setsuna_style as string;
  if (hasOwn(settings, 'storage_path') && typeof settings.storage_path === 'string') {
    input.storagePath = settings.storage_path;
  }
  return patch;
}

export function sweCollaborationModeListResponse() {
  return {
    data: [
      {
        name: 'Default',
        mode: 'default',
        model: null,
        reasoning_effort: null,
      },
    ],
  };
}

export function sweModelListResponse(config: RuntimeConfigState, input: Record<string, unknown>) {
  const includeHidden = input.includeHidden === true;
  return sweOffsetPage(
    sweModelCatalog(config, includeHidden),
    stringInput(input.cursor),
    numericInput(input.limit),
    'models',
  );
}

export function sweModelProviderCapabilitiesResponse(config: RuntimeConfigState) {
  const provider = activeProviderConfig(config);
  const isOpenAiFamily = provider?.provider === 'openai-compatible' || provider?.provider === 'openai-responses';
  return {
    namespaceTools: true,
    imageGeneration: Boolean(isOpenAiFamily),
    webSearch: Boolean(isOpenAiFamily),
  };
}

export function swePermissionProfileListResponse(input: Record<string, unknown>) {
  const profiles: AppServerPermissionProfileSummary[] = [
    { id: ':read-only', description: null, allowed: true },
    { id: ':workspace', description: null, allowed: true },
    { id: ':danger-full-access', description: null, allowed: true },
  ];
  return sweOffsetPage(profiles, stringInput(input.cursor), numericInput(input.limit), 'permission profiles');
}

export function sweMcpServerStatusListResponse(
  statuses: RuntimeMcpServerStatus[],
  input: Record<string, unknown>,
) {
  return sweOffsetPage(statuses, stringInput(input.cursor), numericInput(input.limit), 'MCP servers');
}

function sweModelCatalog(config: RuntimeConfigState, includeHidden: boolean): AppServerModelCatalogItem[] {
  const activeProvider = activeProviderConfig(config);
  return config.providers.flatMap((provider) => {
    const defaultModel = activeProvider?.id === provider.id ? activeProviderModel(provider) : null;
    return provider.models
      .map((model) => sweModelCatalogItem(provider, model, defaultModel))
      .filter((model) => includeHidden || !model.hidden);
  });
}

function sweModelCatalogItem(
  provider: ProviderConfigState,
  model: ProviderConfigState['models'][number],
  defaultModel: ProviderConfigState['models'][number] | null,
): AppServerModelCatalogItem {
  const reasoningEfforts = sweReasoningEfforts(model);
  return {
    id: sweModelCatalogId(provider, model),
    model: model.code,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model.name,
    description: provider.name ? `Provider: ${provider.name}` : '',
    hidden: !provider.enabled || !model.enabled,
    supportedReasoningEfforts: reasoningEfforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: sweReasoningEffortDescription(reasoningEffort),
    })),
    defaultReasoningEffort: model.thinkingEnabled ? model.defaultThinkingEffort ?? reasoningEfforts[0] ?? 'medium' : 'none',
    inputModalities: model.supportsImages ? ['text', 'image'] : ['text'],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: defaultModel?.id === model.id,
  };
}

export function sweModelCatalogId(provider: ProviderConfigState, model: ProviderConfigState['models'][number]): string {
  return `${provider.id}:${model.id}`;
}

function sweReasoningEfforts(model: ProviderConfigState['models'][number]): string[] {
  if (!model.thinkingEnabled) return [];
  const seen = new Set<string>();
  const efforts = [...model.thinkingEfforts, model.defaultThinkingEffort]
    .map((effort) => effort?.trim())
    .filter((effort): effort is string => Boolean(effort));
  for (const fallback of efforts.length ? efforts : ['medium']) {
    seen.add(fallback);
  }
  return [...seen];
}

function sweReasoningEffortDescription(effort: string): string {
  switch (effort) {
    case 'none':
      return 'None';
    case 'minimal':
      return 'Minimal';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'X-High';
    case 'ultra':
      return 'Ultra';
    default:
      return effort;
  }
}

function activeProviderConfig(config: RuntimeConfigState): ProviderConfigState | undefined {
  return config.providers.find((item) => item.id === config.activeProviderId && item.enabled)
    ?? config.providers.find((item) => item.enabled)
    ?? config.providers[0];
}

function activeProviderModel(provider: ProviderConfigState): ProviderConfigState['models'][number] | null {
  return provider.models.find((model) => model.enabled) ?? provider.models[0] ?? null;
}
export function sweSandboxPolicy(permissionProfile: string | undefined, cwd: string) {
  if (permissionProfile === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (permissionProfile === 'read-only') return { type: 'readOnly', networkAccess: false };
  return {
    type: 'workspaceWrite',
    writableRoots: [cwd],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: process.platform === 'win32',
  };
}

function sweSandboxMode(permissionProfile: RuntimeConfigState['permissionProfile'] | undefined) {
  if (permissionProfile === 'danger-full-access') return 'danger-full-access';
  if (permissionProfile === 'read-only') return 'read-only';
  return 'workspace-write';
}

function sweSandboxWorkspaceWrite(config: RuntimeConfigState, cwd: string) {
  if (config.permissionProfile !== 'workspace-write') return null;
  const sandbox = config.sandboxWorkspaceWrite ?? {};
  return {
    readable_roots: sandbox.readableRoots?.length ? sandbox.readableRoots : [],
    writable_roots: sandbox.writableRoots?.length ? sandbox.writableRoots : [cwd],
    denied_roots: sandbox.deniedRoots?.length ? sandbox.deniedRoots : [],
    denied_glob_patterns: sandbox.deniedGlobPatterns?.length ? sandbox.deniedGlobPatterns : [],
    glob_scan_max_depth: sandbox.globScanMaxDepth ?? null,
    network_access: sandbox.networkAccess === true,
    exclude_tmpdir_env_var: sandbox.excludeTmpdirEnvVar === true,
    exclude_slash_tmp: sandbox.excludeSlashTmp ?? process.platform === 'win32',
  };
}

export function appServerApprovalPolicy(value: string | undefined) {
  if (value === 'full') return 'never';
  if (value === 'strict') return 'untrusted';
  return 'on-request';
}

function activeModelConfig(config: RuntimeConfigState): ProviderConfigState['models'][number] | null {
  const provider = activeProviderConfig(config);
  return provider?.models.find((model) => model.enabled) ?? provider?.models[0] ?? null;
}

function activeModelReasoningEffort(config: RuntimeConfigState): string | null {
  const model = activeModelConfig(config);
  if (!model?.thinkingEnabled) return null;
  return model.defaultThinkingEffort ?? sweReasoningEfforts(model)[0] ?? null;
}

function appServerModelAutoCompactTokenLimit(config: RuntimeConfigState): number | null {
  return positiveConfigInt(
    config.desktopSettings?.modelAutoCompactTokenLimit ??
    config.desktopSettings?.model_auto_compact_token_limit,
  ) ?? null;
}

export function activeModelCode(config: Awaited<ReturnType<RuntimeFactory['configStore']['getConfig']>>): string {
  return activeModelConfig(config)?.code ?? 'unknown';
}

export function activeModelProvider(config: Awaited<ReturnType<RuntimeFactory['configStore']['getConfig']>>): string {
  const provider = activeProviderConfig(config);
  return provider?.id ?? 'unknown';
}

function positiveConfigInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function positiveRequiredConfigInt(value: unknown, label: string): number {
  const parsed = positiveConfigInt(value);
  if (parsed === undefined) throw appServerConfigWriteError('configValidationError', `${label} must be a positive number`);
  return parsed;
}
