import type {
  RuntimeMcpRequireApproval,
  RuntimeMcpServer,
  RuntimeMcpServerInput,
  RuntimeMcpTransport,
  RuntimeMcpTrustLevel,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { McpClientRuntime } from '../../ports/mcp-client-runtime.js';
import type { McpStore } from '../../ports/mcp-store.js';
import type { ToolExecutionContext, ToolExecutionPreview, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';

const configureMcpToolName = 'configure_mcp_server';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

const configureMcpTool: RuntimeToolDefinition = {
  name: configureMcpToolName,
  description: 'Create or update a Setsuna Desktop MCP server in the current runtime MCP configuration. Requires user authorization.',
  inputSchema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Stable server key. Spaces are normalized to underscores.',
      },
      label: {
        type: 'string',
        description: 'Optional display name for the MCP server.',
      },
      description: {
        type: 'string',
        description: 'Optional description of the server.',
      },
      transport: {
        type: 'string',
        enum: ['stdio', 'streamableHttp'],
        description: 'Transport type. Use stdio for command-based servers and streamableHttp for URL-based servers.',
      },
      command: {
        type: 'string',
        description: 'Command for stdio servers, such as npx, node, uvx, or an absolute executable path.',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command arguments for stdio servers.',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory for stdio servers.',
      },
      url: {
        type: 'string',
        description: 'URL for streamable HTTP MCP servers.',
      },
      headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional HTTP headers for streamable HTTP servers.',
      },
      env_http_headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional HTTP header names mapped to environment variable names for streamable HTTP servers.',
      },
      envHttpHeaders: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional HTTP header names mapped to environment variable names for streamable HTTP servers.',
      },
      bearer_token_env_var: {
        type: 'string',
        description: 'Optional environment variable that contains the bearer token for streamable HTTP servers.',
      },
      bearerTokenEnvVar: {
        type: 'string',
        description: 'Optional environment variable that contains the bearer token for streamable HTTP servers.',
      },
      oauth_client_id: {
        type: 'string',
        description: 'Optional OAuth client ID for streamable HTTP MCP login.',
      },
      oauthClientId: {
        type: 'string',
        description: 'Optional OAuth client ID for streamable HTTP MCP login.',
      },
      oauth_resource: {
        type: 'string',
        description: 'Optional OAuth resource parameter for streamable HTTP MCP login.',
      },
      oauthResource: {
        type: 'string',
        description: 'Optional OAuth resource parameter for streamable HTTP MCP login.',
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional environment variables for stdio servers.',
      },
      timeout_ms: {
        type: 'integer',
        description: 'Optional request timeout in milliseconds.',
        minimum: 1000,
        maximum: MAX_TIMEOUT_MS,
      },
      timeoutMs: {
        type: 'integer',
        description: 'Optional request timeout in milliseconds.',
        minimum: 1000,
        maximum: MAX_TIMEOUT_MS,
      },
      startup_timeout_ms: {
        type: 'integer',
        description: 'Optional stdio startup timeout in milliseconds.',
        minimum: 1000,
        maximum: MAX_TIMEOUT_MS,
      },
      startupTimeoutMs: {
        type: 'integer',
        description: 'Optional stdio startup timeout in milliseconds.',
        minimum: 1000,
        maximum: MAX_TIMEOUT_MS,
      },
      tool_timeout_ms: {
        type: 'integer',
        description: 'Optional per-tool timeout in milliseconds.',
        minimum: 1000,
        maximum: MAX_TIMEOUT_MS,
      },
      toolTimeoutMs: {
        type: 'integer',
        description: 'Optional per-tool timeout in milliseconds.',
        minimum: 1000,
        maximum: MAX_TIMEOUT_MS,
      },
      require_approval: {
        type: 'string',
        enum: ['auto', 'prompt', 'approve', 'always', 'never'],
        description: 'MCP approval mode. Use auto by default, prompt to ask every time, or approve to run without asking.',
      },
      requireApproval: {
        type: 'string',
        enum: ['auto', 'prompt', 'approve', 'always', 'never'],
        description: 'MCP approval mode. Use auto by default, prompt to ask every time, or approve to run without asking.',
      },
      trust_level: {
        type: 'string',
        enum: ['untrusted', 'trusted'],
        description: 'Server trust level. Defaults to untrusted. Trusted servers may use read-only annotations to skip per-call approval.',
      },
      trustLevel: {
        type: 'string',
        enum: ['untrusted', 'trusted'],
        description: 'Server trust level. Defaults to untrusted. Only set trusted after the user has explicitly authorized it.',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether the server is enabled. Defaults to true.',
      },
      required: {
        type: 'boolean',
        description: 'Whether this server is required.',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional allow-list of tool names exposed from this server.',
      },
      allowedTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional allow-list of tool names exposed from this server.',
      },
      disabled_tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional block-list of tool names hidden from this server.',
      },
      disabledTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional block-list of tool names hidden from this server.',
      },
    },
    required: ['key'],
  },
};

