import path from 'node:path';
import type {
  ProviderConfigState,
  RuntimeConfigInput,
  RuntimeConfigState,
  RuntimeMcpServer,
} from '@setsuna-desktop/contracts';
import type { RuntimeFactory } from '../types.js';
import { AppServerRpcError } from './errors.js';
import { hasOwn, numericInput, recordInput, requiredRawString, requiredString, stringInput } from './input.js';

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

type AppServerExperimentalFeatureStage = 'beta' | 'underDevelopment' | 'stable' | 'deprecated' | 'removed';

type AppServerExperimentalFeatureSpec = {
  name: string;
  stage: AppServerExperimentalFeatureStage;
  displayName: string | null;
  description: string | null;
  announcement: string | null;
  defaultEnabled: boolean;
  forceDisabled?: boolean;
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

const APP_SERVER_CONFIG_ENABLEMENT_FEATURES = [
  'auth_elicitation',
  'memories',
  'mentions_v2',
  'remote_control',
  'remote_plugin',
  'tool_suggest',
] as const;

const APP_SERVER_EXPERIMENTAL_FEATURES: readonly AppServerExperimentalFeatureSpec[] = [
  { name: 'undo', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'shell_tool', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'secret_auth_storage', stage: 'stable', defaultEnabled: process.platform === 'win32', displayName: null, description: null, announcement: null },
  { name: 'unified_exec', stage: 'stable', defaultEnabled: process.platform !== 'win32', displayName: null, description: null, announcement: null },
  { name: 'shell_zsh_fork', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'unified_exec_zsh_fork', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'shell_snapshot', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'deferred_executor', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'js_repl', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'code_mode', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'code_mode_host', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'code_mode_only', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'js_repl_tools_only', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'terminal_resize_reflow', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'web_search_request', stage: 'deprecated', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'web_search_cached', stage: 'deprecated', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'standalone_web_search', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'search_tool', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'swe_git_commit', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'runtime_metrics', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'sqlite', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  {
    name: 'memories',
    stage: 'beta',
    defaultEnabled: false,
    displayName: 'Memories',
    description: 'Allow AppServer to create new memories from conversations and bring relevant memories into new conversations.',
    announcement: 'NEW: AppServer can now generate and use memories. Try it now with `/memories`',
  },
  { name: 'local_thread_store_compression', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'chronicle', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'apply_patch_freeform', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'apply_patch_streaming_events', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'exec_permission_approvals', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'hooks', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'request_permissions_tool', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'use_linux_sandbox_bwrap', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'use_legacy_landlock', stage: 'deprecated', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'request_rule', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'experimental_windows_sandbox', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'elevated_windows_sandbox', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'remote_models', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'enable_request_compression', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  {
    name: 'network_proxy',
    stage: 'beta',
    defaultEnabled: false,
    displayName: 'Network proxy',
    description: 'Apply network proxy restrictions to sandboxed sessions that already have network access.',
    announcement: 'NEW: Network proxy can now be enabled from /experimental. Restart AppServer after enabling it.',
  },
  { name: 'respect_system_proxy', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'multi_agent', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'multi_agent_v2', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'multi_agent_mode', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'enable_fanout', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'apps', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null, forceDisabled: true },
  { name: 'enable_mcp_apps', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'apps_mcp_path_override', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'tool_search', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'tool_search_always_defer_mcp_tools', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'non_prefixed_mcp_tool_names', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'unavailable_dummy_tools', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'tool_suggest', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'plugins', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null, forceDisabled: true },
  { name: 'plugin_hooks', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'in_app_browser', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'browser_use', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'browser_use_full_cdp_access', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'browser_use_external', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'computer_use', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'remote_plugin', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'plugin_sharing', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'external_migration', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'image_generation', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'imagegenext', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'resize_all_images', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'item_ids', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'skill_mcp_dependency_install', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'skill_env_var_dependency_prompt', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'mentions_v2', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'steer', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'default_mode_request_user_input', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'terminal_visualization_instructions', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'guardian_approval', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'goals', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'token_budget', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'rollout_budget', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'current_time_reminder', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'collaboration_modes', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'tool_call_mcp_elicitation', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'auth_elicitation', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'personality', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'artifact', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'fast_mode', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'realtime_conversation', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'remote_control', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'image_detail_original', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'tui_app_server', stage: 'removed', defaultEnabled: true, displayName: null, description: null, announcement: null },
  {
    name: 'prevent_idle_sleep',
    stage: 'beta',
    defaultEnabled: false,
    displayName: 'Prevent sleep while running',
    description: 'Keep your computer awake while AppServer is running a thread.',
    announcement: 'NEW: Prevent sleep while running is now available in /experimental.',
  },
  { name: 'workspace_owner_usage_nudge', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'responses_websockets', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'responses_websockets_v2', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'remote_compaction_v2', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
  { name: 'use_agent_identity', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'workspace_dependencies', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
];
export function appServerConfigReadResponse(config: RuntimeConfigState, input: Record<string, unknown>) {
  const cwd = stringInput(input.cwd) || process.cwd();
  const configValue = sweEffectiveConfig(config, cwd);
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

function sweEffectiveConfig(config: RuntimeConfigState, cwd: string): Record<string, unknown> {
  const reasoningEffort = activeModelReasoningEffort(config);
  return {
    model: activeModelCode(config),
    review_model: null,
    model_context_window: null,
    model_auto_compact_token_limit: null,
    model_auto_compact_token_limit_scope: null,
    model_provider: activeModelProvider(config),
    approval_policy: appServerApprovalPolicy(config.approvalPolicy),
    approvals_reviewer: 'user',
    sandbox_mode: sweSandboxMode(config.permissionProfile),
    sandbox_workspace_write: sweSandboxWorkspaceWrite(config, cwd),
    forced_chatgpt_workspace_id: null,
    forced_login_method: null,
    web_search: null,
    tools: null,
    instructions: config.globalPrompt || null,
    developer_instructions: null,
    compact_prompt: null,
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
      memory_enabled: config.memoryEnabled,
    },
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

function appServerConfigFeatureEnablement(config: RuntimeConfigState): Record<(typeof APP_SERVER_CONFIG_ENABLEMENT_FEATURES)[number], boolean> {
  return Object.fromEntries(
    APP_SERVER_CONFIG_ENABLEMENT_FEATURES.map((name) => [name, sweFeatureEnabledByName(name, config)]),
  ) as Record<(typeof APP_SERVER_CONFIG_ENABLEMENT_FEATURES)[number], boolean>;
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

export function appServerRuntimeConfigInputFromEdits(config: RuntimeConfigState, edits: AppServerConfigEdit[]): RuntimeConfigInput {
  const next: RuntimeConfigInput = {
    features: { ...(config.features ?? {}) },
    desktopSettings: { ...(config.desktopSettings ?? {}) },
    sandboxWorkspaceWrite: { ...(config.sandboxWorkspaceWrite ?? {}) },
  };
  let providers: RuntimeConfigInput['providers'];

  const ensureProviders = () => {
    providers ??= config.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      models: provider.models.map((model) => ({ ...model })),
    }));
    return providers;
  };

  for (const edit of edits) {
    switch (edit.keyPath) {
      case 'model':
        providers = sweProvidersWithActiveModel(config, ensureProviders(), requiredRawString(edit.value, 'model'));
        break;
      case 'model_provider':
        next.activeProviderId = sweProviderIdForWrite(config, requiredRawString(edit.value, 'model_provider'));
        break;
      case 'approval_policy':
        next.approvalPolicy = appServerApprovalPolicyToRuntime(requiredRawString(edit.value, 'approval_policy'));
        break;
      case 'sandbox_mode':
        next.permissionProfile = sweSandboxModeToRuntime(requiredRawString(edit.value, 'sandbox_mode'));
        break;
      case 'sandbox_workspace_write':
        next.sandboxWorkspaceWrite = sweSandboxWorkspaceWriteInput(edit.value);
        break;
      case 'instructions':
        next.globalPrompt = edit.value === null ? '' : requiredRawString(edit.value, 'instructions');
        break;
      case 'model_reasoning_effort':
        providers = sweProvidersWithReasoningEffort(config, ensureProviders(), edit.value);
        break;
      case 'features':
        next.features = sweMergeObject(next.features ?? {}, sweBooleanRecord(edit.value, 'features'), edit.mergeStrategy);
        next.memoryEnabled = next.features.memories ?? config.memoryEnabled;
        break;
      case 'desktop':
        next.desktopSettings = sweMergeObject(next.desktopSettings ?? {}, recordInput(edit.value), edit.mergeStrategy);
        sweApplyDesktopSettings(next, next.desktopSettings);
        break;
      default:
        if (edit.keyPath.startsWith('features.')) {
          const name = edit.keyPath.slice('features.'.length);
          if (typeof edit.value !== 'boolean') throw new AppServerRpcError(-32602, `${edit.keyPath} must be a boolean`);
          next.features = { ...(next.features ?? {}), [name]: edit.value };
          if (name === 'memories') next.memoryEnabled = edit.value;
          break;
        }
        if (edit.keyPath.startsWith('desktop.')) {
          const key = edit.keyPath.slice('desktop.'.length);
          next.desktopSettings = { ...(next.desktopSettings ?? {}), [key]: edit.value };
          sweApplyDesktopSettings(next, { [key]: edit.value });
          break;
        }
        throw appServerConfigWriteError('configValidationError', `Unsupported config key path: ${edit.keyPath}`);
    }
  }

  if (providers) next.providers = providers;
  return next;
}

function sweProvidersWithActiveModel(
  config: RuntimeConfigState,
  providers: NonNullable<RuntimeConfigInput['providers']>,
  modelCode: string,
): NonNullable<RuntimeConfigInput['providers']> {
  const activeProviderId = config.activeProviderId ?? providers[0]?.id;
  return providers.map((provider) => {
    if (provider.id !== activeProviderId) return provider;
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
        { id: modelCode, name: modelCode, code: modelCode, enabled: true, maxOutputTokens: 68000, thinkingEnabled: false, thinkingEfforts: [] },
        ...models.map((model) => ({ ...model, enabled: false })),
      ],
    };
  });
}

function sweProvidersWithReasoningEffort(
  config: RuntimeConfigState,
  providers: NonNullable<RuntimeConfigInput['providers']>,
  value: unknown,
): NonNullable<RuntimeConfigInput['providers']> {
  const activeProviderId = config.activeProviderId ?? providers[0]?.id;
  const effort = value === null ? undefined : requiredRawString(value, 'model_reasoning_effort');
  return providers.map((provider) => {
    if (provider.id !== activeProviderId) return provider;
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

function sweProviderIdForWrite(config: RuntimeConfigState, value: string): string {
  const exact = config.providers.find((provider) => provider.id === value);
  if (exact) return exact.id;
  const byKind = config.providers.filter((provider) => provider.provider === value);
  if (byKind.length === 1) return byKind[0].id;
  throw appServerConfigWriteError('configValidationError', `Unknown model_provider: ${value}`);
}

function appServerApprovalPolicyToRuntime(value: string): RuntimeConfigState['approvalPolicy'] {
  if (value === 'never') return 'full';
  if (value === 'untrusted') return 'strict';
  if (value === 'on-request') return 'on-request';
  throw appServerConfigWriteError('configValidationError', `Unsupported approval_policy: ${value}`);
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
    writableRoots: Array.isArray(input.writable_roots)
      ? input.writable_roots.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    networkAccess: input.network_access === true,
    excludeTmpdirEnvVar: input.exclude_tmpdir_env_var === true,
    excludeSlashTmp: input.exclude_slash_tmp === true,
  };
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

function sweApplyDesktopSettings(input: RuntimeConfigInput, settings: Record<string, unknown>): void {
  if (hasOwn(settings, 'memory_enabled')) input.memoryEnabled = settings.memory_enabled === true;
  if (hasOwn(settings, 'setsuna_style')) input.setsunaStyle = settings.setsuna_style as string;
  if (hasOwn(settings, 'storage_path') && typeof settings.storage_path === 'string') {
    input.storagePath = settings.storage_path;
  }
}

export function sweSupportedFeatureEnablement(requested: Record<string, unknown>): Record<string, boolean> {
  const enabled: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(requested)) {
    if (!APP_SERVER_CONFIG_ENABLEMENT_FEATURES.includes(name as (typeof APP_SERVER_CONFIG_ENABLEMENT_FEATURES)[number])) {
      continue;
    }
    if (typeof value === 'boolean') enabled[name] = value;
  }
  return enabled;
}

export function sweFeatureEnablementRuntimeInput(
  config: RuntimeConfigState,
  enablement: Record<string, boolean>,
): RuntimeConfigInput {
  return {
    features: { ...(config.features ?? {}), ...enablement },
    memoryEnabled: enablement.memories ?? config.memoryEnabled,
  };
}

export function sweExperimentalFeatureListResponse(config: RuntimeConfigState, input: Record<string, unknown>) {
  const features = APP_SERVER_EXPERIMENTAL_FEATURES.map((feature) => ({
    name: feature.name,
    stage: feature.stage,
    displayName: feature.displayName,
    description: feature.description,
    announcement: feature.announcement,
    enabled: feature.forceDisabled ? false : sweFeatureEnabledByName(feature.name, config, feature.defaultEnabled),
    defaultEnabled: feature.defaultEnabled,
  }));
  return sweOffsetPage(features, stringInput(input.cursor), numericInput(input.limit), 'feature flags');
}

function sweFeatureEnabledByName(name: string, config: RuntimeConfigState, fallback = false): boolean {
  const configured = config.features?.[name];
  if (typeof configured === 'boolean') return configured;
  switch (name) {
    case 'memories':
      return config.memoryEnabled;
    case 'auth_elicitation':
    case 'remote_control':
    case 'remote_plugin':
      return false;
    case 'mentions_v2':
    case 'tool_suggest':
      return true;
    default:
      return fallback;
  }
}

export function sweCollaborationModeListResponse() {
  return {
    data: [
      {
        name: 'Plan',
        mode: 'plan',
        model: null,
        reasoning_effort: 'medium',
      },
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
  list: { servers: RuntimeMcpServer[] },
  input: Record<string, unknown>,
) {
  const statuses = [...list.servers]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(sweMcpServerStatus);
  return sweOffsetPage(statuses, stringInput(input.cursor), numericInput(input.limit), 'MCP servers');
}

function sweMcpServerStatus(server: RuntimeMcpServer) {
  return {
    name: server.key,
    serverInfo: null,
    tools: Object.fromEntries(server.tools.map((tool) => [tool.name, {
      description: tool.description ?? null,
    }])),
    resources: [],
    resourceTemplates: [],
    authStatus: 'unsupported',
  };
}

function sweOffsetPage<T>(items: T[], cursor: string | undefined, limit: number | undefined, totalLabel: string) {
  const total = items.length;
  if (total === 0) return { data: [], nextCursor: null };

  const effectiveLimit = Math.min(total, Math.max(1, Math.trunc(limit ?? total)));
  const start = cursor ? sweOffsetCursor(cursor, total, totalLabel) : 0;
  const end = Math.min(total, start + effectiveLimit);
  return {
    data: items.slice(start, end),
    nextCursor: end < total ? String(end) : null,
  };
}

function sweOffsetCursor(cursor: string, total: number, totalLabel: string): number {
  if (!/^\d+$/.test(cursor)) throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  const start = Number(cursor);
  if (!Number.isSafeInteger(start)) throw new AppServerRpcError(-32600, `invalid cursor: ${cursor}`);
  if (start > total) throw new AppServerRpcError(-32600, `cursor ${start} exceeds total ${totalLabel} ${total}`);
  return start;
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

function sweModelCatalogId(provider: ProviderConfigState, model: ProviderConfigState['models'][number]): string {
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
  return config.providers.find((item) => item.id === config.activeProviderId) ?? config.providers[0];
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
    writable_roots: sandbox.writableRoots?.length ? sandbox.writableRoots : [cwd],
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
  const provider = config.providers.find((item) => item.id === config.activeProviderId) ?? config.providers[0];
  return provider?.models.find((model) => model.enabled) ?? provider?.models[0] ?? null;
}

function activeModelReasoningEffort(config: RuntimeConfigState): string | null {
  const model = activeModelConfig(config);
  if (!model?.thinkingEnabled) return null;
  return model.defaultThinkingEffort ?? sweReasoningEfforts(model)[0] ?? null;
}

export function activeModelCode(config: Awaited<ReturnType<RuntimeFactory['configStore']['getConfig']>>): string {
  return activeModelConfig(config)?.code ?? 'unknown';
}

export function activeModelProvider(config: Awaited<ReturnType<RuntimeFactory['configStore']['getConfig']>>): string {
  const provider = config.providers.find((item) => item.id === config.activeProviderId) ?? config.providers[0];
  return provider?.id ?? 'unknown';
}
