import {
  BROWSER_SNAPSHOT_TOOL_NAME,
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
  buildDeferredToolSearchText,
  DeferredToolSearchIndex,
  type DeferredToolSearchEntry,
} from './deferred-tool-search.js';
import {
  TOOL_OUTPUT_BUDGET_BROWSER_SNAPSHOT_TOKENS,
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

export const TOOL_SEARCH_TOOL_NAME = 'tool_search';
export const READ_TOOL_RESULT_TOOL_NAME = 'read_tool_result';
export const RUNTIME_PROVIDED_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_SEARCH_TOOL_NAME,
  READ_TOOL_RESULT_TOOL_NAME,
]);

/** 每个 turn 最多激活的 deferred 工具数。 */
export const MAX_LOADED_DEFERRED_TOOLS = 16;

/** read_tool_result 单次工具消息的总字节上限（≈8k tokens）。 */
export const READ_TOOL_RESULT_OUTPUT_BYTES = TOOL_OUTPUT_BUDGET_READ_TOOL_RESULT_TOKENS * 4;
/** 为 result_id、offset 和分页元数据预留空间，避免 executor 二次截断正文。 */
const READ_TOOL_RESULT_METADATA_RESERVE_BYTES = 512;
export const READ_TOOL_RESULT_PAGE_BYTES = READ_TOOL_RESULT_OUTPUT_BYTES
  - READ_TOOL_RESULT_METADATA_RESERVE_BYTES;

const TOOL_SEARCH_TOOL: RuntimeToolDefinition = {
  name: TOOL_SEARCH_TOOL_NAME,
  description: 'Search the deferred tool catalog for a capability. Returns matching concrete tool names with short descriptions; activated tools get appended to the tools of your next request.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'What capability you need, e.g. "open a browser tab" or "run git log".' },
      max_results: { type: 'integer', minimum: 1, maximum: 8, description: 'Maximum concrete tools to return. Defaults to 8.' },
    },
    required: ['query'],
  },
};

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
  [BROWSER_SNAPSHOT_TOOL_NAME, TOOL_OUTPUT_BUDGET_BROWSER_SNAPSHOT_TOKENS],
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
  /** 本 turn 之前已激活的 deferred 工具名,用于跨 sampling step 保持激活。 */
  loadedDeferredToolNames?: string[];
  /** 激活集合变化(新增 deferred 工具)时通知外部持久化 per-turn 状态。 */
  onDeferredActivated?(names: string[]): void;
};

/**
 * 显式维护 catalog/direct/deferred/loaded/advertised 五类工具集合。
 *
 * 最终模型工具顺序固定为:所有 direct 工具 → tool_search / read_tool_result →
 * collaboration / goal / dynamic direct 工具(由调用方追加)→ 已加载 deferred
 * 工具后缀。这样搜索只改变末尾后缀,不会打乱静态前缀。
 */
export class RuntimeToolRouter {
  private readonly catalogTools: RuntimeToolDefinition[];
  private readonly catalogToolNames: ReadonlySet<string>;
  private readonly directTools: RuntimeToolDefinition[];
  private readonly deferredEntries: DeferredToolSearchEntry[];
  private readonly searchIndex: DeferredToolSearchIndex;
  private readonly profiles: Map<string, ToolRuntimeProfile>;
  /** Deferred tools that were advertised when this sampling step was built. */
  private readonly advertisedDeferredToolNames = new Set<string>();
  /** Deferred tools activated for the next sampling step of the same turn. */
  private readonly loadedDeferredTools = new Map<string, RuntimeToolDefinition>();

  private constructor(
    private readonly options: RuntimeToolRouterOptions,
    catalogTools: RuntimeToolDefinition[],
    directTools: RuntimeToolDefinition[],
    deferredEntries: DeferredToolSearchEntry[],
    profiles: Map<string, ToolRuntimeProfile>,
  ) {
    this.catalogTools = catalogTools;
    this.catalogToolNames = new Set(catalogTools.map((tool) => tool.name));
    this.directTools = directTools;
    this.deferredEntries = deferredEntries;
    this.searchIndex = new DeferredToolSearchIndex(deferredEntries);
    this.profiles = profiles;
    // 跨 step 保持的激活按全局 catalog 顺序恢复，保证 tools 后缀字节稳定。
    // 只接受仍属于 deferred catalog 的名称，避免 profile 变化后重复暴露 direct 工具。
    const loadedNames = new Set(options.loadedDeferredToolNames ?? []);
    for (const entry of deferredEntries) {
      if (!loadedNames.has(entry.name)) continue;
      if (this.loadedDeferredTools.size >= MAX_LOADED_DEFERRED_TOOLS) break;
      this.loadedDeferredTools.set(entry.name, entry.definition);
      this.advertisedDeferredToolNames.add(entry.name);
    }
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

    const directTools: RuntimeToolDefinition[] = [];
    const deferredEntries: DeferredToolSearchEntry[] = [];
    catalogTools.forEach((tool, catalogOrder) => {
      const profile = profiles.get(tool.name);
      if (profile?.exposure === 'deferred') {
        deferredEntries.push({
          name: tool.name,
          searchText: buildDeferredToolSearchText(tool, profile.searchAliases),
          definition: tool,
          catalogOrder,
        });
      } else {
        directTools.push(tool);
      }
    });

    return new RuntimeToolRouter(options, catalogTools, directTools, deferredEntries, profiles);
  }

  /** 本次请求实际下发给模型的工具(静态 direct 前缀 + 已加载 deferred 后缀)。 */
  get tools(): RuntimeToolDefinition[] {
    return this.advertisedTools();
  }