export class McpManagementToolHost implements ToolHost {
  constructor(
    private readonly mcpStore: McpStore,
    private readonly mcpClient: McpClientRuntime,
  ) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return [configureMcpTool];
  }

  toolRuntimeProfile() {
    return { exposure: 'deferred' as const };
  }

  systemPrompt(): string {
    return [
      'When the user asks to create, update, enable, disable, or configure a Setsuna Desktop MCP server from chat, use configure_mcp_server.',
      'This tool writes the current desktop runtime MCP configuration used by the Capabilities page.',
      'Do not write MCP JSON files directly.',
    ].join('\n');
  }

  async approvalForTool(name: string, input: unknown, _context?: ToolExecutionContext): Promise<{ reason: string; argumentsPreview?: string } | null> {
    if (name !== configureMcpToolName) return null;
    const preview = await this.mcpPreview(input);
    return {
      reason: `${preview.action === 'update' ? '更新' : '创建'} MCP 服务：${preview.label || preview.key}`,
      argumentsPreview: JSON.stringify(preview).slice(0, 1200),
    };
  }

  async previewToolCall(name: string, input: unknown, _context?: ToolExecutionContext): Promise<ToolExecutionPreview | null> {
    if (name !== configureMcpToolName) return null;
    return {
      resultPreview: JSON.stringify(await this.mcpPreview(input)),
    };
  }

  async runTool(name: string, input: unknown, _context?: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (name !== configureMcpToolName) throw new Error(`Unknown tool: ${name}`);

    const normalized = normalizeMcpInput(input);
    const before = await this.mcpStore.listServers();
    const existing = before.servers.find((server) => server.key === normalized.key);
    const existingInput = (await this.mcpStore.listServerInputs()).find((server) => server.key === normalized.key);
    const discovery = await discoverToolsForSave(mergeMcpServerInput(existingInput, normalized), this.mcpClient);
    const inputToSave = discovery.tools.length ? { ...normalized, tools: discovery.tools } : normalized;
    const savedList = await this.mcpStore.upsertServer(inputToSave);
    const saved = savedList.servers.find((server) => server.key === normalized.key);
    if (!saved) throw new Error(`MCP server was not saved: ${normalized.key}`);
    await this.mcpClient.invalidateServer(saved.key);
    const enabledToolCount = mcpEnabledToolCount(saved);

    return {
      content: [
        `MCP server configured: ${saved.label}`,
        `Key: ${saved.key}`,
        `Config: ${savedList.configPath}`,
        `Transport: ${saved.transport}`,
        `Trust: ${saved.trustLevel}`,
        saved.transport === 'stdio'
          ? `Command: ${[saved.command, ...saved.args].filter(Boolean).join(' ')}`
          : `URL: ${saved.url}`,
        saved.envKeys.length ? `Env keys: ${saved.envKeys.join(', ')}` : '',
        saved.headerKeys.length ? `Header keys: ${saved.headerKeys.join(', ')}` : '',
        saved.tools.length ? `Tools enabled: ${enabledToolCount}/${saved.tools.length}` : 'Tools enabled: not fetched',
        discovery.errors.length ? `Tool discovery errors: ${discovery.errors.join('; ')}` : '',
        'The server is saved in the current desktop runtime MCP configuration.',
      ].filter(Boolean).join('\n'),
      preview: JSON.stringify(mcpResultPreview(existing ? 'update' : 'create', saved, savedList.configPath)),
      data: saved,
    };
  }

  private async mcpPreview(input: unknown): Promise<ReturnType<typeof mcpPreviewPayload>> {
    const normalized = normalizeMcpInput(input);
    const list = await this.mcpStore.listServers();
    const existing = list.servers.find((server) => server.key === normalized.key);
    return mcpPreviewPayload(existing ? 'update' : 'create', normalized, list.configPath, existing);
  }
}

