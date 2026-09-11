import { runtimeText, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import {
  type RuntimeMcpServer,
  type RuntimeMcpServerInput,
  type RuntimeMcpTransport,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { McpControl } from '../../contracts/control.js';
import type { McpToolApprovalRequirement, McpToolExecutionResult } from '../../contracts/runtime-tools.js';
import { recordInput } from '../shared.js';

const configureMcpToolName = 'configure_mcp_server';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1000;

function configureMcpDefinition(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition {
  const text = runtimeText(language);
  return {
    name: configureMcpToolName,
    description: text('Create or update a Setsuna Desktop MCP server in the current runtime MCP configuration. Requires user authorization.', "创建或更新当前运行时 MCP 配置中的 Setsuna Desktop MCP 服务。需要用户授权。"),
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: text('Stable server key. Spaces are normalized to underscores.', "稳定的服务标识；空格会规范化为下划线。"),
        },
        label: {
          type: 'string',
          description: text('Optional display name for the MCP server.', "可选 MCP 服务显示名称。"),
        },
        description: {
          type: 'string',
          description: text('Optional description of the server.', "可选服务描述。"),
        },
        transport: {
          type: 'string',
          enum: ['stdio', 'streamableHttp'],
          description: text('Transport type. Use stdio for command-based servers and streamableHttp for URL-based servers.', "传输类型。命令启动的服务用 stdio，URL 服务用 streamableHttp。"),
        },
        command: {
          type: 'string',
          description: text('Command for stdio servers, such as npx, node, uvx, or an absolute executable path.', "stdio 服务的命令，例如 npx、node、uvx 或可执行文件绝对路径。"),
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: text('Command arguments for stdio servers.', "stdio 服务的命令参数。"),
        },
        cwd: {
          type: 'string',
          description: text('Optional working directory for stdio servers.', "可选 stdio 服务工作目录。"),
        },
        url: {
          type: 'string',
          description: text('URL for streamable HTTP MCP servers.', "流式 HTTP MCP 服务的 URL。"),
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: text('Optional HTTP headers for streamable HTTP servers.', "可选流式 HTTP 服务请求头。"),
        },
        env_http_headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: text('Optional HTTP header names mapped to environment variable names for streamable HTTP servers.', "可选流式 HTTP 服务的请求头名称到环境变量名称的映射。"),
        },
        envHttpHeaders: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: text('Optional HTTP header names mapped to environment variable names for streamable HTTP servers.', "可选流式 HTTP 服务的请求头名称到环境变量名称的映射。"),
        },
        bearer_token_env_var: {
          type: 'string',
          description: text('Optional environment variable that contains the bearer token for streamable HTTP servers.', "可选包含流式 HTTP 服务 bearer token 的环境变量名。"),
        },
        bearerTokenEnvVar: {
          type: 'string',
          description: text('Optional environment variable that contains the bearer token for streamable HTTP servers.', "可选包含流式 HTTP 服务 bearer token 的环境变量名。"),
        },
        oauth_client_id: {
          type: 'string',
          description: text('Optional OAuth client ID for streamable HTTP MCP login.', "可选流式 HTTP MCP 登录所用的 OAuth client ID。"),
        },
        oauthClientId: {
          type: 'string',
          description: text('Optional OAuth client ID for streamable HTTP MCP login.', "可选流式 HTTP MCP 登录所用的 OAuth client ID。"),
        },
        oauth_resource: {
          type: 'string',
          description: text('Optional OAuth resource parameter for streamable HTTP MCP login.', "可选流式 HTTP MCP 登录所用的 OAuth resource 参数。"),
        },
        oauthResource: {
          type: 'string',
          description: text('Optional OAuth resource parameter for streamable HTTP MCP login.', "可选流式 HTTP MCP 登录所用的 OAuth resource 参数。"),
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: text('Optional environment variables for stdio servers.', "可选 stdio 服务环境变量。"),
        },
        timeout_ms: {
          type: 'integer',
          description: text('Optional request timeout in milliseconds.', "可选请求超时（毫秒）。"),
          minimum: 1000,
          maximum: MAX_TIMEOUT_MS,
        },
        timeoutMs: {
          type: 'integer',
          description: text('Optional request timeout in milliseconds.', "可选请求超时（毫秒）。"),
          minimum: 1000,
          maximum: MAX_TIMEOUT_MS,
        },
        startup_timeout_ms: {
          type: 'integer',
          description: text('Optional stdio startup timeout in milliseconds.', "可选 stdio 启动超时（毫秒）。"),
          minimum: 1000,
          maximum: MAX_TIMEOUT_MS,
        },
        startupTimeoutMs: {
          type: 'integer',
          description: text('Optional stdio startup timeout in milliseconds.', "可选 stdio 启动超时（毫秒）。"),
          minimum: 1000,
          maximum: MAX_TIMEOUT_MS,
        },
        tool_timeout_ms: {
          type: 'integer',
          description: text('Optional per-tool timeout in milliseconds.', "可选每个工具调用的超时（毫秒）。"),
          minimum: 1000,
          maximum: MAX_TIMEOUT_MS,
        },
        toolTimeoutMs: {
          type: 'integer',
          description: text('Optional per-tool timeout in milliseconds.', "可选每个工具调用的超时（毫秒）。"),
          minimum: 1000,
          maximum: MAX_TIMEOUT_MS,
        },
        enabled: {
          type: 'boolean',
          description: text('Whether the server is enabled. Defaults to true.', "是否启用服务。默认 true。"),
        },
        allowed_tools: {
          type: 'array',
          items: { type: 'string' },
          description: text('Optional allow-list of tool names exposed from this server.', "可选该服务公开的工具名称白名单。"),
        },
        allowedTools: {
          type: 'array',
          items: { type: 'string' },
          description: text('Optional allow-list of tool names exposed from this server.', "可选该服务公开的工具名称白名单。"),
        },
        disabled_tools: {
          type: 'array',
          items: { type: 'string' },
          description: text('Optional block-list of tool names hidden from this server.', "可选该服务隐藏的工具名称黑名单。"),
        },
        disabledTools: {
          type: 'array',
          items: { type: 'string' },
          description: text('Optional block-list of tool names hidden from this server.', "可选该服务隐藏的工具名称黑名单。"),
        },
      },
      required: ['key'],
    },
  };
}

