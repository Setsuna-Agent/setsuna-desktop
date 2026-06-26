import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  RuntimeMcpRequireApproval,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
  RuntimeMcpTransport,
} from '@setsuna-desktop/contracts';
import type { McpStore } from '../../ports/mcp-store.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

type StoredMcpConfig = {
  mcpServers?: Record<string, StoredMcpServer>;
  servers?: Record<string, StoredMcpServer>;
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
  toolTimeoutMs?: unknown;
  tool_timeout_ms?: unknown;
  required?: boolean;
  requireApproval?: string;
  require_approval?: string;
  enabled?: boolean;
  disabled?: boolean;
  allowedTools?: unknown;
  allowed_tools?: unknown;
  disabledTools?: unknown;
  disabled_tools?: unknown;
  env?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  extraHeaders?: Record<string, unknown>;
  extra_headers?: Record<string, unknown>;
};

export class FileMcpStore implements McpStore {
  private readonly configPath: string;

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

  async deleteServer(keyInput: string): Promise<void> {
    const key = normalizeKey(keyInput);
    const { config } = await this.readConfig();
    if (!config.mcpServers?.[key]) return;
    const { [key]: _deleted, ...rest } = config.mcpServers;
    config.mcpServers = rest;
    await this.writeConfig(config);
  }

  private async readConfig(): Promise<{ config: Required<Pick<StoredMcpConfig, 'mcpServers'>>; errors: string[] }> {
    const errors: string[] = [];
    const raw = await readJsonFile<StoredMcpConfig>(this.configPath, { mcpServers: {} });
    const rawServers = raw.mcpServers ?? raw.servers ?? {};
    const mcpServers: Record<string, StoredMcpServer> = {};
    if (!rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers)) {
      errors.push(`${this.configPath}: mcpServers must be an object.`);
      return { config: { mcpServers }, errors };
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
    return { config: { mcpServers }, errors };
  }

  private async writeConfig(config: Required<Pick<StoredMcpConfig, 'mcpServers'>>): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeJsonFile(this.configPath, { mcpServers: config.mcpServers });
  }
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
    const startupTimeoutMs = timeout(rawServer.startupTimeoutMs ?? rawServer.startup_timeout_ms, timeoutMs);
    const toolTimeoutMs = timeout(rawServer.toolTimeoutMs ?? rawServer.tool_timeout_ms, timeoutMs);
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
      requireApproval: normalizeRequireApproval(rawServer.requireApproval ?? rawServer.require_approval),
      enabled: rawServer.enabled !== false && rawServer.disabled !== true,
      allowedTools: stringList(rawServer.allowedTools ?? rawServer.allowed_tools),
      disabledTools: stringList(rawServer.disabledTools ?? rawServer.disabled_tools),
      envKeys: objectKeys(rawServer.env),
      headerKeys: objectKeys(rawServer.headers ?? rawServer.extraHeaders ?? rawServer.extra_headers),
      source: 'local',
      sourcePath,
      readOnly: false,
    };
  } catch (error) {
    errors.push(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
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
  if (input.requireApproval !== undefined) next.requireApproval = input.requireApproval;
  if (input.enabled !== undefined) next.enabled = input.enabled;
  if (input.allowedTools !== undefined) next.allowedTools = input.allowedTools.filter((item) => item.trim()).map((item) => item.trim());
  if (input.disabledTools !== undefined) next.disabledTools = input.disabledTools.filter((item) => item.trim()).map((item) => item.trim());
  if (input.env !== undefined) next.env = normalizeStringMap(input.env);
  if (input.headers !== undefined) next.headers = normalizeStringMap(input.headers);
  if (!next.transport) next.transport = next.command ? 'stdio' : 'streamableHttp';
  if (!next.timeoutMs) next.timeoutMs = DEFAULT_TIMEOUT_MS;
  if (!next.startupTimeoutMs) next.startupTimeoutMs = next.timeoutMs;
  if (!next.toolTimeoutMs) next.toolTimeoutMs = next.timeoutMs;
  if (!next.requireApproval) next.requireApproval = 'on-write';
  return next;
}

function validateStoredServer(key: string, server: StoredMcpServer): void {
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
    delete next.extraHeaders;
    delete next.extra_headers;
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
  if (value === 'streamableHttp' || value === 'streamable-http' || value === 'http') return 'streamableHttp';
  return command || !url ? 'stdio' : 'streamableHttp';
}

function normalizeRequireApproval(value: unknown): RuntimeMcpRequireApproval {
  if (value === 'never' || value === 'always' || value === 'on-write') return value;
  if (value === 'onWrite' || value === 'on_write') return 'on-write';
  return 'on-write';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
}

function normalizeStringMap(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => key.trim() && item.trim()).map(([key, item]) => [key.trim(), item.trim()]));
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).filter((key) => key.trim()).sort((a, b) => a.localeCompare(b));
}

function timeout(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), MAX_TIMEOUT_MS);
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
