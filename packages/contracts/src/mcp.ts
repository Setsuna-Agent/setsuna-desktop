export type RuntimeMcpTransport = 'stdio' | 'streamableHttp';

export type RuntimeMcpRequireApproval = 'never' | 'on-write' | 'always';

export type RuntimeMcpServerSource = 'local' | 'workspace' | 'legacy' | 'builtin';

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
  env?: Record<string, string>;
  headers?: Record<string, string>;
};

export type RuntimeMcpServerPatch = Omit<Partial<RuntimeMcpServerInput>, 'key'>;
