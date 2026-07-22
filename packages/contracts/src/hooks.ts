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
