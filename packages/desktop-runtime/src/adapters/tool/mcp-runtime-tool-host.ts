import type { RuntimeMcpServerInput, RuntimeMcpToolInfo, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { McpStore } from '../../ports/mcp-store.js';
import type { ToolExecutionContext, ToolExecutionPreview, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';
import { callMcpServerTool } from '../mcp/mcp-tool-discovery.js';

type McpToolMapping = {
  name: string;
  server: RuntimeMcpServerInput;
  tool: RuntimeMcpToolInfo;
};

const emptyInputSchema = { type: 'object', properties: {}, additionalProperties: true };

/**
 * 把已启用的 MCP server 工具映射成模型可调用的 runtime tool。
 */
export class McpRuntimeToolHost implements ToolHost {
  constructor(private readonly mcpStore: McpStore) {}

  /**
   * 列出当前已启用 MCP server 暴露给模型的工具。
   *
   * @param _context ToolHost 协议参数；当前 MCP 映射不依赖执行上下文。
   */
  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    const mappings = await this.listToolMappings();
    // MCP 的 inputSchema 来自外部 server，进入模型前先做最小合法化。
    return mappings.map(({ name, server, tool }) => ({
      name,
      description: [`MCP ${server.label ?? server.key}: ${tool.name}`, tool.description].filter(Boolean).join('\n'),
      inputSchema: validInputSchema(tool.inputSchema),
    }));
  }

  /**
   * 返回给模型的 MCP 工具使用规则。
   */
  systemPrompt(): string {
    return [
      'Enabled MCP server tools are exposed as normal model tools with names prefixed by their server key.',
      'Use these MCP tools directly when the user asks for information or actions provided by an enabled MCP server.',
    ].join('\n');
  }

  /**
   * 判断某个 MCP 工具调用是否需要用户审批。
   *
   * @param name 模型看到的 MCP 工具名。
   * @param _input 工具参数；当前只由 server 策略决定是否审批。
   * @param _context ToolHost 协议参数；当前审批策略不依赖上下文。
   */
  async approvalForTool(name: string, _input: unknown, _context: ToolExecutionContext) {
    const mapping = await this.findToolMapping(name);
    if (!mapping) return null;
    const policy = mapping.server.requireApproval ?? 'always';
    // MCP 默认走审批，只有 server 明确配置 never 才直接执行。
    if (policy === 'never') return null;
    return {
      reason: `调用 MCP 工具：${mapping.server.label ?? mapping.server.key} / ${mapping.tool.name}`,
    };
  }

  /**
   * 生成 MCP 工具调用的 UI 预览。
   *
   * @param name 模型看到的 MCP 工具名。
   * @param input 工具调用参数。
   * @param _context ToolHost 协议参数；当前预览不依赖上下文。
   */
  async previewToolCall(name: string, input: unknown, _context: ToolExecutionContext): Promise<ToolExecutionPreview | null> {
    const mapping = await this.findToolMapping(name);
    if (!mapping) return null;
    return {
      argumentsPreview: JSON.stringify(input ?? {}).slice(0, 1200),
      resultPreview: JSON.stringify({
        server: mapping.server.label ?? mapping.server.key,
        tool: mapping.tool.name,
      }),
    };
  }

  /**
   * 执行映射后的 MCP 工具调用。
   *
   * @param name 模型看到的 MCP 工具名。
   * @param input 工具调用参数。
   * @param _context ToolHost 协议参数；MCP 调用本身从 store 读取 server 配置。
   */
  async runTool(name: string, input: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const mapping = await this.findToolMapping(name);
    if (!mapping) throw new Error(`Unknown MCP tool: ${name}`);
    const result = await callMcpServerTool(mapping.server, mapping.tool.name, input);
    if (result.isError) throw new Error(result.content || 'MCP tool returned an error.');
    return {
      content: result.content,
      preview: result.content.slice(0, 2000),
      data: {
        serverKey: mapping.server.key,
        toolName: mapping.tool.name,
        result: result.data,
      },
    };
  }

  /**
   * 根据模型工具名查找 MCP server/tool 映射。
   *
   * @param name 模型看到的 MCP 工具名。
   */
  private async findToolMapping(name: string): Promise<McpToolMapping | null> {
    return (await this.listToolMappings()).find((mapping) => mapping.name === name) ?? null;
  }

  /**
   * 从持久化 MCP 配置中构造稳定、唯一的模型工具映射表。
   */
  private async listToolMappings(): Promise<McpToolMapping[]> {
    const servers = await this.mcpStore.listServerInputs();
    const usedNames = new Map<string, number>();
    const mappings: McpToolMapping[] = [];
    for (const server of servers) {
      if (server.enabled === false) continue;
      for (const tool of enabledServerTools(server)) {
        // 模型工具名必须稳定且唯一，即使多个 server 暴露同名 tool 也不能互相覆盖。
        const baseName = modelToolName(server.key, tool.name);
        const count = usedNames.get(baseName) ?? 0;
        usedNames.set(baseName, count + 1);
        mappings.push({
          name: uniqueModelToolName(baseName, count),
          server,
          tool,
        });
      }
    }
    return mappings;
  }
}

function enabledServerTools(server: RuntimeMcpServerInput): RuntimeMcpToolInfo[] {
  const tools = server.tools ?? [];
  const allowedTools = new Set(server.allowedTools ?? []);
  const disabledTools = new Set(server.disabledTools ?? []);
  // allowedTools 是正向白名单，disabledTools 是用户临时关闭项；两者同时存在时都要满足。
  return tools.filter((tool) => (!allowedTools.size || allowedTools.has(tool.name)) && !disabledTools.has(tool.name));
}

function modelToolName(serverKey: string, toolName: string): string {
  // 用 server key 前缀避免 MCP tool 与本地内置 tool 同名。
  return trimToolName(`mcp__${safeToolNamePart(serverKey)}__${safeToolNamePart(toolName)}`);
}

function safeToolNamePart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
}

function trimToolName(value: string): string {
  return value.slice(0, 64).replace(/_+$/g, '') || 'mcp_tool';
}

function uniqueModelToolName(baseName: string, collisionIndex: number): string {
  if (!collisionIndex) return baseName;
  const suffix = `_${collisionIndex + 1}`;
  return `${baseName.slice(0, 64 - suffix.length).replace(/_+$/g, '')}${suffix}`;
}

function validInputSchema(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) return emptyInputSchema;
  return value;
}
