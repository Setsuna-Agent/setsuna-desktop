import {
  type ModelRequest,
  type RuntimeConfigState,
  type RuntimeMessage,
  type RuntimeModelRequestToolRuntime,
  type RuntimeToolCall,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type {
  RuntimeToolExecutionContext,
  ToolExecutionPreview,
  ToolHost,
  ToolRuntimeProfile,
} from '../../ports/tool-host.js';
import type { ToolResultStore } from '../../ports/tool-result-store.js';
import { assertSafeRuntimeId } from '../../security/runtime-id.js';
import type {
  ToolOrchestrator,
  ToolOrchestratorRunOptions,
  ToolOrchestratorRunResult,
} from './tool-orchestrator.js';
import {
  TOOL_OUTPUT_BUDGET_DEFAULT_TOKENS,
  TOOL_OUTPUT_BUDGET_READ_TOOL_RESULT_TOKENS,
  TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS,
} from './tool-output-budget.js';

// 默认只让确定性的本地只读工具进入并行批处理；其它 runtime 可通过 profile 显式覆盖。
export const LOCAL_PARALLEL_READ_ONLY_TOOL_NAMES = new Set([
  'list_directory',
  'find_files',
  'search_text',
  'read_file',
  'git_status',
  'git_log',
  'git_show',
  'read_diff',
  'workspace_list_directory',
  'workspace_search_text',
  'workspace_read_file',
]);

export const READ_TOOL_RESULT_TOOL_NAME = 'read_tool_result';

/** read_tool_result 单次工具消息的总字节上限（≈8k tokens）。 */
export const READ_TOOL_RESULT_OUTPUT_BYTES = TOOL_OUTPUT_BUDGET_READ_TOOL_RESULT_TOKENS * 4;
/** 为 result_id、offset 和分页元数据预留空间，避免 executor 二次截断正文。 */
const READ_TOOL_RESULT_METADATA_RESERVE_BYTES = 512;
export const READ_TOOL_RESULT_PAGE_BYTES = READ_TOOL_RESULT_OUTPUT_BYTES
  - READ_TOOL_RESULT_METADATA_RESERVE_BYTES;

const READ_TOOL_RESULT_TOOL: RuntimeToolDefinition = {
  name: READ_TOOL_RESULT_TOOL_NAME,
  description: 'Read a truncated tool result stored under result_id. Each page returns up to 8k tokens; pass the returned offset as the next offset to continue reading.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      result_id: { type: 'string', description: 'result_id from the truncation envelope of a tool result.' },
      offset: { type: 'integer', minimum: 0, description: 'Byte offset to start reading from. Defaults to 0.' },
      limit: { type: 'integer', minimum: 1, maximum: 32000, description: 'Requested content bytes for this page. The runtime reserves space for pagination metadata.' },
    },
    required: ['result_id'],
  },
};

