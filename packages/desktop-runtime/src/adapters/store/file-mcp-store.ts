import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  RuntimeMcpRequireApproval,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
  RuntimeMcpToolInfo,
  RuntimeMcpTransport,
} from '@setsuna-desktop/contracts';
import type { McpStore } from '../../ports/mcp-store.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

type StoredMcpConfig = {
  mcpServers?: Record<string, StoredMcpServer>;
  mcp_servers?: Record<string, StoredMcpServer>;
  servers?: Record<string, StoredMcpServer>;
};

type StoredMcpConfigTopLevelKey = 'mcp_servers' | 'mcpServers';

type NormalizedStoredMcpConfig = {
  mcpServers: Record<string, StoredMcpServer>;
  topLevelKey: StoredMcpConfigTopLevelKey;
};

type StoredMcpServer = {
  label?: string;
  name?: string;
  description?: string;
  transport?: string;
  type?: string;
  command?: string;
  args?: unknown;
  cwd?: string;
  url?: string;
  serverUrl?: string;
  server_url?: string;
  timeoutMs?: unknown;
  timeout_ms?: unknown;
  timeout?: unknown;
  startupTimeoutMs?: unknown;
  startup_timeout_ms?: unknown;
  startup_timeout_sec?: unknown;
  toolTimeoutMs?: unknown;
  tool_timeout_ms?: unknown;
  tool_timeout_sec?: unknown;
  required?: boolean;
  requireApproval?: string;
  require_approval?: string;
  defaultToolsApprovalMode?: string;
  default_tools_approval_mode?: string;
  enabled?: boolean;
  disabled?: boolean;
  allowedTools?: unknown;
  allowed_tools?: unknown;
  enabledTools?: unknown;
  enabled_tools?: unknown;
  disabledTools?: unknown;
  disabled_tools?: unknown;
  tools?: unknown;
  env?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  httpHeaders?: Record<string, unknown>;
  http_headers?: Record<string, unknown>;
  envHttpHeaders?: Record<string, unknown>;
  env_http_headers?: Record<string, unknown>;
  extraHeaders?: Record<string, unknown>;
  extra_headers?: Record<string, unknown>;
  bearerTokenEnvVar?: string;
  bearer_token_env_var?: string;
  bearer_token?: unknown;
  oauth?: Record<string, unknown>;
  oauthClientId?: string;
  oauth_client_id?: string;
  oauthResource?: string;
  oauth_resource?: string;
};

export class FileMcpStore implements McpStore {
  readonly configPath: string;

  constructor(dataDir: string) {
    this.configPath = path.join(dataDir, 'mcp.json');
  }

  async listServers(): Promise<RuntimeMcpServerList> {
    const { config, errors } = await this.readConfig();
    const servers = Object.entries(config.mcpServers ?? {})
      .map(([key, server]) => normalizeServer(key, server, this.configPath, errors))
      .filter((server): server is RuntimeMcpServer => Boolean(server))
      .sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
    return {
      configPath: this.configPath,
      workspaceConfigPaths: [],
      servers,
      errors,
    };
  }

  async listServerInputs(): Promise<RuntimeMcpServerInput[]> {
    const { config } = await this.readConfig();
    return Object.entries(config.mcpServers ?? {})
      .map(([key, server]) => normalizeServerInput(key, server))
      .filter((server): server is RuntimeMcpServerInput => Boolean(server))
      .sort((left, right) => (left.label ?? left.key).localeCompare(right.label ?? right.key) || left.key.localeCompare(right.key));
  }

  async upsertServer(input: RuntimeMcpServerInput): Promise<RuntimeMcpServerList> {
    const key = normalizeKey(input.key);
    const { config } = await this.readConfig();
    const previous = config.mcpServers?.[key] ?? {};
    const next = applyServerInput(previous, input);
    validateStoredServer(key, next);
    config.mcpServers = {
      ...(config.mcpServers ?? {}),
      [key]: pruneTransportFields(next),
    };
    await this.writeConfig(config);
    return this.listServers();
  }