  /** 完整允许目录(含 deferred),用于工具安全规则与 permissions prompt 的稳定构建。 */
  get catalogToolDefinitions(): RuntimeToolDefinition[] {
    return this.catalogTools;
  }

  private advertisedTools(): RuntimeToolDefinition[] {
    return [
      ...this.directTools,
      TOOL_SEARCH_TOOL,
      READ_TOOL_RESULT_TOOL,
      ...this.deferredToolsInCatalogOrder(this.advertisedDeferredToolNames),
    ];
  }

  hasTool(name: string): boolean {
    return this.directTools.some((tool) => tool.name === name)
      || this.advertisedDeferredToolNames.has(name)
      || RUNTIME_PROVIDED_TOOL_NAMES.has(name);
  }

  /** host catalog 与 runtime 自带工具始终阻止同名动态工具接管。 */
  reservesDynamicToolName(name: string): boolean {
    return this.catalogToolNames.has(name) || RUNTIME_PROVIDED_TOOL_NAMES.has(name);
  }

  advertisedToolNames(): string[] {
    return this.advertisedTools().map((tool) => tool.name);
  }

  /** deferred 目录大小(遥测用)。 */
  deferredCatalogSize(): number {
    return this.searchIndex.size;
  }

  /** 当前已加载的 deferred 工具名(catalog 顺序,遥测与 per-turn 状态用)。 */
  loadedDeferredToolNames(): string[] {
    return this.loadedDeferredToolsInCatalogOrder().map((tool) => tool.name);
  }

  async toolRuntimeMetadata(): Promise<RuntimeModelRequestToolRuntime[]> {
    return Promise.all(this.advertisedTools().map(async (tool) => {
      const profile = await this.profileFor(tool.name);
      return {
        name: tool.name,
        source: 'host' as const,
        exposure: this.profileExposure(tool.name) === 'deferred' ? 'deferred' as const : 'direct' as const,
        supportsParallel: profile.supportsParallel === true,
        waitsForRuntimeCancellation: profile.waitsForRuntimeCancellation !== false,
      };
    }));
  }

  async systemPrompt(): Promise<string | null> {
    // 工具安全规则基于完整允许目录构建,不随搜索结果变化。
    return this.options.toolHost.systemPrompt?.(this.options.context, { tools: this.catalogTools }) ?? null;
  }

  async externalContext() {
    // MCP server instructions 只随当前已暴露工具加载,避免一次性注入所有 server。
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
    if (!this.hasTool(name)) return null;
    const preview = this.options.toolHost.previewPartialToolCall;
    if (!preview) return null;
    return preview.call(this.options.toolHost, name, rawArguments, this.options.context).catch(() => null);
  }

  async canRunInParallel(toolCall: RuntimeToolCall, parsedArguments: unknown): Promise<boolean> {
    if (!this.hasTool(toolCall.name)) return false;
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
    // 执行门禁使用构建本 sampling step 时的不可变快照。tool_search 在本 step
    // 新激活的工具只能进入下一次模型请求，不能被同一批 tool_calls 越权执行。
    if (!this.hasTool(toolCall.name)) {
      throw new Error(`Tool ${toolCall.name} was not advertised in this sampling step.`);
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

  /**
   * Codex 风格 tool_search:返回具体工具名与简短描述,不在 tool message 中
   * 重复完整 Schema(定义在下一轮 tools 后缀里提供)。命中的工具在当前 turn
   * 保持激活。
   */
  async runToolSearch(query: string, maxResults: number | undefined): Promise<string> {
    const results = this.searchIndex.search(query, maxResults);
    const active = this.activateDeferredTools(results.map((result) => result.name));
    const activeNames = new Set(active);
    const visible = results.filter((result) => activeNames.has(result.name));
    if (!visible.length) {
      return 'No deferred tools matched the query. Try a different capability description, or use the direct tools already advertised in this request.';
    }
    return [
      `Matching tools (${visible.length}):`,
      ...visible.map((result) => `- ${result.name}: ${result.description}`),
      'Full definitions are appended to the tools of your next request.',
    ].join('\n');
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

  /**
   * 激活命中的 deferred 工具(按 catalog 顺序追加,不按 BM25 排名),
   * 每个 turn 最多 MAX_LOADED_DEFERRED_TOOLS 个。返回激活后仍处于
   * loaded 集合的名称。
   */
  activateDeferredTools(names: string[]): string[] {
    const wanted = new Set(names);
    let changed = false;
    for (const entry of this.deferredEntries) {
      if (!wanted.has(entry.name)) continue;
      if (this.loadedDeferredTools.size >= MAX_LOADED_DEFERRED_TOOLS) break;
      if (!this.loadedDeferredTools.has(entry.name)) {
        this.loadedDeferredTools.set(entry.name, entry.definition);
        changed = true;
      }
    }
    const loaded = this.loadedDeferredToolNames();
    if (changed) this.options.onDeferredActivated?.(loaded);
    return loaded;
  }

  private loadedDeferredToolsInCatalogOrder(): RuntimeToolDefinition[] {
    return this.deferredToolsInCatalogOrder(new Set(this.loadedDeferredTools.keys()));
  }

  private deferredToolsInCatalogOrder(names: ReadonlySet<string>): RuntimeToolDefinition[] {
    return this.catalogTools
      .filter((tool) => names.has(tool.name));
  }

  private profileExposure(name: string): ToolRuntimeProfile['exposure'] {
    return this.profiles.get(name)?.exposure;
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
  return profile.exposure === 'hidden' || profile.visibleToModel === false;
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
