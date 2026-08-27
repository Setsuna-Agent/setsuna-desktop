import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { McpControl } from '../contracts/control.js';
import type {
  McpToolApprovalRequirement,
  McpToolExecutionContext,
  McpToolExecutionPreview,
  McpToolExecutionResult,
  McpToolExternalContext,
  McpToolRunContext,
  McpToolRuntimeProfile,
  McpRuntimeToolService,
} from '../contracts/runtime-tools.js';
import { McpManagementTools } from './tools/management-tools.js';
import { McpRuntimeTools } from './tools/runtime-tools.js';

/**
 * MCP 工具服务实现。内部区分 management 与 runtime 两组 owner，对外作为
 * `McpRuntimeToolService` 暴露给 desktop-runtime 的 `McpToolHostAdapter`。
 *
 * 保持顺序：management tools 在前，runtime tools（resources + server tools）在后；
 * runtime tool 的 deferred profile 与 token 上限不变；server instructions 只在
 * 对应 runtime MCP tool 被暴露时注入。
 */
export class McpRuntimeToolServiceImpl implements McpRuntimeToolService {
  private readonly management: McpManagementTools;
  private readonly runtime: McpRuntimeTools;

  constructor(
    mcpControl: McpControl,
    mcpStore: { listServerInputs(): Promise<import('@setsuna-desktop/contracts').RuntimeMcpServerInput[]> },
  ) {
    this.management = new McpManagementTools(mcpControl);
    this.runtime = new McpRuntimeTools(mcpStore, mcpControl);
  }

  async listTools(context: McpToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    const management = this.management.listTools();
    const runtime = await this.runtime.listTools(context);
    return [...management, ...runtime];
  }

  toolRuntimeProfile(name: string, _context: McpToolExecutionContext): McpToolRuntimeProfile | null {
    if (name === 'configure_mcp_server') return null;
    return this.runtime.toolRuntimeProfile();
  }

  systemPrompt(context: McpToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): string | null {
    if (request) {
      const hasManagement = request.tools.some((tool) => tool.name === 'configure_mcp_server');
      const runtimePrompt = this.runtime.systemPrompt(context, request);
      if (!hasManagement) return runtimePrompt;
      if (!runtimePrompt) return this.managementPrompt();
      return `${this.managementPrompt()}\n\n${runtimePrompt}`;
    }
    return `${this.managementPrompt()}\n\n${this.runtime.systemPrompt(context, undefined) ?? ''}`.trim() || null;
  }

  async externalContext(
    context: McpToolExecutionContext,
    request?: { tools: RuntimeToolDefinition[] },
  ): Promise<McpToolExternalContext[]> {
    if (request && !request.tools.some((tool) => tool.name.startsWith('mcp__') || ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(tool.name))) {
      return [];
    }
    return this.runtime.externalContext(context, request);
  }

  async approvalForTool(
    name: string,
    input: unknown,
    _context: McpToolExecutionContext,
  ): Promise<McpToolApprovalRequirement | null> {
    if (name === 'configure_mcp_server') {
      return this.management.approvalForTool(name, input);
    }
    return this.runtime.approvalForTool();
  }

  async previewToolCall(
    name: string,
    input: unknown,
    context: McpToolExecutionContext,
  ): Promise<McpToolExecutionPreview | null> {
    if (name === 'configure_mcp_server') {
      return this.management.previewToolCall(name, input);
    }
    return this.runtime.previewToolCall(name, input, context);
  }

  async runTool(name: string, input: unknown, context: McpToolRunContext): Promise<McpToolExecutionResult> {
    if (name === 'configure_mcp_server') {
      return this.management.runTool(name, input);
    }
    return this.runtime.runTool(name, input, context);
  }

  private managementPrompt(): string {
    return this.management.systemPrompt();
  }
}