  async updateServer(keyInput: string, patch: RuntimeMcpServerPatch): Promise<RuntimeMcpServerList> {
    const key = normalizeKey(keyInput);
    const { config } = await this.readConfig();
    if (!config.mcpServers?.[key]) throw new Error(`MCP server not found: ${key}`);
    const next = applyServerInput(config.mcpServers[key], { ...patch, key });
    validateStoredServer(key, next);
    config.mcpServers = {
      ...config.mcpServers,
      [key]: pruneTransportFields(next),
    };
    await this.writeConfig(config);
    return this.listServers();
  }

  async setToolApprovalMode(keyInput: string, toolNameInput: string, approvalMode: RuntimeMcpRequireApproval): Promise<RuntimeMcpServerList> {
    const key = normalizeKey(keyInput);
    const toolName = nonEmpty(toolNameInput);
    if (!toolName) throw new Error('MCP tool name is required.');
    const { config } = await this.readConfig();
    const server = config.mcpServers?.[key];
    if (!server) throw new Error(`MCP server not found: ${key}`);
    const normalizedApprovalMode = normalizeRequireApproval(approvalMode);
    const next: StoredMcpServer = {
      ...server,
      tools: withToolApprovalMode(server.tools, toolName, normalizedApprovalMode),
    };
    validateStoredServer(key, next);
    config.mcpServers = {
      ...config.mcpServers,
      [key]: pruneTransportFields(next),
    };
    await this.writeConfig(config);
    return this.listServers();
  }

  async deleteServer(keyInput: string): Promise<void> {
    const key = normalizeKey(keyInput);
    const { config } = await this.readConfig();
    if (!config.mcpServers?.[key]) return;
    const { [key]: _deleted, ...rest } = config.mcpServers;
    config.mcpServers = rest;
    await this.writeConfig(config);
  }

