export type RuntimeMcpTransport = 'stdio' | 'streamableHttp';

export type RuntimeMcpRequireApproval = 'auto' | 'prompt' | 'approve' | 'always' | 'never';

export type RuntimeMcpServerSource = 'local' | 'workspace' | 'legacy' | 'builtin';

export type RuntimeMcpAuthStatus = 'unsupported' | 'notLoggedIn' | 'bearerToken' | 'oAuth';

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
  enabled: boolean;
  allowedTools: string[];
  disabledTools: string[];
  oauthClientId?: string;
  oauthResource?: string;
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
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  approvalMode?: RuntimeMcpRequireApproval;
};

export type RuntimeMcpToolList = {
  tools: RuntimeMcpToolInfo[];
  errors: string[];
};

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
