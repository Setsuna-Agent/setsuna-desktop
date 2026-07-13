import type { ModelProviderKind } from './provider.js';

export type ProviderConfigState = {
  id: string;
  name: string;
  provider: ModelProviderKind;
  baseUrl: string;
  enabled: boolean;
  apiKeySet: boolean;
  apiKeyPreview: string;
  models: ProviderModelConfig[];
};

export type ProviderModelConfig = {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
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
};

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
  providers?: ProviderConfigInput[];
};