async function discoverToolsForSave(input: RuntimeMcpServerInput, mcpClient: McpClientRuntime) {
  if (input.tools?.length) return { tools: input.tools, errors: [] };
  return mcpClient.discoverTools(input);
}

function mcpEnabledToolCount(server: RuntimeMcpServer): number {
  const allowedTools = new Set(server.allowedTools);
  const disabledTools = new Set(server.disabledTools);
  return server.tools.filter((tool) => (!allowedTools.size || allowedTools.has(tool.name)) && !disabledTools.has(tool.name)).length;
}

function normalizeMcpInput(input: unknown): RuntimeMcpServerInput {
  const record = recordInput(input);
  const key = normalizeMcpKey(stringValue(record.key));
  if (!key) throw new Error('MCP server key is required.');

  const normalized: RuntimeMcpServerInput = {
    key,
    label: optionalString(record.label),
    description: optionalString(record.description),
    transport: normalizeTransport(record.transport),
    command: optionalString(record.command),
    args: stringList(record.args),
    cwd: optionalString(record.cwd),
    url: optionalString(record.url),
    timeoutMs: timeout(record.timeoutMs ?? record.timeout_ms),
    startupTimeoutMs: timeout(record.startupTimeoutMs ?? record.startup_timeout_ms),
    toolTimeoutMs: timeout(record.toolTimeoutMs ?? record.tool_timeout_ms),
    required: booleanValue(record.required),
    requireApproval: normalizeRequireApproval(record.requireApproval ?? record.require_approval),
    trustLevel: normalizeTrustLevel(record.trustLevel ?? record.trust_level),
    enabled: booleanValue(record.enabled),
    allowedTools: stringList(record.allowedTools ?? record.allowed_tools),
    disabledTools: stringList(record.disabledTools ?? record.disabled_tools),
    env: stringMap(record.env),
    headers: stringMap(record.headers),
    envHttpHeaders: stringMap(record.envHttpHeaders ?? record.env_http_headers),
    bearerTokenEnvVar: optionalString(record.bearerTokenEnvVar ?? record.bearer_token_env_var),
    oauthClientId: optionalString(record.oauthClientId ?? record.oauth_client_id),
    oauthResource: optionalString(record.oauthResource ?? record.oauth_resource),
  };

  return omitUndefined(normalized);
}

function mcpPreviewPayload(
  action: 'create' | 'update',
  input: RuntimeMcpServerInput,
  configPath: string,
  existing?: RuntimeMcpServer,
) {
  return {
    action,
    key: input.key,
    label: input.label ?? existing?.label ?? input.key,
    description: input.description ?? existing?.description,
    transport: input.transport ?? existing?.transport ?? inferTransport(input),
    command: input.command ?? existing?.command,
    args: input.args ?? existing?.args ?? [],
    url: input.url ?? existing?.url,
    timeoutMs: input.timeoutMs ?? existing?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    requireApproval: input.requireApproval ?? existing?.requireApproval ?? 'auto',
    trustLevel: input.trustLevel ?? existing?.trustLevel ?? 'untrusted',
    enabled: input.enabled ?? existing?.enabled ?? true,
    required: input.required ?? existing?.required ?? false,
    allowedTools: input.allowedTools ?? existing?.allowedTools ?? [],
    disabledTools: input.disabledTools ?? existing?.disabledTools ?? [],
    oauthClientId: input.oauthClientId ?? existing?.oauthClientId,
    oauthResource: input.oauthResource ?? existing?.oauthResource,
    envKeys: input.env || input.envHttpHeaders || input.bearerTokenEnvVar
      ? mcpEnvKeys(input)
      : existing?.envKeys ?? [],
    headerKeys: input.headers || input.envHttpHeaders || input.bearerTokenEnvVar
      ? mcpHeaderKeys(input)
      : existing?.headerKeys ?? [],
    configPath,
  };
}

