/** Desktop MCP server configuration updates and previews. */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isNodeErrorCode } from '../../../shared/node-errors.js';
import {
  DEFAULT_MCP_TIMEOUT_MS,
  MAX_MCP_TIMEOUT_MS,
  MCP_CONFIG_PATH,
  MCP_SERVERS_KEY,
} from './pc-local-tool-constants.js';
import {
  boundedInteger,
  errorResult,
  okResult,
} from './pc-local-tool-utils.js';

type McpToolState = {
  mcpConfigPath?: string;
};

type McpTransport = 'stdio' | 'streamableHttp';
type JsonRecord = Record<string, unknown>;

type McpServerPreview = {
  key: string;
  label: string;
  description: string;
  transport: McpTransport;
  command: string;
  args: string[];
  cwd: string;
  url: string;
  timeoutMs: number;
  enabled: boolean;
  allowedTools: string[];
  disabledTools: string[];
  oauthClientId: string;
  oauthResource: string;
  envKeys: string[];
  headerKeys: string[];
  configPath: string;
};

type McpServerConfigResult =
  | {
      ok: true;
      configPath: string;
      config: JsonRecord;
      key: string;
      server: JsonRecord;
      preview: McpServerPreview;
    }
  | { ok: false; error: string };

export function isLocalMcpConfigPath(): boolean {
  return false;
}

export async function configureMcpServer(args: JsonRecord, state: McpToolState) {
  const result = await calculateMcpServerConfig(args, state);
  if (!result.ok) return errorResult(result.error);

  await mkdir(path.dirname(result.configPath), { recursive: true });
  await writeFile(result.configPath, JSON.stringify(result.config, null, 2), 'utf8');

  return okResult(
    [
      `MCP server configured: ${result.key}`,
      `Config: ${result.configPath}`,
      `Transport: ${result.preview.transport}`,
      result.preview.transport === 'stdio'
        ? `Command: ${[result.preview.command, ...result.preview.args].filter(Boolean).join(' ')}`
        : `URL: ${result.preview.url}`,
      'The server will be available after the MCP runtime reloads, typically on the next turn.',
    ].filter(Boolean).join('\n'),
    `configured MCP ${result.key}`,
    { mcpServer: result.preview },
  );
}

export async function calculateMcpServerConfig(
  args: JsonRecord,
  state: McpToolState,
): Promise<McpServerConfigResult> {
  const configPath = path.resolve(String(state?.mcpConfigPath || MCP_CONFIG_PATH));
  const configValue = await readMcpConfigForWrite(configPath);
  if (!isRecord(configValue)) {
    return { ok: false, error: 'MCP 配置根节点必须是 JSON 对象。' };
  }
  const config = configValue;

  const key = normalizeMcpKey(args?.key);
  if (!key) return { ok: false, error: 'MCP 服务 key 不能为空。' };

  const serversValue = config[MCP_SERVERS_KEY] ?? config.servers;
  const servers: JsonRecord = isRecord(serversValue)
    ? { ...serversValue }
    : {};
  const existing: JsonRecord = isRecord(servers[key])
    ? { ...servers[key] }
    : {};
  const server = { ...existing };

  upsertMcpString(server, 'label', args?.label);
  upsertMcpString(server, 'description', args?.description);
  upsertMcpString(server, 'command', args?.command);
  upsertMcpString(server, 'cwd', args?.cwd);
  upsertMcpString(server, 'url', args?.url);
  upsertMcpStringList(server, 'args', args?.args);
  upsertMcpStringList(server, 'allowedTools', args?.allowed_tools ?? args?.allowedTools);
  upsertMcpStringList(server, 'disabledTools', args?.disabled_tools ?? args?.disabledTools);
  upsertMcpStringMap(server, 'env', args?.env);
  upsertMcpStringMap(server, 'headers', args?.headers);
  upsertMcpStringList(server, 'envVars', args?.env_vars ?? args?.envVars);
  upsertMcpStringMap(server, 'envHttpHeaders', args?.env_http_headers ?? args?.envHttpHeaders);
  upsertMcpString(server, 'bearerTokenEnvVar', args?.bearer_token_env_var ?? args?.bearerTokenEnvVar);
  upsertMcpOAuthClientId(server, args?.oauth_client_id ?? args?.oauthClientId);
  upsertMcpString(server, 'oauth_resource', args?.oauth_resource ?? args?.oauthResource);

  if (Object.hasOwn(args || {}, 'enabled')) server.enabled = Boolean(args.enabled);
  if (Object.hasOwn(args || {}, 'timeout_ms') || Object.hasOwn(args || {}, 'timeoutMs')) {
    server.timeoutMs = boundedInteger(args?.timeout_ms ?? args?.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 1000, MAX_MCP_TIMEOUT_MS);
  }
  const transport = normalizeMcpTransport(args?.transport, server);
  if (!transport) return { ok: false, error: `MCP server ${key} 缺少 command 或 url。` };
  server.transport = transport;

  const validationError = validateMcpServerObject(key, server);
  if (validationError) return { ok: false, error: validationError };
  pruneMcpTransportFields(server);

  servers[key] = server;
  delete config.servers;
  config[MCP_SERVERS_KEY] = servers;

  return {
    ok: true,
    configPath,
    config,
    key,
    server,
    preview: mcpServerPreview(key, server, configPath),
  };
}

