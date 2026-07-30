import type { RuntimeConfigInput, RuntimeConfigState } from '@setsuna-desktop/contracts';
import { numericInput, stringInput } from './input.js';
import { sweOffsetPage } from './pagination.js';

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

const APP_SERVER_CONFIG_ENABLEMENT_FEATURES = [
  'auth_elicitation',
  'default_mode_request_user_input',
  'hooks',
  'memories',
  'mentions_v2',
  'plugins',
  'remote_control',
  'remote_plugin',
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
  { name: 'non_prefixed_mcp_tool_names', stage: 'underDevelopment', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'unavailable_dummy_tools', stage: 'removed', defaultEnabled: false, displayName: null, description: null, announcement: null },
  { name: 'plugins', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
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
  { name: 'default_mode_request_user_input', stage: 'stable', defaultEnabled: true, displayName: null, description: null, announcement: null },
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

export function appServerConfigFeatureEnablement(
  config: RuntimeConfigState,
): Record<(typeof APP_SERVER_CONFIG_ENABLEMENT_FEATURES)[number], boolean> {
  return Object.fromEntries(
    APP_SERVER_CONFIG_ENABLEMENT_FEATURES.map((name) => {
      const feature = APP_SERVER_EXPERIMENTAL_FEATURES.find((item) => item.name === name);
      return [name, sweFeatureEnabledByName(name, config, feature?.defaultEnabled ?? false)];
    }),
  ) as Record<(typeof APP_SERVER_CONFIG_ENABLEMENT_FEATURES)[number], boolean>;
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
    case 'auth_elicitation':
    case 'remote_control':
    case 'remote_plugin':
      return false;
    case 'mentions_v2':
      return true;
    default:
      return fallback;
  }
}