export const configureMcpServerToolName = configureMcpToolName;

export class McpManagementTools {
  constructor(private readonly mcpControl: McpControl) {}

  listTools(language?: RuntimeInterfaceLanguage): RuntimeToolDefinition[] {
    return [configureMcpDefinition(language)];
  }

  systemPrompt(language?: RuntimeInterfaceLanguage): string {
    const text = runtimeText(language);
    return [
      text('When the user asks to create, update, enable, disable, or configure a Setsuna Desktop MCP server from chat, use configure_mcp_server.', "用户通过对话要求创建、更新、启用、禁用或配置 Setsuna Desktop MCP 服务时，使用 configure_mcp_server。"),
      text('This tool writes the current desktop runtime MCP configuration used by the Capabilities page.', "此工具写入能力管理页面使用的当前桌面运行时 MCP 配置。"),
      text('Do not write MCP JSON files directly.', "不要直接写入 MCP JSON 文件。"),
    ].join('\n');
  }

  async approvalForTool(name: string, input: unknown): Promise<McpToolApprovalRequirement | null> {
    if (name !== configureMcpToolName) return null;
    const list = await this.mcpControl.listServers();
    const normalized = normalizeMcpInput(input);
    const existing = list.servers.find((server) => server.key === normalized.key);
    const preview = mcpPreviewPayload(normalized, list.configPath, existing);
    return {
      reason: `${preview.action === 'update' ? '更新' : '创建'} MCP 服务：${preview.label || preview.key}`,
      argumentsPreview: JSON.stringify(preview).slice(0, 1200),
    };
  }

  async previewToolCall(name: string, input: unknown): Promise<{ argumentsPreview?: string; resultPreview?: string; integrityToken?: string } | null> {
    if (name !== configureMcpToolName) return null;
    const normalized = normalizeMcpInput(input);
    const list = await this.mcpControl.listServers();
    const existing = list.servers.find((server) => server.key === normalized.key);
    return {
      resultPreview: JSON.stringify(mcpPreviewPayload(normalized, list.configPath, existing)),
    };
  }

  async runTool(name: string, input: unknown): Promise<McpToolExecutionResult> {
    if (name !== configureMcpToolName) throw new Error(`Unknown tool: ${name}`);

    const normalized = normalizeMcpInput(input);
    const before = await this.mcpControl.listServers();
    const existing = before.servers.find((server) => server.key === normalized.key);
    const discovery = await this.discoverToolsForSave(normalized);
    const inputToSave = discovery.tools.length ? { ...normalized, tools: discovery.tools } : normalized;
    const savedList = await this.mcpControl.upsertServer(inputToSave);
    const saved = savedList.servers.find((server) => server.key === normalized.key);
    if (!saved) throw new Error(`MCP server was not saved: ${normalized.key}`);
    const enabledToolCount = mcpEnabledToolCount(saved);

    return {
      content: [
        `MCP server configured: ${saved.label}`,
        `Key: ${saved.key}`,
        `Config: ${savedList.configPath}`,
        `Transport: ${saved.transport}`,
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

  private async discoverToolsForSave(input: RuntimeMcpServerInput) {
    if (input.tools?.length) return { tools: input.tools, errors: [] };
    return this.mcpControl.discoverTools(input);
  }
}

function mcpPreviewPayload(
  input: RuntimeMcpServerInput,
  configPath: string,
  existing?: RuntimeMcpServer,
) {
  return {
    action: existing ? 'update' : 'create',
    key: input.key,
    label: input.label ?? existing?.label ?? input.key,
    description: input.description ?? existing?.description,
    transport: input.transport ?? existing?.transport ?? inferTransport(input),
    command: input.command ?? existing?.command,
    args: input.args ?? existing?.args ?? [],
    url: input.url ?? existing?.url,
    timeoutMs: input.timeoutMs ?? existing?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    enabled: input.enabled ?? existing?.enabled ?? true,
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

export function mcpResultPreview(action: 'create' | 'update', server: RuntimeMcpServer, configPath: string) {
  return {
    action,
    key: server.key,
    label: server.label,
    transport: server.transport,
    command: server.command,
    args: server.args,
    url: server.url,
    timeoutMs: server.timeoutMs,
    enabled: server.enabled,
    allowedTools: server.allowedTools,
    disabledTools: server.disabledTools,
    oauthClientId: server.oauthClientId,
    oauthResource: server.oauthResource,
    envKeys: server.envKeys,
    headerKeys: server.headerKeys,
    configPath,
  };
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

function inferTransport(input: RuntimeMcpServerInput): RuntimeMcpTransport {
  return input.command || !input.url ? 'stdio' : 'streamableHttp';
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

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
