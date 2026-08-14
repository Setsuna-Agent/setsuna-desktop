import type {
  RuntimeMcpServerInput,
  RuntimePluginMcpServerDescriptor,
} from '@setsuna-desktop/contracts';
import path from 'node:path';
import {
  normalizeMcpKey,
  objectRecord,
  optionalPositiveInteger,
  optionalString,
  removeUndefined,
  requiredString,
  stringArray,
} from './file-plugin-bundle-values.js';

export function normalizePluginMcpServers(value: unknown): RuntimeMcpServerInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Plugin mcpServers must be an array.');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const record = objectRecord(item, `Plugin mcpServers[${index}] must be an object.`);
    if (record.env !== undefined || record.headers !== undefined || record.envHttpHeaders !== undefined
      || record.env_http_headers !== undefined || record.bearerTokenEnvVar !== undefined || record.bearer_token_env_var !== undefined) {
      throw new Error(`Plugin mcpServers[${index}] cannot embed credentials or environment values.`);
    }
    const key = normalizeMcpKey(requiredString(record.key, `Plugin mcpServers[${index}].key`));
    if (seen.has(key)) throw new Error(`Duplicate plugin MCP key: ${key}`);
    seen.add(key);
    const transport = normalizeMcpTransport(record.transport, record.command, record.url);
    const server: RuntimeMcpServerInput = {
      key,
      label: optionalString(record.label),
      description: optionalString(record.description),
      transport,
      args: stringArray(record.args, `Plugin mcpServers[${index}].args`),
      timeoutMs: optionalPositiveInteger(record.timeoutMs ?? record.timeout_ms),
      startupTimeoutMs: optionalPositiveInteger(record.startupTimeoutMs ?? record.startup_timeout_ms),
      toolTimeoutMs: optionalPositiveInteger(record.toolTimeoutMs ?? record.tool_timeout_ms),
      allowedTools: stringArray(record.allowedTools ?? record.allowed_tools, `Plugin mcpServers[${index}].allowedTools`),
      disabledTools: stringArray(record.disabledTools ?? record.disabled_tools, `Plugin mcpServers[${index}].disabledTools`),
      oauthClientId: optionalString(record.oauthClientId ?? record.oauth_client_id),
      oauthResource: optionalString(record.oauthResource ?? record.oauth_resource),
      enabled: true,
    };
    if (transport === 'streamableHttp') {
      server.url = safeHttpUrl(requiredString(record.url, `Plugin mcpServers[${index}].url`));
    } else {
      server.command = requiredString(record.command, `Plugin mcpServers[${index}].command`);
      server.cwd = optionalString(record.cwd);
    }
    return removeUndefined(server);
  });
}

export function pluginMcpServerDescriptor(server: RuntimeMcpServerInput): RuntimePluginMcpServerDescriptor {
  return {
    key: server.key,
    label: server.label ?? server.key,
    ...(server.description ? { description: server.description } : {}),
    transport: normalizeMcpTransport(server.transport, server.command, server.url),
  };
}

export function materializePluginMcpServer(server: RuntimeMcpServerInput, installPath: string): RuntimeMcpServerInput {
  return removeUndefined({
    ...server,
    command: replacePluginRoot(server.command, installPath, false),
    cwd: replacePluginRoot(server.cwd, installPath, false),
    args: server.args?.map((arg) => replacePluginRoot(arg, installPath, false) ?? arg),
  });
}

export function compatibleMcpServer(left: RuntimeMcpServerInput, right: RuntimeMcpServerInput): boolean {
  const leftTransport = normalizeMcpTransport(left.transport, left.command, left.url);
  const rightTransport = normalizeMcpTransport(right.transport, right.command, right.url);
  if (leftTransport !== rightTransport) return false;
  if (leftTransport === 'streamableHttp') return comparableUrl(left.url) === comparableUrl(right.url);
  return left.command?.trim() === right.command?.trim()
    && arraysEqual(left.args ?? [], right.args ?? [])
    && normalizeOptionalPath(left.cwd) === normalizeOptionalPath(right.cwd);
}

