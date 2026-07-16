export type RuntimeMcpTransport = 'stdio' | 'streamableHttp';

export type RuntimeMcpRequireApproval = 'auto' | 'prompt' | 'approve' | 'always' | 'never';

export type RuntimeMcpServerSource = 'local' | 'workspace' | 'legacy' | 'builtin';

export type RuntimeMcpTrustLevel = 'untrusted' | 'trusted';

export type RuntimeMcpAuthStatus =
  | 'unsupported'
  | 'notLoggedIn'
  | 'bearerToken'
  | 'oAuth'
  | 'oAuthLoggingIn'
  | 'oAuthExpired'
  | 'oAuthError';

export type RuntimeMcpServer = {
  key: string;
  label: string;
  description?: string;
  transport: RuntimeMcpTransport;
  command?: string;
  args: string[];
  cwd?: string;
  url?: string;
  timeoutMs: number;
  startupTimeoutMs: number;
  toolTimeoutMs: number;
  required: boolean;
  requireApproval: RuntimeMcpRequireApproval;
  trustLevel: RuntimeMcpTrustLevel;
  enabled: boolean;
  allowedTools: string[];
  disabledTools: string[];
  oauthClientId?: string;
  oauthResource?: string;
  authStatus?: RuntimeMcpAuthStatus;
  authError?: string;
  tools: RuntimeMcpToolInfo[];
  envKeys: string[];
  headerKeys: string[];
  source: RuntimeMcpServerSource;
  sourcePath?: string;
  readOnly: boolean;
};

export type RuntimeMcpServerList = {
  configPath: string;
  workspaceConfigPaths: string[];
  servers: RuntimeMcpServer[];
  errors: string[];
};

export type RuntimeMcpToolInfo = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  approvalMode?: RuntimeMcpRequireApproval;
};

export type RuntimeMcpToolList = {
  tools: RuntimeMcpToolInfo[];
  errors: string[];
};

export type RuntimeMcpResource = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  [key: string]: unknown;
};

export type RuntimeMcpResourceTemplate = {
  uriTemplate: string;
  name?: string;
  description?: string;
  mimeType?: string;
  [key: string]: unknown;
};

export type RuntimeMcpServerStatus = {
  name: string;
  authStatus: RuntimeMcpAuthStatus;
  resources: RuntimeMcpResource[];
  resourceTemplates: RuntimeMcpResourceTemplate[];
  tools: Record<string, RuntimeMcpToolInfo>;
  serverInfo?: Record<string, unknown> | null;
  connectionState?: 'connecting' | 'ready' | 'disconnected' | 'error';
  protocolVersion?: string;
  connectedAt?: string;
  updatedAt?: string;
  error?: string;
};

export type RuntimeMcpServerStatusList = {
  data: RuntimeMcpServerStatus[];
  nextCursor: string | null;
};

export type RuntimeMcpResourceReadResult = Record<string, unknown>;
export type RuntimeMcpToolCallResult = Record<string, unknown>;

export type RuntimeMcpServerInput = {
  key: string;
  label?: string;
  description?: string;
  transport?: RuntimeMcpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  timeoutMs?: number;
  startupTimeoutMs?: number;
  toolTimeoutMs?: number;
  required?: boolean;
  requireApproval?: RuntimeMcpRequireApproval;
  trustLevel?: RuntimeMcpTrustLevel;
  enabled?: boolean;
  allowedTools?: string[];
  disabledTools?: string[];
  tools?: RuntimeMcpToolInfo[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
  bearerTokenEnvVar?: string;
  oauthClientId?: string;
  oauthResource?: string;
};

export type RuntimeMcpServerPatch = Omit<Partial<RuntimeMcpServerInput>, 'key'>;
