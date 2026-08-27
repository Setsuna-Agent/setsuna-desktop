import type {
  RuntimeMcpAuthStatus,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
  RuntimeMcpServerSource,
  RuntimeMcpToolInfo,
  RuntimeMcpToolList,
  RuntimeMcpTransport,
} from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';

export type McpServerTarget = Readonly<{ serverKey: string }>;

export type McpServerUpdateInput = Readonly<{
  serverKey: string;
  patch: RuntimeMcpServerPatch;
}>;

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (isRecord(value) && !Object.keys(value).length) return undefined;
  throw new Error('MCP server list does not accept input.');
});

const serverInputCodec = defineRuntimeCodec<RuntimeMcpServerInput>((value) => (
  mcpServerInput(value)
));

const serverTargetCodec = defineRuntimeCodec<McpServerTarget>((value) => {
  const record = objectRecord(value, 'MCP server target must be an object.');
  return Object.freeze({
    serverKey: normalizeMcpServerKey(requiredText(record.serverKey, 'serverKey')),
  });
});

const serverUpdateCodec = defineRuntimeCodec<McpServerUpdateInput>((value) => {
  const record = objectRecord(value, 'MCP server update must be an object.');
  return Object.freeze({
    serverKey: normalizeMcpServerKey(requiredText(record.serverKey, 'serverKey')),
    patch: mcpServerPatch(record.patch),
  });
});

const serverListCodec = defineRuntimeCodec<RuntimeMcpServerList>((value) => {
  const record = objectRecord(value, 'MCP server list must be an object.');
  return {
    configPath: text(record.configPath, 'configPath'),
    workspaceConfigPaths: stringArray(record.workspaceConfigPaths, 'workspaceConfigPaths'),
    servers: arrayValue(record.servers, 'servers').map(mcpServer),
    errors: stringArray(record.errors, 'errors'),
  };
});

const toolListCodec = defineRuntimeCodec<RuntimeMcpToolList>((value) => {
  const record = objectRecord(value, 'MCP tool list must be an object.');
  return {
    tools: arrayValue(record.tools, 'tools').map(mcpTool),
    errors: stringArray(record.errors, 'errors'),
  };
});

const mcpOperationErrors = Object.freeze({
  MCP_OPERATION_FAILED: Object.freeze({ status: 500 }),
  MCP_SERVER_NOT_FOUND: Object.freeze({ status: 404 }),
});

export const readMcpServers = defineFeatureOperation({
  id: 'mcp.servers.read',
  method: 'GET',
  path: '/v1/features/mcp/servers',
  input: emptyInputCodec,
  output: serverListCodec,
  errors: mcpOperationErrors,
  idempotency: 'safe',
});

export const discoverMcpServerTools = defineFeatureOperation({
  id: 'mcp.tools.discover',
  method: 'POST',
  path: '/v1/features/mcp/tools/discover',
  input: serverInputCodec,
  output: toolListCodec,
  errors: mcpOperationErrors,
  idempotency: 'safe',
});

export const saveMcpServer = defineFeatureOperation({
  id: 'mcp.server.save',
  method: 'POST',
  path: '/v1/features/mcp/servers',
  input: serverInputCodec,
  output: serverListCodec,
  errors: mcpOperationErrors,
  idempotency: 'idempotent',
});

export const updateMcpServer = defineFeatureOperation({
  id: 'mcp.server.update',
  method: 'PATCH',
  path: '/v1/features/mcp/servers/:serverKey',
  input: serverUpdateCodec,
  output: serverListCodec,
  errors: mcpOperationErrors,
  idempotency: 'idempotent',
});

export const deleteMcpServer = defineFeatureOperation({
  id: 'mcp.server.delete',
  method: 'DELETE',
  path: '/v1/features/mcp/servers/:serverKey',
  input: serverTargetCodec,
  output: serverListCodec,
  errors: mcpOperationErrors,
  idempotency: 'idempotent',
});