/** 未在 profile 声明 modelOutputTokenLimit 时的名称回退预算。 */
const DEFAULT_BOUNDED_OUTPUT_TOOL_LIMITS = new Map<string, number>([
  ['run_shell_command', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['exec_command', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['write_shell_process', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['write_stdin', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['read_shell_process', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['list_shell_processes', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['terminate_shell_process', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['git_status', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['git_log', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['git_show', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['read_diff', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['list_mcp_resources', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['list_mcp_resource_templates', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
  ['read_mcp_resource', TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS],
]);

export type RuntimeToolRouterOptions = {
  toolHost: ToolHost;
  orchestrator: ToolOrchestrator | null;
  context: RuntimeToolExecutionContext;
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  allowTool?(tool: RuntimeToolDefinition): boolean;
  strictApprovalRequiresSerial?: boolean;
  toolResultStore?: ToolResultStore;
};

/**
 * 维护经过权限与可见性过滤的 host catalog，并追加 runtime 自带工具。
 * catalog 中的工具默认全部随每次模型请求下发。
 */
export class RuntimeToolRouter {
  private readonly catalogTools: RuntimeToolDefinition[];
  private readonly catalogToolNames: ReadonlySet<string>;
  private readonly profiles: Map<string, ToolRuntimeProfile>;

  private constructor(
    private readonly options: RuntimeToolRouterOptions,
    catalogTools: RuntimeToolDefinition[],
    profiles: Map<string, ToolRuntimeProfile>,
  ) {
    this.catalogTools = catalogTools;
    this.catalogToolNames = new Set(catalogTools.map((tool) => tool.name));
    this.profiles = profiles;
  }

  static async create(options: RuntimeToolRouterOptions): Promise<RuntimeToolRouter> {
    const allTools = await options.toolHost.listTools(options.context);
    const profiles = new Map<string, ToolRuntimeProfile>();
    const catalogTools: RuntimeToolDefinition[] = [];

    for (const tool of allTools) {
      if (options.allowTool && !options.allowTool(tool)) continue;
      const profile = await runtimeProfileForTool(options.toolHost, options.context, tool.name);
      profiles.set(tool.name, profile);
      if (toolIsHidden(profile)) continue;
      catalogTools.push(tool);
    }

    return new RuntimeToolRouter(options, catalogTools, profiles);
  }

  /** 本次请求实际下发给模型的完整可见工具目录。 */
  get tools(): RuntimeToolDefinition[] {
    return this.advertisedTools();
  }

  /** 完整允许目录，用于工具安全规则与 permissions prompt 的稳定构建。 */
  get catalogToolDefinitions(): RuntimeToolDefinition[] {
    return this.catalogTools;
  }

  private advertisedTools(): RuntimeToolDefinition[] {
    return [
      ...this.catalogTools,
      READ_TOOL_RESULT_TOOL,
    ];
  }

  /**
   * 是否属于当前 turn 可路由的工具目录。advertised 只控制发送给模型的
   * Schema，不是执行权限；真正的权限与审批仍由 catalog 过滤和 orchestrator 负责。
   */
  canRouteTool(name: string): boolean {
    return this.catalogToolNames.has(name) || name === READ_TOOL_RESULT_TOOL_NAME;
  }

  /** host catalog 与 runtime 自带工具始终阻止同名动态工具接管。 */
  reservesDynamicToolName(name: string): boolean {
    return this.catalogToolNames.has(name) || name === READ_TOOL_RESULT_TOOL_NAME;
  }

  async toolRuntimeMetadata(): Promise<RuntimeModelRequestToolRuntime[]> {
    return Promise.all(this.advertisedTools().map(async (tool) => {
      const profile = await this.profileFor(tool.name);
      return {
        name: tool.name,
        source: 'host' as const,
        supportsParallel: profile.supportsParallel === true,
        waitsForRuntimeCancellation: profile.waitsForRuntimeCancellation !== false,
      };
    }));
  }

  async systemPrompt(): Promise<string | null> {
    return this.options.toolHost.systemPrompt?.(this.options.context, { tools: this.catalogTools }) ?? null;
  }

  async externalContext() {
    return this.options.toolHost.externalContext?.(this.options.context, { tools: this.advertisedTools() }) ?? [];
  }

  async toolChoice(messages: RuntimeMessage[]): Promise<ModelRequest['toolChoice']> {
    if (!this.advertisedTools().length) return undefined;
    let forcedChoice: ModelRequest['toolChoice'] | null = null;
    try {
      forcedChoice = (await this.options.toolHost.toolChoice?.(this.options.context, { tools: this.advertisedTools(), messages })) ?? null;
    } catch {
      forcedChoice = null;
    }
    return forcedChoice ?? 'auto';
  }

  async previewPartialToolCall(name: string, rawArguments: string): Promise<ToolExecutionPreview | null> {
    if (!this.canRouteTool(name)) return null;
    const preview = this.options.toolHost.previewPartialToolCall;
    if (!preview) return null;
    return preview.call(this.options.toolHost, name, rawArguments, this.options.context).catch(() => null);
  }

  async canRunInParallel(toolCall: RuntimeToolCall, parsedArguments: unknown): Promise<boolean> {
    if (!this.canRouteTool(toolCall.name)) return false;
    if (!isPlainRecord(parsedArguments)) return false;
    if (this.options.strictApprovalRequiresSerial) return false;
    if (!this.options.orchestrator) return false;
    const profile = await this.profileFor(toolCall.name);
    if (profile.supportsParallel !== true) return false;
    return this.options.orchestrator.canRunWithoutApproval(
      toolCall,
      parsedArguments,
      this.options.context,
      this.options.approvalPolicy,
    );
  }

  async runToolCall(
    toolCall: RuntimeToolCall,
    parsedArguments: unknown,
    options: ToolOrchestratorRunOptions = {},
  ): Promise<ToolOrchestratorRunResult> {
    if (!this.catalogToolNames.has(toolCall.name)) {
      throw new Error(`Tool ${toolCall.name} is not registered in the allowed tool catalog.`);
    }
    if (!this.options.orchestrator) throw new Error('Tool runtime is unavailable.');
    const profile = await this.profileFor(toolCall.name);
    return this.options.orchestrator.runToolCall(
      toolCall,
      parsedArguments,
      this.options.context,
      this.options.approvalPolicy,
      {
        ...options,
        ...(profile.plugin ? { plugin: profile.plugin } : {}),
        waitsForRuntimeCancellation: profile.waitsForRuntimeCancellation !== false,
      },
    );
  }

  /** 读取超限工具结果的分页,线程无权访问时返回提示文本。 */
  async runReadToolResult(input: unknown, threadId: string): Promise<string> {
    if (!this.options.toolResultStore) {
      return 'Tool result storage is unavailable; no truncated results exist in this runtime.';
    }
    const args = normalizeReadToolResultArgs(input);
    if (!args) {
      return 'Invalid read_tool_result arguments: provide a non-empty result_id string and non-negative offsets.';
    }
    const page = await this.options.toolResultStore.read(threadId, args.resultId, args.offset, args.limit);
    if (!page) {
      return `Tool result ${args.resultId} is not found or is not authorized for this thread.`;
    }
    return [
      `result_id: ${args.resultId}`,
      `offset: ${args.offset}`,
      `next_offset: ${page.nextOffset ?? 'end'}`,
      `total_bytes: ${page.totalBytes}`,
      '',
      page.content,
    ].join('\n');
  }

  /** 该工具结果进入模型上下文的上限 token 数。 */
  async modelOutputTokenLimitFor(name: string): Promise<number> {
    if (name === READ_TOOL_RESULT_TOOL_NAME) return TOOL_OUTPUT_BUDGET_READ_TOOL_RESULT_TOKENS;
    const profile = await this.profileFor(name);
    const profileLimit = profile.modelOutputTokenLimit;
    if (typeof profileLimit === 'number' && Number.isFinite(profileLimit) && profileLimit > 0) {
      return Math.floor(profileLimit);
    }
    const nameLimit = DEFAULT_BOUNDED_OUTPUT_TOOL_LIMITS.get(name);
    if (nameLimit !== undefined) return nameLimit;
    if (name.startsWith('mcp__')) return TOOL_OUTPUT_BUDGET_SHELL_GIT_MCP_TOKENS;
    return TOOL_OUTPUT_BUDGET_DEFAULT_TOKENS;
  }

  private async profileFor(name: string): Promise<ToolRuntimeProfile> {
    const existing = this.profiles.get(name);
    if (existing) return existing;
    const profile = await runtimeProfileForTool(this.options.toolHost, this.options.context, name);
    this.profiles.set(name, profile);
    return profile;
  }
}

async function runtimeProfileForTool(
  toolHost: ToolHost,
  context: RuntimeToolExecutionContext,
  name: string,
): Promise<ToolRuntimeProfile> {
  const base: ToolRuntimeProfile = {
    supportsParallel: LOCAL_PARALLEL_READ_ONLY_TOOL_NAMES.has(name),
    waitsForRuntimeCancellation: true,
    visibleToModel: true,
  };
  let override: ToolRuntimeProfile | null = null;
  try {
    override = (await toolHost.toolRuntimeProfile?.(name, context)) ?? null;
  } catch {
    override = null;
  }
  return { ...base, ...(override ?? {}) };
}

function toolIsHidden(profile: ToolRuntimeProfile): boolean {
  return profile.visibleToModel === false;
}

function normalizeReadToolResultArgs(value: unknown): { resultId: string; offset: number; limit: number } | null {
  if (!isPlainRecord(value)) return null;
  const resultId = typeof value.result_id === 'string' && value.result_id.trim()
    ? value.result_id.trim()
    : typeof value.resultId === 'string' && value.resultId.trim()
      ? value.resultId.trim()
      : '';
  if (!resultId) return null;
  try {
    assertSafeRuntimeId(resultId, 'Tool result id');
  } catch {
    return null;
  }
  const offset = integerArg(value.offset ?? 0);
  if (offset === null) return null;
  const limit = integerArg(value.limit ?? READ_TOOL_RESULT_PAGE_BYTES);
  if (limit === null || limit < 1) return null;
  return {
    resultId,
    offset,
    limit: Math.min(limit, READ_TOOL_RESULT_PAGE_BYTES),
  };
}

function integerArg(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
