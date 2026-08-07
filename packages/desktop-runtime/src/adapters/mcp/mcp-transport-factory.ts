import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { RuntimeMcpServerInput } from '@setsuna-desktop/contracts';
import type { FetchImpl } from '../model/provider-http.js';
import type { McpOAuthCoordinator } from './mcp-oauth-coordinator.js';

const RESERVED_HTTP_HEADERS = new Set([
  'accept',
  'content-type',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
]);

export type ManagedMcpTransport = StdioClientTransport | StreamableHTTPClientTransport;
export type McpNetworkEnvironment = Record<string, string | null>;

export async function createMcpTransport(
  server: RuntimeMcpServerInput,
  oauth: McpOAuthCoordinator,
  fetchImpl: FetchImpl,
  resolveNetworkEnvironment: () => Promise<McpNetworkEnvironment>,
): Promise<ManagedMcpTransport> {
  if (normalizedMcpTransport(server) === 'stdio') {
    const command = server.command?.trim();
    if (!command) throw new Error(`stdio MCP server '${server.key}' requires a command.`);
    const networkEnvironment = await resolveNetworkEnvironment();
    return new StdioClientTransport({
      command,
      args: server.args ?? [],
      cwd: server.cwd?.trim() || undefined,
      env: stdioTransportEnvironment(command, server.env, networkEnvironment),
      stderr: 'pipe',
    });
  }

  const rawUrl = server.url?.trim();
  if (!rawUrl) throw new Error(`HTTP MCP server '${server.key}' requires a URL.`);
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`HTTP MCP server '${server.key}' must use http or https.`);
  }
  const headers = resolvedMcpHttpHeaders(server);
  const hasAuthorization = Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');
  return new StreamableHTTPClientTransport(url, {
    requestInit: { headers },
    fetch: hasAuthorization ? fetchImpl : oauth.fetchFor(server.key),
    ...(!hasAuthorization ? { authProvider: oauth.providerFor(server) } : {}),
    reconnectionOptions: {
      initialReconnectionDelay: 500,
      maxReconnectionDelay: 10_000,
      reconnectionDelayGrowFactor: 1.8,
      maxRetries: 5,
    },
  });
}

export function stdioTransportEnvironment(
  command: string,
  configuredEnvironment: Record<string, string> | undefined,
  networkEnvironment: McpNetworkEnvironment = {},
): Record<string, string> {
  const environment = { ...getDefaultEnvironment() };
  for (const [key, value] of Object.entries(networkEnvironment)) {
    if (value === null) delete environment[key];
    else environment[key] = value;
  }
  // Per-server MCP values are the most specific layer and intentionally win.
  Object.assign(environment, configuredEnvironment ?? {});
  const electronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  if (
    electronRunAsNode !== undefined
    && configuredEnvironment?.ELECTRON_RUN_AS_NODE === undefined
    && sameExecutable(command, process.execPath)
  ) {
    // Packaged stdio servers reuse Electron in Node mode instead of launching the desktop UI.
    environment.ELECTRON_RUN_AS_NODE = electronRunAsNode;
  }
  return environment;
}

export function resolvedMcpHttpHeaders(server: RuntimeMcpServerInput): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(server.headers ?? {})) {
    if (!RESERVED_HTTP_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }
  for (const [name, envVar] of Object.entries(server.envHttpHeaders ?? {})) {
    if (RESERVED_HTTP_HEADERS.has(name.toLowerCase())) continue;
    const value = process.env[envVar];
    if (value?.trim()) headers[name] = value;
  }
  const bearerTokenEnvVar = server.bearerTokenEnvVar?.trim();
  if (bearerTokenEnvVar) {
    const value = process.env[bearerTokenEnvVar];
    if (value === undefined) throw new Error(`Environment variable ${bearerTokenEnvVar} for MCP server '${server.key}' is not set`);
    if (!value.trim()) throw new Error(`Environment variable ${bearerTokenEnvVar} for MCP server '${server.key}' is empty`);
    headers.Authorization = `Bearer ${value}`;
  }
  return headers;
}

export function normalizedMcpTransport(server: RuntimeMcpServerInput): 'stdio' | 'streamableHttp' {
  if (server.transport === 'stdio' || server.transport === 'streamableHttp') return server.transport;
  return server.command ? 'stdio' : 'streamableHttp';
}

function sameExecutable(left: string, right: string): boolean {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