export const loginMcpServer = defineFeatureOperation({
  id: 'mcp.server.login',
  method: 'POST',
  path: '/v1/features/mcp/servers/:serverKey/login',
  input: serverTargetCodec,
  output: serverListCodec,
  errors: mcpOperationErrors,
  idempotency: 'non-idempotent',
});

export const logoutMcpServer = defineFeatureOperation({
  id: 'mcp.server.logout',
  method: 'POST',
  path: '/v1/features/mcp/servers/:serverKey/logout',
  input: serverTargetCodec,
  output: serverListCodec,
  errors: mcpOperationErrors,
  idempotency: 'idempotent',
});

export function normalizeMcpServerKey(value: string): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  if (!key) throw new Error('MCP server key is required.');
  return key;
}

function mcpServerInput(value: unknown): RuntimeMcpServerInput {
  const record = objectRecord(value, 'MCP server input must be an object.');
  return {
    key: normalizeMcpServerKey(requiredText(record.key, 'key')),
    ...mcpServerMutableFields(record),
  };
}

function mcpServerPatch(value: unknown): RuntimeMcpServerPatch {
  return mcpServerMutableFields(objectRecord(value, 'MCP server patch must be an object.'));
}

function mcpServerMutableFields(record: Record<string, unknown>): RuntimeMcpServerPatch {
  const result: RuntimeMcpServerPatch = {};
  assignOptional(result, record, 'label', (value) => text(value, 'label'));
  assignOptional(result, record, 'description', (value) => text(value, 'description'));
  assignOptional(result, record, 'transport', mcpTransport);
  assignOptional(result, record, 'command', (value) => text(value, 'command'));
  assignOptional(result, record, 'args', (value) => stringArray(value, 'args'));
  assignOptional(result, record, 'cwd', (value) => text(value, 'cwd'));
  assignOptional(result, record, 'url', (value) => text(value, 'url'));
  assignOptional(result, record, 'timeoutMs', (value) => finiteNumber(value, 'timeoutMs'));
  assignOptional(result, record, 'startupTimeoutMs', (value) => finiteNumber(value, 'startupTimeoutMs'));
  assignOptional(result, record, 'toolTimeoutMs', (value) => finiteNumber(value, 'toolTimeoutMs'));
  assignOptional(result, record, 'enabled', (value) => booleanValue(value, 'enabled'));
  assignOptional(result, record, 'allowedTools', (value) => stringArray(value, 'allowedTools'));
  assignOptional(result, record, 'disabledTools', (value) => stringArray(value, 'disabledTools'));
  assignOptional(result, record, 'tools', (value) => arrayValue(value, 'tools').map(mcpTool));
  assignOptional(result, record, 'env', (value) => stringRecord(value, 'env'));
  assignOptional(result, record, 'headers', (value) => stringRecord(value, 'headers'));
  assignOptional(result, record, 'envHttpHeaders', (value) => stringRecord(value, 'envHttpHeaders'));
  assignOptional(result, record, 'bearerTokenEnvVar', (value) => text(value, 'bearerTokenEnvVar'));
  assignOptional(result, record, 'oauthClientId', (value) => text(value, 'oauthClientId'));
  assignOptional(result, record, 'oauthResource', (value) => text(value, 'oauthResource'));
  return result;
}

