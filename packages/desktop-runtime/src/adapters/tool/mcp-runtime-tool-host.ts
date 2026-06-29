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

export class McpRuntimeToolHost implements ToolHost {
  constructor(private readonly mcpStore: McpStore) {}

  async listTools(_context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    const mappings = await this.listToolMappings();
    return mappings.map(({ name, server, tool }) => ({
      name,
      description: [`MCP ${server.label ?? server.key}: ${tool.name}`, tool.description].filter(Boolean).join('\n'),
      inputSchema: validInputSchema(tool.inputSchema),
    }));
  }

  systemPrompt(): string {
    return [
      'Enabled MCP server tools are exposed as normal model tools with names prefixed by their server key.',
      'Use these MCP tools directly when the user asks for information or actions provided by an enabled MCP server.',
    ].join('\n');
  }

  async approvalForTool(name: string, _input: unknown, _context: ToolExecutionContext) {
    const mapping = await this.findToolMapping(name);
    if (!mapping) return null;
    const policy = mapping.server.requireApproval ?? 'always';
    if (policy === 'never') return null;
    return {
      reason: `调用 MCP 工具：${mapping.server.label ?? mapping.server.key} / ${mapping.tool.name}`,
    };
  }

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

  private async findToolMapping(name: string): Promise<McpToolMapping | null> {
    return (await this.listToolMappings()).find((mapping) => mapping.name === name) ?? null;
  }

  private async listToolMappings(): Promise<McpToolMapping[]> {
    const servers = await this.mcpStore.listServerInputs();
    const usedNames = new Map<string, number>();
    const mappings: McpToolMapping[] = [];
    for (const server of servers) {
      if (server.enabled === false) continue;
      for (const tool of enabledServerTools(server)) {
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
  return tools.filter((tool) => (!allowedTools.size || allowedTools.has(tool.name)) && !disabledTools.has(tool.name));
}

function modelToolName(serverKey: string, toolName: string): string {
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