  private async readConfig(): Promise<{ config: NormalizedStoredMcpConfig; errors: string[] }> {
    const errors: string[] = [];
    const raw = await readJsonFile<StoredMcpConfig>(this.configPath, {});
    const topLevelKey = mcpConfigTopLevelKey(raw);
    const rawServers = raw.mcp_servers ?? raw.mcpServers ?? raw.servers ?? {};
    const mcpServers: Record<string, StoredMcpServer> = {};
    if (!rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers)) {
      errors.push(`${this.configPath}: mcpServers must be an object.`);
      return { config: { mcpServers, topLevelKey }, errors };
    }
    for (const [rawKey, value] of Object.entries(rawServers)) {
      try {
        const key = normalizeKey(rawKey);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          errors.push(`${this.configPath}: MCP server ${key} is not an object.`);
          continue;
        }
        mcpServers[key] = value;
      } catch (error) {
        errors.push(`${this.configPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { config: { mcpServers, topLevelKey }, errors };
  }

  private async writeConfig(config: NormalizedStoredMcpConfig): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeJsonFile(this.configPath, { [config.topLevelKey]: config.mcpServers });
  }
}

function mcpConfigTopLevelKey(raw: StoredMcpConfig): StoredMcpConfigTopLevelKey {
  if (raw.mcp_servers && typeof raw.mcp_servers === 'object' && !Array.isArray(raw.mcp_servers)) return 'mcp_servers';
  if (raw.mcpServers && typeof raw.mcpServers === 'object' && !Array.isArray(raw.mcpServers)) return 'mcpServers';
  return 'mcp_servers';
}

function normalizeServer(
  rawKey: string,
  rawServer: StoredMcpServer,
  sourcePath: string,
  errors: string[],
): RuntimeMcpServer | null {
  try {
    const key = normalizeKey(rawKey);
    const command = nonEmpty(rawServer.command);
    const url = nonEmpty(rawServer.url ?? rawServer.serverUrl ?? rawServer.server_url);
    const transport = normalizeTransport(rawServer.transport ?? rawServer.type, command, url);
    validateTransport(key, transport, command, url);
    const timeoutMs = timeout(rawServer.timeoutMs ?? rawServer.timeout_ms ?? rawServer.timeout, DEFAULT_TIMEOUT_MS);
    const startupTimeoutMs = timeout(rawServer.startupTimeoutMs ?? rawServer.startup_timeout_ms ?? secondsToMilliseconds(rawServer.startup_timeout_sec), timeoutMs);
    const toolTimeoutMs = timeout(rawServer.toolTimeoutMs ?? rawServer.tool_timeout_ms ?? secondsToMilliseconds(rawServer.tool_timeout_sec), timeoutMs);
    ensureNoInlineBearerToken(key, rawServer);
    return {
      key,
      label: nonEmpty(rawServer.label ?? rawServer.name) ?? key,
      description: nonEmpty(rawServer.description),
      transport,
      command,
      args: stringList(rawServer.args),
      cwd: nonEmpty(rawServer.cwd),
      url,
      timeoutMs,
      startupTimeoutMs,
      toolTimeoutMs,
      required: rawServer.required === true,
      requireApproval: normalizeRequireApproval(serverApprovalMode(rawServer)),
      enabled: rawServer.enabled !== false && rawServer.disabled !== true,
      allowedTools: stringList(rawServer.allowedTools ?? rawServer.allowed_tools ?? rawServer.enabledTools ?? rawServer.enabled_tools),
      disabledTools: stringList(rawServer.disabledTools ?? rawServer.disabled_tools),
      oauthClientId: serverOauthClientId(rawServer),
      oauthResource: serverOauthResource(rawServer),
      tools: mcpToolList(rawServer.tools),
      envKeys: serverEnvKeys(rawServer),
      headerKeys: serverHeaderKeys(rawServer),
      source: 'local',
      sourcePath,
      readOnly: false,
    };
  } catch (error) {
    errors.push(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function normalizeServerInput(rawKey: string, rawServer: StoredMcpServer): RuntimeMcpServerInput | null {
  try {
    const key = normalizeKey(rawKey);
    const command = nonEmpty(rawServer.command);
    const url = nonEmpty(rawServer.url ?? rawServer.serverUrl ?? rawServer.server_url);
    const transport = normalizeTransport(rawServer.transport ?? rawServer.type, command, url);
    validateTransport(key, transport, command, url);
    const timeoutMs = timeout(rawServer.timeoutMs ?? rawServer.timeout_ms ?? rawServer.timeout, DEFAULT_TIMEOUT_MS);
    const startupTimeoutMs = timeout(rawServer.startupTimeoutMs ?? rawServer.startup_timeout_ms ?? secondsToMilliseconds(rawServer.startup_timeout_sec), timeoutMs);
    const toolTimeoutMs = timeout(rawServer.toolTimeoutMs ?? rawServer.tool_timeout_ms ?? secondsToMilliseconds(rawServer.tool_timeout_sec), timeoutMs);
    ensureNoInlineBearerToken(key, rawServer);
    return {
      key,
      label: nonEmpty(rawServer.label ?? rawServer.name) ?? key,
      description: nonEmpty(rawServer.description),
      transport,
      command,
      args: stringList(rawServer.args),
      cwd: nonEmpty(rawServer.cwd),
      url,
      timeoutMs,
      startupTimeoutMs,
      toolTimeoutMs,
      required: rawServer.required === true,
      requireApproval: normalizeRequireApproval(serverApprovalMode(rawServer)),
      enabled: rawServer.enabled !== false && rawServer.disabled !== true,
      allowedTools: stringList(rawServer.allowedTools ?? rawServer.allowed_tools ?? rawServer.enabledTools ?? rawServer.enabled_tools),
      disabledTools: stringList(rawServer.disabledTools ?? rawServer.disabled_tools),
      tools: mcpToolList(rawServer.tools),
      env: stringMap(rawServer.env),
      headers: stringMap(serverStaticHeaders(rawServer)),
      envHttpHeaders: stringMap(serverEnvHttpHeaders(rawServer)),
      bearerTokenEnvVar: nonEmpty(rawServer.bearerTokenEnvVar ?? rawServer.bearer_token_env_var),
      oauthClientId: serverOauthClientId(rawServer),
      oauthResource: serverOauthResource(rawServer),
    };
  } catch {
    return null;
  }
}

function applyServerInput(previous: StoredMcpServer, input: RuntimeMcpServerInput): StoredMcpServer {
  const next: StoredMcpServer = { ...previous };
  if (input.label !== undefined) next.label = nonEmpty(input.label) ?? input.key;
  if (input.description !== undefined) next.description = nonEmpty(input.description) ?? undefined;
  if (input.transport !== undefined) next.transport = input.transport;
  if (input.command !== undefined) next.command = nonEmpty(input.command) ?? undefined;
  if (input.args !== undefined) next.args = input.args.filter((item) => item.trim()).map((item) => item.trim());
  if (input.cwd !== undefined) next.cwd = nonEmpty(input.cwd) ?? undefined;
  if (input.url !== undefined) next.url = nonEmpty(input.url) ?? undefined;
  if (input.timeoutMs !== undefined) next.timeoutMs = timeout(input.timeoutMs, DEFAULT_TIMEOUT_MS);
  if (input.startupTimeoutMs !== undefined) next.startupTimeoutMs = timeout(input.startupTimeoutMs, DEFAULT_TIMEOUT_MS);
  if (input.toolTimeoutMs !== undefined) next.toolTimeoutMs = timeout(input.toolTimeoutMs, DEFAULT_TIMEOUT_MS);
  if (input.required !== undefined) next.required = input.required;
  if (input.requireApproval !== undefined) {
    next.default_tools_approval_mode = normalizeRequireApproval(input.requireApproval);
    delete next.defaultToolsApprovalMode;
    delete next.requireApproval;
    delete next.require_approval;
  }
  if (input.enabled !== undefined) next.enabled = input.enabled;
  if (input.allowedTools !== undefined) {
    next.enabled_tools = input.allowedTools.filter((item) => item.trim()).map((item) => item.trim());
    delete next.allowedTools;
    delete next.allowed_tools;
    delete next.enabledTools;
  }
  if (input.disabledTools !== undefined) {
    next.disabled_tools = input.disabledTools.filter((item) => item.trim()).map((item) => item.trim());
    delete next.disabledTools;
  }
  if (input.tools !== undefined) next.tools = mcpToolList(input.tools);
  if (input.env !== undefined) next.env = normalizeStringMap(input.env);
  if (input.headers !== undefined) next.headers = normalizeStringMap(input.headers);
  if (input.envHttpHeaders !== undefined) {
    next.env_http_headers = normalizeStringMap(input.envHttpHeaders);
    delete next.envHttpHeaders;
  }
  if (input.bearerTokenEnvVar !== undefined) {
    next.bearer_token_env_var = nonEmpty(input.bearerTokenEnvVar) ?? undefined;
    delete next.bearerTokenEnvVar;
  }
  if (input.oauthClientId !== undefined) setOAuthClientId(next, input.oauthClientId);
  if (input.oauthResource !== undefined) setOAuthResource(next, input.oauthResource);
  next.default_tools_approval_mode = normalizeRequireApproval(serverApprovalMode(next));
  delete next.defaultToolsApprovalMode;
  delete next.requireApproval;
  delete next.require_approval;
  if (!next.transport) next.transport = next.command ? 'stdio' : 'streamableHttp';
  if (!next.timeoutMs) next.timeoutMs = DEFAULT_TIMEOUT_MS;
  if (!next.startupTimeoutMs) next.startupTimeoutMs = next.timeoutMs;
  if (!next.toolTimeoutMs) next.toolTimeoutMs = next.timeoutMs;
  return next;
}

function validateStoredServer(key: string, server: StoredMcpServer): void {
  ensureNoInlineBearerToken(key, server);
  const transport = normalizeTransport(server.transport ?? server.type, nonEmpty(server.command), nonEmpty(server.url));
  validateTransport(key, transport, nonEmpty(server.command), nonEmpty(server.url));
}

function validateTransport(key: string, transport: RuntimeMcpTransport, command?: string, url?: string): void {
  if (transport === 'stdio' && !command) throw new Error(`MCP server ${key} requires a command.`);
  if (transport === 'streamableHttp' && !url) throw new Error(`MCP server ${key} requires a url.`);
}

function pruneTransportFields(server: StoredMcpServer): StoredMcpServer {
  const transport = normalizeTransport(server.transport ?? server.type, nonEmpty(server.command), nonEmpty(server.url));
  const next = { ...server, transport };
  if (transport === 'stdio') {
    delete next.url;
    delete next.serverUrl;
    delete next.server_url;
    delete next.headers;
    delete next.httpHeaders;
    delete next.http_headers;
    delete next.envHttpHeaders;
    delete next.env_http_headers;
    delete next.extraHeaders;
    delete next.extra_headers;
    delete next.bearerTokenEnvVar;
    delete next.bearer_token_env_var;
    delete next.bearer_token;
    delete next.oauth;
    delete next.oauthClientId;
    delete next.oauth_client_id;
    delete next.oauthResource;
    delete next.oauth_resource;
  } else {
    delete next.command;
    delete next.args;
    delete next.cwd;
    delete next.env;
  }
  return next;
}

function normalizeKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!key) throw new Error('MCP server key is required.');
  return key;
}

function normalizeTransport(value: unknown, command?: string, url?: string): RuntimeMcpTransport {
  if (value === 'stdio') return 'stdio';
  if (value === 'streamableHttp' || value === 'streamable-http' || value === 'streamable_http' || value === 'http') return 'streamableHttp';
  return command || !url ? 'stdio' : 'streamableHttp';
}

function serverApprovalMode(server: StoredMcpServer): unknown {
  return server.default_tools_approval_mode ?? server.defaultToolsApprovalMode ?? server.requireApproval ?? server.require_approval;
}

function serverStaticHeaders(server: StoredMcpServer): unknown {
  return server.headers ?? server.httpHeaders ?? server.http_headers ?? server.extraHeaders ?? server.extra_headers;
}

function serverEnvHttpHeaders(server: StoredMcpServer): unknown {
  return server.envHttpHeaders ?? server.env_http_headers;
}

function serverOauthClientId(server: StoredMcpServer): string | undefined {
  const oauth = plainRecord(server.oauth);
  return nonEmpty(server.oauthClientId ?? server.oauth_client_id ?? oauth?.clientId ?? oauth?.client_id);
}

function serverOauthResource(server: StoredMcpServer): string | undefined {
  return nonEmpty(server.oauthResource ?? server.oauth_resource);
}

function serverHeaderKeys(server: StoredMcpServer): string[] {
  const keys = [...objectKeys(serverStaticHeaders(server)), ...objectKeys(serverEnvHttpHeaders(server))];
  if (nonEmpty(server.bearerTokenEnvVar ?? server.bearer_token_env_var)) keys.push('Authorization');
  return uniqueSorted(keys);
}

function serverEnvKeys(server: StoredMcpServer): string[] {
  const keys = [...objectKeys(server.env), ...objectStringValues(serverEnvHttpHeaders(server))];
  const bearerTokenEnvVar = nonEmpty(server.bearerTokenEnvVar ?? server.bearer_token_env_var);
  if (bearerTokenEnvVar) keys.push(bearerTokenEnvVar);
  return uniqueSorted(keys);
}

function ensureNoInlineBearerToken(key: string, server: StoredMcpServer): void {
  if (server.bearer_token !== undefined) {
    throw new Error(`mcp_servers.${key} uses unsupported bearer_token; set bearer_token_env_var.`);
  }
}

function normalizeRequireApproval(value: unknown): RuntimeMcpRequireApproval {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'approve' || raw === 'approved' || raw === 'never' || raw === 'false') return 'approve';
  if (raw === 'prompt' || raw === 'always' || raw === 'true') return 'prompt';
  return 'auto';
}

function normalizeOptionalRequireApproval(value: unknown): RuntimeMcpRequireApproval | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizeRequireApproval(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
}

function mcpToolList(value: unknown): RuntimeMcpToolInfo[] {
  const byName = new Map<string, RuntimeMcpToolInfo>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const name = nonEmpty(record.name);
      if (name) byName.set(name, toolInfoFromRecord(name, record));
    }
  } else if (value && typeof value === 'object') {
    for (const [rawName, rawConfig] of Object.entries(value)) {
      const name = nonEmpty(rawName);
      if (!name) continue;
      const record = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
        ? rawConfig as Record<string, unknown>
        : {};
      byName.set(name, toolInfoFromRecord(name, record));
    }
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function toolInfoFromRecord(name: string, record: Record<string, unknown>): RuntimeMcpToolInfo {
  const description = nonEmpty(record.description);
  const inputSchema = plainRecord(record.inputSchema ?? record.input_schema);
  const annotations = plainRecord(record.annotations);
  const approvalMode = normalizeOptionalRequireApproval(record.approvalMode ?? record.approval_mode ?? record.requireApproval ?? record.require_approval);
  return {
    name,
    ...(description ? { description } : {}),
    ...(inputSchema ? { inputSchema } : {}),
    ...(annotations ? { annotations } : {}),
    ...(approvalMode ? { approvalMode } : {}),
  };
}

function withToolApprovalMode(value: unknown, toolName: string, approvalMode: RuntimeMcpRequireApproval): unknown {
  if (Array.isArray(value)) {
    const tools = mcpToolList(value);
    const index = tools.findIndex((tool) => tool.name === toolName);
    if (index >= 0) {
      tools[index] = { ...tools[index], approvalMode };
    } else {
      tools.push({ name: toolName, approvalMode });
    }
    return tools;
  }
  const tools = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const existing = plainRecord(tools[toolName]) ?? {};
  const nextTool = { ...existing, approval_mode: approvalMode };
  delete (nextTool as Record<string, unknown>).approvalMode;
  delete (nextTool as Record<string, unknown>).requireApproval;
  delete (nextTool as Record<string, unknown>).require_approval;
  return {
    ...tools,
    [toolName]: nextTool,
  };
}

function setOAuthClientId(server: StoredMcpServer, value: string | undefined): void {
  const clientId = nonEmpty(value);
  const oauth = { ...(plainRecord(server.oauth) ?? {}) };
  delete oauth.clientId;
  if (clientId) {
    oauth.client_id = clientId;
  } else {
    delete oauth.client_id;
  }
  if (Object.keys(oauth).length) server.oauth = oauth;
  else delete server.oauth;
  delete server.oauthClientId;
  delete server.oauth_client_id;
}

function setOAuthResource(server: StoredMcpServer, value: string | undefined): void {
  const resource = nonEmpty(value);
  if (resource) server.oauth_resource = resource;
  else delete server.oauth_resource;
  delete server.oauthResource;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeStringMap(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => key.trim() && item.trim()).map(([key, item]) => [key.trim(), item.trim()]));
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, item]) => [key.trim(), typeof item === 'string' ? item.trim() : ''] as const)
    .filter(([key, item]) => key && item);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => key.trim()).sort((a, b) => a.localeCompare(b));
}

function objectStringValues(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))].sort((a, b) => a.localeCompare(b));
}

function timeout(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), MAX_TIMEOUT_MS);
}

function secondsToMilliseconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value * 1000);
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