function mcpServer(value: unknown): RuntimeMcpServer {
  const record = objectRecord(value, 'MCP server must be an object.');
  return {
    key: requiredText(record.key, 'key'),
    label: text(record.label, 'label'),
    ...optionalTextProperty(record, 'description'),
    transport: mcpTransport(record.transport),
    ...optionalTextProperty(record, 'command'),
    args: stringArray(record.args, 'args'),
    ...optionalTextProperty(record, 'cwd'),
    ...optionalTextProperty(record, 'url'),
    timeoutMs: finiteNumber(record.timeoutMs, 'timeoutMs'),
    startupTimeoutMs: finiteNumber(record.startupTimeoutMs, 'startupTimeoutMs'),
    toolTimeoutMs: finiteNumber(record.toolTimeoutMs, 'toolTimeoutMs'),
    enabled: booleanValue(record.enabled, 'enabled'),
    allowedTools: stringArray(record.allowedTools, 'allowedTools'),
    disabledTools: stringArray(record.disabledTools, 'disabledTools'),
    ...optionalTextProperty(record, 'oauthClientId'),
    ...optionalTextProperty(record, 'oauthResource'),
    ...optionalAuthStatusProperty(record),
    ...optionalTextProperty(record, 'authError'),
    tools: arrayValue(record.tools, 'tools').map(mcpTool),
    envKeys: stringArray(record.envKeys, 'envKeys'),
    headerKeys: stringArray(record.headerKeys, 'headerKeys'),
    source: mcpServerSource(record.source),
    ...optionalTextProperty(record, 'sourcePath'),
    readOnly: booleanValue(record.readOnly, 'readOnly'),
  };
}

function mcpTool(value: unknown): RuntimeMcpToolInfo {
  const record = objectRecord(value, 'MCP tool must be an object.');
  return {
    name: requiredText(record.name, 'tool.name'),
    ...optionalTextProperty(record, 'title'),
    ...optionalTextProperty(record, 'description'),
    ...optionalRecordProperty(record, 'inputSchema'),
    ...optionalRecordProperty(record, 'outputSchema'),
    ...optionalRecordProperty(record, 'annotations'),
    ...optionalRecordProperty(record, 'execution'),
    ...optionalRecordProperty(record, '_meta'),
  };
}

function mcpTransport(value: unknown): RuntimeMcpTransport {
  if (value === 'stdio' || value === 'streamableHttp') return value;
  throw new Error('MCP transport is invalid.');
}

function mcpServerSource(value: unknown): RuntimeMcpServerSource {
  if (value === 'local' || value === 'workspace' || value === 'legacy' || value === 'builtin') {
    return value;
  }
  throw new Error('MCP server source is invalid.');
}

function mcpAuthStatus(value: unknown): RuntimeMcpAuthStatus {
  if (
    value === 'unsupported'
    || value === 'notLoggedIn'
    || value === 'bearerToken'
    || value === 'oAuth'
    || value === 'oAuthLoggingIn'
    || value === 'oAuthExpired'
    || value === 'oAuthError'
  ) return value;
  throw new Error('MCP auth status is invalid.');
}

function optionalAuthStatusProperty(
  record: Record<string, unknown>,
): Readonly<{ authStatus?: RuntimeMcpAuthStatus }> {
  if (record.authStatus === undefined) return {};
  return { authStatus: mcpAuthStatus(record.authStatus) };
}

function optionalTextProperty(
  record: Record<string, unknown>,
  key: string,
): Readonly<Record<string, string>> {
  if (record[key] === undefined) return {};
  return { [key]: text(record[key], key) };
}

function optionalRecordProperty(
  record: Record<string, unknown>,
  key: string,
): Readonly<Record<string, Record<string, unknown>>> {
  if (record[key] === undefined) return {};
  return { [key]: { ...objectRecord(record[key], key) } };
}

function assignOptional<TKey extends keyof RuntimeMcpServerPatch>(
  result: RuntimeMcpServerPatch,
  source: Record<string, unknown>,
  key: TKey,
  parse: (value: unknown) => NonNullable<RuntimeMcpServerPatch[TKey]>,
): void {
  if (source[key] !== undefined) result[key] = parse(source[key]) as RuntimeMcpServerPatch[TKey];
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return arrayValue(value, label).map((item) => text(item, `${label} item`));
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  const record = objectRecord(value, `${label} must be an object.`);
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    key,
    text(item, `${label}.${key}`),
  ]));
}

function requiredText(value: unknown, label: string): string {
  const result = text(value, label).trim();
  if (!result) throw new Error(`${label} must not be empty.`);
  return result;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}