export function pluginMcpServerUnmodified(current: RuntimeMcpServerInput, expected: RuntimeMcpServerInput): boolean {
  return JSON.stringify(comparablePluginMcpServer(current)) === JSON.stringify(comparablePluginMcpServer(expected));
}

export function comparablePluginMcpServer(server: RuntimeMcpServerInput): Record<string, unknown> {
  const transport = normalizeMcpTransport(server.transport, server.command, server.url);
  const timeoutMs = normalizedMcpTimeout(server.timeoutMs, 120_000);
  return {
    key: server.key,
    label: server.label?.trim() || server.key,
    description: server.description?.trim() || null,
    transport,
    command: transport === 'stdio' ? server.command?.trim() || null : null,
    args: transport === 'stdio' ? normalizedStringList(server.args) : [],
    cwd: transport === 'stdio' ? normalizeOptionalPath(server.cwd) || null : null,
    url: transport === 'streamableHttp' ? comparableUrl(server.url) || null : null,
    timeoutMs,
    startupTimeoutMs: normalizedMcpTimeout(server.startupTimeoutMs, timeoutMs),
    toolTimeoutMs: normalizedMcpTimeout(server.toolTimeoutMs, timeoutMs),
    enabled: server.enabled !== false,
    allowedTools: normalizedStringSet(server.allowedTools),
    disabledTools: normalizedStringSet(server.disabledTools),
    tools: canonicalValue(server.tools ?? []),
    env: canonicalStringMap(server.env),
    headers: canonicalStringMap(server.headers),
    envHttpHeaders: canonicalStringMap(server.envHttpHeaders),
    bearerTokenEnvVar: server.bearerTokenEnvVar?.trim() || null,
    oauthClientId: server.oauthClientId?.trim() || null,
    oauthResource: server.oauthResource?.trim() || null,
  };
}

export function normalizedMcpTimeout(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), 30 * 60 * 1_000);
}

export function normalizedStringList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

export function normalizedStringSet(values: string[] | undefined): string[] {
  return [...new Set(normalizedStringList(values))].sort((left, right) => left.localeCompare(right));
}

export function canonicalStringMap(value: Record<string, string> | undefined): Record<string, string> | null {
  if (!value) return null;
  const entries = Object.entries(value)
    .map(([key, item]) => [key.trim(), item.trim()] as const)
    .filter(([key, item]) => key && item)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? Object.fromEntries(entries) : null;
}

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

export function comparableUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/u, '');
  } catch {
    return value.trim().replace(/\/$/u, '');
  }
}

export function normalizeOptionalPath(value: string | undefined): string {
  return value ? path.normalize(value) : '';
}

export function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function normalizeMcpTransport(transport: unknown, command: unknown, url: unknown): 'stdio' | 'streamableHttp' {
  if (transport === 'stdio') return 'stdio';
  if (transport === 'streamableHttp' || transport === 'streamable_http' || transport === 'streamable-http' || transport === 'http') {
    return 'streamableHttp';
  }
  if (typeof command === 'string' && command.trim()) return 'stdio';
  if (typeof url === 'string' && url.trim()) return 'streamableHttp';
  throw new Error('Plugin MCP server requires transport stdio or streamable_http.');
}

export function safeHttpUrl(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Plugin MCP URL must use HTTPS or loopback HTTP.');
  }
  if (url.username || url.password) throw new Error('Plugin MCP URL cannot contain credentials.');
  return url.toString();
}

export function replacePluginRoot(value: string | undefined, installPath: string, shellQuote: boolean): string | undefined {
  if (!value) return undefined;
  return value.replace(/\{\{pluginRoot\}\}([^\s'"`]*)/gu, (_match, suffix: string) => {
    const pluginPath = pluginRootPath(installPath, suffix);
    return shellQuote ? shellQuotedPath(pluginPath) : pluginPath;
  });
}

export function pluginRootPath(installPath: string, suffix: string): string {
  if (!suffix) return installPath;
  if (!/^[\\/]/u.test(suffix)) return `${installPath}${suffix}`;
  const segments = suffix.replace(/^[\\/]+/u, '').split(/[\\/]+/u).filter(Boolean);
  return path.join(installPath, ...segments);
}

export function shellQuotedPath(value: string): string {
  return process.platform === 'win32'
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
}
