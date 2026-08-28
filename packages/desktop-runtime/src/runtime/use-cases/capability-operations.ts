import type {
  RuntimeHookListResponse,
  RuntimeMcpAuthStatus,
  RuntimeMcpResource,
  RuntimeMcpResourceReadResult,
  RuntimeMcpResourceTemplate,
  RuntimeMcpServer,
  RuntimeMcpServerStatus,
  RuntimeMcpServerStatusList,
  RuntimeMcpToolCallResult,
} from '@setsuna-desktop/contracts';
import path from 'node:path';
import type { McpServerRuntimeSnapshot } from '@setsuna-desktop/feature-mcp/contracts';
import type { RuntimeContainer } from '../runtime-factory.js';
import { RuntimeUseCaseError } from './errors.js';
import { requireRuntimeThread } from './thread-operations.js';

type RuntimeMcpStatusDetail = 'full' | 'toolsAndAuthOnly';

type RuntimeMcpStatusInventory = Partial<McpServerRuntimeSnapshot>;

export async function listRuntimeHooks(
  runtime: RuntimeContainer,
  rawCwds: unknown,
): Promise<RuntimeHookListResponse> {
  const cwds = runtimeHookCwds(rawCwds);
  return runtime.hookManagement.listLegacy(cwds);
}

export async function setRuntimeSkillExtraRoots(
  runtime: RuntimeContainer,
  value: unknown,
): Promise<void> {
  await runtime.skillRegistry.setExtraRoots(runtimeSkillExtraRoots(value));
}

export async function listRuntimeMcpServerStatuses(
  runtime: RuntimeContainer,
  rawDetail: unknown = 'full',
): Promise<RuntimeMcpServerStatusList> {
  const detail = runtimeMcpStatusDetail(rawDetail);
  const [list, inventory] = await Promise.all([
    runtime.mcpControl.listServers(),
    runtimeMcpStatusInventory(runtime, detail),
  ]);
  return {
    data: [...list.servers]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((server) => runtimeMcpServerStatus(server, inventory[server.key])),
    nextCursor: null,
  };
}

export async function readRuntimeMcpServerResource(
  runtime: RuntimeContainer,
  rawInput: unknown,
): Promise<RuntimeMcpResourceReadResult> {
  const input = runtimeInputRecord(rawInput);
  const threadId = optionalRuntimeString(input.threadId ?? input.thread_id);
  if (threadId) await requireRuntimeThread(runtime, threadId);
  const serverKey = requiredRuntimeString(input.server, 'server');
  const uri = requiredRuntimeString(input.uri, 'uri');
  await requireRuntimeMcpServer(runtime, serverKey);
  return runtime.mcpControl.readResource(serverKey, uri, {
    ...(threadId ? { threadId } : {}),
  });
}

export async function callRuntimeMcpServerTool(
  runtime: RuntimeContainer,
  rawInput: unknown,
): Promise<RuntimeMcpToolCallResult> {
  const input = runtimeInputRecord(rawInput);
  const threadId = requiredRuntimeString(input.threadId ?? input.thread_id, 'threadId');
  await requireRuntimeThread(runtime, threadId);
  const serverKey = requiredRuntimeString(input.server, 'server');
  const toolName = requiredRuntimeString(input.tool, 'tool');
  await requireRuntimeMcpServer(runtime, serverKey);
  return runtime.mcpControl.callTool(serverKey, toolName, input.arguments, {
    threadId,
  });
}

function runtimeHookCwds(value: unknown): string[] {
  if (value === undefined || value === null) return [process.cwd()];
  if (!Array.isArray(value)) {
    throw new RuntimeUseCaseError('invalid_input', 'cwds must be an array');
  }
  const cwds = value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new RuntimeUseCaseError('invalid_input', `cwds[${index}] must be a string`);
    }
    return item || process.cwd();
  });
  return cwds.length ? cwds : [process.cwd()];
}

function runtimeSkillExtraRoots(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new RuntimeUseCaseError('invalid_input', 'extraRoots must be an array');
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new RuntimeUseCaseError('invalid_input', `extraRoots[${index}] must be a string`);
    }
    if (!path.isAbsolute(item)) {
      throw new RuntimeUseCaseError('invalid_input', `extraRoots[${index}] must be an absolute path`);
    }
    return path.resolve(item);
  });
}

function runtimeMcpStatusDetail(value: unknown): RuntimeMcpStatusDetail {
  if (value === undefined || value === null || value === 'full') return 'full';
  if (value === 'toolsAndAuthOnly') return value;
  throw new RuntimeUseCaseError(
    'invalid_input',
    `Invalid MCP server status detail: ${String(value)}`,
  );
}

async function runtimeMcpStatusInventory(
  runtime: RuntimeContainer,
  detail: RuntimeMcpStatusDetail,
): Promise<Record<string, RuntimeMcpStatusInventory>> {
  // Lightweight polling must not open remote connections or trigger OAuth.
  if (detail === 'toolsAndAuthOnly') return {};
  const servers = (await runtime.mcpStore.listServerInputs())
    .filter((server) => server.enabled !== false);
  const entries = await Promise.all(servers.map(async (server) => {
    const snapshot = await runtime.mcpControl.snapshot(server.key, {}, {
      includeTools: true,
      includeResources: true,
    });
    return [server.key, snapshot] as const;
  }));
  return Object.fromEntries(entries);
}

function runtimeMcpServerStatus(
  server: RuntimeMcpServer,
  inventory?: RuntimeMcpStatusInventory,
): RuntimeMcpServerStatus {
  const tools = inventory?.tools ?? server.tools;
  const resources: RuntimeMcpResource[] = inventory?.resources ?? [];
  const resourceTemplates: RuntimeMcpResourceTemplate[] = inventory?.resourceTemplates ?? [];
  return {
    name: server.key,
    serverInfo: inventory?.serverInfo ?? null,
    tools: Object.fromEntries(tools.map((tool) => [tool.name, {
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema ?? {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    }])),
    resources,
    resourceTemplates,
    authStatus: inventory?.authStatus ?? runtimeMcpAuthStatus(server),
    ...(inventory?.authError ? { authError: inventory.authError } : {}),
    ...(inventory?.state ? { connectionState: inventory.state } : {}),
    ...(inventory?.protocolVersion ? { protocolVersion: inventory.protocolVersion } : {}),
    ...(inventory?.connectedAt ? { connectedAt: inventory.connectedAt } : {}),
    ...(inventory?.updatedAt ? { updatedAt: inventory.updatedAt } : {}),
    ...(inventory?.error ? { error: inventory.error } : {}),
  };
}

function runtimeMcpAuthStatus(server: RuntimeMcpServer): RuntimeMcpAuthStatus {
  if (server.headerKeys.some((key) => key.toLowerCase() === 'authorization')) {
    return 'bearerToken';
  }
  if (server.oauthClientId || server.oauthResource) return 'notLoggedIn';
  return 'unsupported';
}

async function requireRuntimeMcpServer(
  runtime: RuntimeContainer,
  serverKey: string,
) {
  const server = (await runtime.mcpStore.listServerInputs())
    .find((item) => item.key === serverKey);
  if (!server) {
    throw new RuntimeUseCaseError(
      'mcp_server_not_found',
      `MCP server not found: ${serverKey}`,
      { serverKey },
    );
  }
  return server;
}

function runtimeInputRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function requiredRuntimeString(value: unknown, name: string): string {
  const text = optionalRuntimeString(value);
  if (text) return text;
  throw new RuntimeUseCaseError('invalid_input', `Missing required parameter: ${name}`);
}

function optionalRuntimeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
