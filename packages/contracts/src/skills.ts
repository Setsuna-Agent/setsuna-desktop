import type { RuntimeMcpAuthStatus, RuntimeMcpTransport } from './mcp.js';

export type RuntimeSkillKind = 'builtin' | 'plugin' | 'user';

export type RuntimeSkillMcpDependencyInput = {
  type: 'mcp';
  /** 面向模型的工具名称所引用的稳定 MCP 服务器键。 */
  value: string;
  transport: RuntimeMcpTransport;
  label?: string;
  description?: string;
  url?: string;
  command?: string;
  args?: string[];
  oauthClientId?: string;
  oauthResource?: string;
};

export type RuntimeSkillMcpDependencyStatus =
  | 'unchecked'
  | 'missing'
  | 'disabled'
  | 'ready'
  | 'authRequired'
  | 'conflict'
  | 'error';

export type RuntimeSkillMcpDependency = RuntimeSkillMcpDependencyInput & {
  status: RuntimeSkillMcpDependencyStatus;
  authStatus?: RuntimeMcpAuthStatus;
  error?: string;
};

export type RuntimeSkillSummary = {
  id: string;
  name: string;
  kind: RuntimeSkillKind;
  enabled: boolean;
  selected: boolean;
  description?: string;
  path?: string;
  pluginId?: string;
  mcpDependencies?: RuntimeSkillMcpDependency[];
  dependencyErrors?: string[];
};

export type RuntimeSkillDetail = RuntimeSkillSummary & {
  content: string;
  references: string[];
};

export type RuntimeSkillList = {
  skills: RuntimeSkillSummary[];
};

export type RuntimeSkillInput = {
  id?: string;
  name: string;
  description?: string;
  content: string;
  enabled?: boolean;
  selected?: boolean;
  mcpDependencies?: RuntimeSkillMcpDependencyInput[];
};

export type RuntimeSkillPatch = {
  enabled?: boolean;
  selected?: boolean;
  name?: string;
  description?: string;
  content?: string;
  mcpDependencies?: RuntimeSkillMcpDependencyInput[];
};

export type RuntimeSkillMcpDependencyInstallResult = {
  skill: RuntimeSkillDetail;
  installed: string[];
  enabled: string[];
};