async function readMcpConfigForWrite(configPath: string): Promise<unknown> {
  try {
    const content = await readFile(configPath, 'utf8');
    return JSON.parse(content) as unknown;
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return {};
    if (error instanceof SyntaxError) {
      throw new Error(`MCP 配置 JSON 解析失败：${error.message}`);
    }
    throw error;
  }
}

function normalizeMcpKey(value: unknown): string {
  return String(value || '').trim().split(/\s+/).filter(Boolean).join('_');
}

function upsertMcpString(object: JsonRecord, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (text) object[key] = text;
  else delete object[key];
}

function upsertMcpStringList(object: JsonRecord, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  const list = normalizeMcpStringList(value);
  if (list.length) object[key] = list;
  else delete object[key];
}

function upsertMcpStringMap(object: JsonRecord, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    delete object[key];
    return;
  }
  const map = Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([name, item]) => [String(name), String(item)]),
  );
  if (Object.keys(map).length) object[key] = map;
  else delete object[key];
}

function upsertMcpOAuthClientId(server: JsonRecord, value: unknown): void {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  const oauth: JsonRecord = isRecord(server.oauth)
    ? { ...server.oauth }
    : {};
  delete oauth.clientId;
  if (text) oauth.client_id = text;
  else delete oauth.client_id;
  if (Object.keys(oauth).length) server.oauth = oauth;
  else delete server.oauth;
  delete server.oauthClientId;
  delete server.oauth_client_id;
}

function normalizeMcpStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeMcpTransport(value: unknown, server: Readonly<JsonRecord>): McpTransport | '' {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    if (String(server.command || '').trim()) return 'stdio';
    if (String(server.url || '').trim()) return 'streamableHttp';
    return '';
  }
  if (raw === 'stdio') return 'stdio';
  if (raw === 'http' || raw === 'streamablehttp' || raw === 'streamable-http' || raw === 'streamable_http' || raw === 'sse') {
    return 'streamableHttp';
  }
  return '';
}

function validateMcpServerObject(key: string, server: Readonly<JsonRecord>): string {
  const transport = String(server.transport || '');
  if (transport === 'stdio' && !String(server.command || '').trim()) {
    return `MCP server ${key} 的 stdio 配置缺少 command。`;
  }
  if (transport === 'streamableHttp' && !String(server.url || '').trim()) {
    return `MCP server ${key} 的 HTTP 配置缺少 url。`;
  }
  if (transport !== 'stdio' && transport !== 'streamableHttp') {
    return 'MCP transport 只能是 stdio 或 streamableHttp。';
  }
  return '';
}

function pruneMcpTransportFields(server: JsonRecord): void {
  if (server.transport === 'stdio') {
    delete server.url;
    delete server.headers;
    delete server.envHttpHeaders;
    delete server.bearerTokenEnvVar;
    delete server.oauth;
    delete server.oauth_resource;
    delete server.oauthResource;
    delete server.oauthClientId;
    delete server.oauth_client_id;
    return;
  }
  delete server.command;
  delete server.args;
  delete server.cwd;
  delete server.env;
  delete server.envVars;
}

function mcpServerPreview(
  key: string,
  server: Readonly<JsonRecord>,
  configPath: string,
): McpServerPreview {
  const oauth = isRecord(server.oauth) ? server.oauth : {};
  return {
    key,
    label: String(server.label || key),
    description: String(server.description || ''),
    transport: server.transport === 'stdio' ? 'stdio' : 'streamableHttp',
    command: String(server.command || ''),
    args: normalizeMcpStringList(server.args),
    cwd: String(server.cwd || ''),
    url: String(server.url || ''),
    timeoutMs: boundedInteger(server.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 1000, MAX_MCP_TIMEOUT_MS),
    enabled: server.enabled !== false,
    allowedTools: normalizeMcpStringList(server.allowedTools),
    disabledTools: normalizeMcpStringList(server.disabledTools),
    oauthClientId: String(oauth.client_id || server.oauthClientId || server.oauth_client_id || ''),
    oauthResource: String(server.oauth_resource || server.oauthResource || ''),
    envKeys: [...new Set([...objectKeys(server.env), ...normalizeMcpStringList(server.envVars)])],
    headerKeys: mcpHeaderKeys(server),
    configPath,
  };
}

function mcpHeaderKeys(server: Readonly<JsonRecord>): string[] {
  const keys = [
    ...objectKeys(server.headers),
    ...objectKeys(server.envHttpHeaders),
  ];
  if (String(server.bearerTokenEnvVar || '').trim()) keys.push('Authorization');
  return [...new Set(keys)];
}

function objectKeys(value: unknown): string[] {
  return value === null || value === undefined ? [] : Object.keys(Object(value));
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
