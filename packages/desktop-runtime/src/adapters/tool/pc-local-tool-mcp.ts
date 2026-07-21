// @ts-nocheck

/** Desktop MCP server configuration updates and previews. */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MCP_CONFIG_PATH,
  MCP_SERVERS_KEY,
  DEFAULT_MCP_TIMEOUT_MS,
  MAX_MCP_TIMEOUT_MS,
} from './pc-local-tool-constants.js';
import {
  boundedInteger,
  okResult,
  errorResult,
} from './pc-local-tool-utils.js';

export function isLocalMcpConfigPath() {
  return false;
}

export async function configureMcpServer(args, state) {
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

export async function calculateMcpServerConfig(args, state) {
  const configPath = path.resolve(String(state?.mcpConfigPath || MCP_CONFIG_PATH));
  const config = await readMcpConfigForWrite(configPath);
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, error: 'MCP 配置根节点必须是 JSON 对象。' };
  }

  const key = normalizeMcpKey(args?.key);
  if (!key) return { ok: false, error: 'MCP 服务 key 不能为空。' };

  const serversValue = config[MCP_SERVERS_KEY] ?? config.servers;
  const servers = serversValue && typeof serversValue === 'object' && !Array.isArray(serversValue)
    ? { ...serversValue }
    : {};
  const existing = servers[key] && typeof servers[key] === 'object' && !Array.isArray(servers[key])
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
  if (Object.hasOwn(args || {}, 'require_approval') || Object.hasOwn(args || {}, 'requireApproval')) {
    server.requireApproval = normalizeMcpRequireApproval(args?.require_approval ?? args?.requireApproval);
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

async function readMcpConfigForWrite(configPath) {
  try {
    const content = await readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) {
      throw new Error(`MCP 配置 JSON 解析失败：${error.message}`);
    }
    throw error;
  }
}

function normalizeMcpKey(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).join('_');
}

function upsertMcpString(object, key, value) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (text) object[key] = text;
  else delete object[key];
}

function upsertMcpStringList(object, key, value) {
  if (value === undefined || value === null) return;
  const list = normalizeMcpStringList(value);
  if (list.length) object[key] = list;
  else delete object[key];
}

function upsertMcpStringMap(object, key, value) {
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

function upsertMcpOAuthClientId(server, value) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  const oauth = server.oauth && typeof server.oauth === 'object' && !Array.isArray(server.oauth)
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

function normalizeMcpStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeMcpTransport(value, server) {
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

function normalizeMcpRequireApproval(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'never' || raw === 'approve' || raw === 'approved' || raw === 'false') return 'approve';
  if (raw === 'always' || raw === 'prompt' || raw === 'true') return 'prompt';
  return 'auto';
}

function validateMcpServerObject(key, server) {
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

function pruneMcpTransportFields(server) {
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

function mcpServerPreview(key, server, configPath) {
  return {
    key,
    label: String(server.label || key),
    description: String(server.description || ''),
    transport: String(server.transport || ''),
    command: String(server.command || ''),
    args: normalizeMcpStringList(server.args),
    cwd: String(server.cwd || ''),
    url: String(server.url || ''),
    timeoutMs: boundedInteger(server.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, 1000, MAX_MCP_TIMEOUT_MS),
    requireApproval: normalizeMcpRequireApproval(server.requireApproval),
    enabled: server.enabled !== false,
    allowedTools: normalizeMcpStringList(server.allowedTools),
    disabledTools: normalizeMcpStringList(server.disabledTools),
    oauthClientId: String(server.oauth?.client_id || server.oauthClientId || server.oauth_client_id || ''),
    oauthResource: String(server.oauth_resource || server.oauthResource || ''),
    envKeys: [...new Set([...Object.keys(server.env || {}), ...normalizeMcpStringList(server.envVars)])],
    headerKeys: mcpHeaderKeys(server),
    configPath,
  };
}

function mcpHeaderKeys(server) {
  const keys = [
    ...Object.keys(server.headers || {}),
    ...Object.keys(server.envHttpHeaders || {}),
  ];
  if (String(server.bearerTokenEnvVar || '').trim()) keys.push('Authorization');
  return [...new Set(keys)];
}