function mcpResultPreview(action: 'create' | 'update', server: RuntimeMcpServer, configPath: string) {
  return {
    action,
    key: server.key,
    label: server.label,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    timeoutMs: server.timeoutMs,
    requireApproval: server.requireApproval,
    trustLevel: server.trustLevel,
    enabled: server.enabled,
    required: server.required,
    allowedTools: server.allowedTools,
    disabledTools: server.disabledTools,
    oauthClientId: server.oauthClientId,
    oauthResource: server.oauthResource,
    envKeys: server.envKeys,
    headerKeys: server.headerKeys,
    configPath,
  };
}

function inferTransport(input: RuntimeMcpServerInput): RuntimeMcpTransport {
  return input.command || !input.url ? 'stdio' : 'streamableHttp';
}

function mergeMcpServerInput(
  existing: RuntimeMcpServerInput | undefined,
  input: RuntimeMcpServerInput,
): RuntimeMcpServerInput {
  if (!existing) return input;
  return {
    ...existing,
    ...input,
    ...(input.env === undefined ? { env: existing.env } : {}),
    ...(input.headers === undefined ? { headers: existing.headers } : {}),
    ...(input.envHttpHeaders === undefined ? { envHttpHeaders: existing.envHttpHeaders } : {}),
    ...(input.bearerTokenEnvVar === undefined ? { bearerTokenEnvVar: existing.bearerTokenEnvVar } : {}),
  };
}

function mcpHeaderKeys(input: RuntimeMcpServerInput): string[] {
  const keys = [
    ...Object.keys(input.headers ?? {}),
    ...Object.keys(input.envHttpHeaders ?? {}),
  ];
  if (input.bearerTokenEnvVar?.trim()) keys.push('Authorization');
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b));
}

function mcpEnvKeys(input: RuntimeMcpServerInput): string[] {
  const keys = [
    ...Object.keys(input.env ?? {}),
    ...Object.values(input.envHttpHeaders ?? {}),
  ];
  if (input.bearerTokenEnvVar?.trim()) keys.push(input.bearerTokenEnvVar.trim());
  return [...new Set(keys.filter((value) => value.trim()).map((value) => value.trim()))].sort((a, b) => a.localeCompare(b));
}

function normalizeMcpKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeTransport(value: unknown): RuntimeMcpTransport | undefined {
  if (value === 'stdio' || value === 'streamableHttp') return value;
  if (value === 'streamable-http' || value === 'http') return 'streamableHttp';
  return undefined;
}

function normalizeRequireApproval(value: unknown): RuntimeMcpRequireApproval | undefined {
  if (value === 'approve' || value === 'never') return 'approve';
  if (value === 'prompt' || value === 'always') return 'prompt';
  if (value === 'smart' || value === 'auto' || value === 'on-write' || value === 'onWrite' || value === 'on_write') return 'auto';
  return undefined;
}

function normalizeTrustLevel(value: unknown): RuntimeMcpTrustLevel | undefined {
  if (value === 'trusted' || value === 'untrusted') return value;
  return undefined;
}

function timeout(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.min(Math.max(Math.floor(numeric), 1000), MAX_TIMEOUT_MS);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  return list.length ? list : undefined;
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => entry[0].trim().length > 0 && typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .map(([key, item]) => [key.trim(), item.trim()]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  return text || undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
