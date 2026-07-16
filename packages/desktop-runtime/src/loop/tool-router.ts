import type { ModelRequest, RuntimeConfigState, RuntimeMessage, RuntimeModelRequestToolRuntime, RuntimeToolCall, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { RuntimeToolExecutionContext, ToolExecutionPreview, ToolHost, ToolRuntimeProfile } from '../ports/tool-host.js';
import type { ToolOrchestrator, ToolOrchestratorRunOptions, ToolOrchestratorRunResult } from './tool-orchestrator.js';

// 默认只让确定性的本地只读工具进入并行批处理；其它 runtime 可通过 profile 显式覆盖。
export const LOCAL_PARALLEL_READ_ONLY_TOOL_NAMES = new Set(['list_directory', 'find_files', 'search_text', 'read_file', 'git_status', 'git_log', 'git_show', 'read_diff', 'workspace_list_directory', 'workspace_search_text', 'workspace_read_file']);

export type RuntimeToolRouterOptions = {
  toolHost: ToolHost;
  orchestrator: ToolOrchestrator | null;
  context: RuntimeToolExecutionContext;
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  additionalDeferredTools?: RuntimeToolDefinition[];
  allowTool?(tool: RuntimeToolDefinition): boolean;
  revealedDeferredToolNames?: ReadonlySet<string>;
  revealDeferredTools?(names: string[]): void;
  strictApprovalRequiresSerial?: boolean;
};

const TOOL_SEARCH_NAME = 'tool_search';
const TOOL_SUGGEST_NAME = 'tool_suggest';
const RESERVED_ROUTER_TOOL_NAMES = new Set([TOOL_SEARCH_NAME, TOOL_SUGGEST_NAME]);
const TOOL_SEARCH_DEFINITION: RuntimeToolDefinition = {
  name: TOOL_SEARCH_NAME,
  description: 'Search deferred tools and tools that are already advertised. Returns matching definitions, identifies tools that can be called now, and makes deferred matches available on the next model request.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query for available or deferred tool names, descriptions, or keywords.' },
      limit: { type: 'number', description: 'Maximum number of tools to return.' },
    },
    required: ['query'],
  },
};
const TOOL_SUGGEST_DEFINITION: RuntimeToolDefinition = {
  name: TOOL_SUGGEST_NAME,
  description: 'Suggest deferred tools that might help without advertising them yet. Use tool_search afterwards to reveal a suggested tool before calling it.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query for deferred tool names, descriptions, or keywords.' },
      limit: { type: 'number', description: 'Maximum number of suggestions to return.' },
    },
    required: ['query'],
  },
};

export class RuntimeToolRouter {
  private constructor(
    private readonly options: RuntimeToolRouterOptions,
    readonly tools: RuntimeToolDefinition[],
    private readonly profiles: Map<string, ToolRuntimeProfile>,
    private readonly deferredTools: RuntimeToolDefinition[],
    private readonly routerToolNames: Set<string>,
  ) {}

  static async create(options: RuntimeToolRouterOptions): Promise<RuntimeToolRouter> {
    const context = options.context;
    const allTools = await options.toolHost.listTools(context);
    const profiles = new Map<string, ToolRuntimeProfile>();
    const visibleTools: RuntimeToolDefinition[] = [];
    const deferredTools: RuntimeToolDefinition[] = [];
    const revealedDeferredToolNames = options.revealedDeferredToolNames ?? new Set<string>();
    for (const tool of allTools) {
      if (options.allowTool && !options.allowTool(tool)) continue;
      const profile = await runtimeProfileForTool(options.toolHost, context, tool.name);
      profiles.set(tool.name, profile);
      // Router-owned tool names are reserved so external tools cannot shadow
      // discovery behavior once MCP/plugin surfaces become large and dynamic.
      if (RESERVED_ROUTER_TOOL_NAMES.has(tool.name)) continue;
      if (toolExposure(profile) === 'hidden') continue;
      if (toolExposure(profile) === 'deferred' && !revealedDeferredToolNames.has(tool.name)) {
        deferredTools.push(tool);
        continue;
      }
      visibleTools.push(tool);
    }
    const routerToolNames = new Set<string>();
    for (const tool of options.additionalDeferredTools ?? []) {
      if (options.allowTool && !options.allowTool(tool)) continue;
      if (RESERVED_ROUTER_TOOL_NAMES.has(tool.name)) continue;
      if (revealedDeferredToolNames.has(tool.name)) continue;
      if (visibleTools.some((visibleTool) => visibleTool.name === tool.name)) continue;
      if (deferredTools.some((deferredTool) => deferredTool.name === tool.name)) continue;
      deferredTools.push(tool);
    }
    if (deferredTools.length) {
      routerToolNames.add(TOOL_SEARCH_NAME);
      visibleTools.push(TOOL_SEARCH_DEFINITION);
      if (context.features?.tool_suggest === true) {
        routerToolNames.add(TOOL_SUGGEST_NAME);
        visibleTools.push(TOOL_SUGGEST_DEFINITION);
      }
    }
    return new RuntimeToolRouter(options, visibleTools, profiles, deferredTools, routerToolNames);
  }

  hasTool(name: string): boolean {
    return this.tools.some((tool) => tool.name === name);
  }

  advertisedToolNames(): string[] {
    return this.tools.map((tool) => tool.name);
  }

  deferredToolNames(): string[] {
    return this.deferredTools.map((tool) => tool.name);
  }

  routerOwnedToolNames(): string[] {
    return Array.from(this.routerToolNames);
  }

  async toolRuntimeMetadata(): Promise<RuntimeModelRequestToolRuntime[]> {
    return Promise.all(this.tools.map(async (tool) => {
      if (this.isRouterTool(tool.name)) {
        return {
          name: tool.name,
          source: 'router' as const,
          exposure: 'direct' as const,
          supportsParallel: false,
          waitsForRuntimeCancellation: true,
        };
      }
      const profile = await this.profileFor(tool.name);
      return {
        name: tool.name,
        source: 'host' as const,
        exposure: toolExposure(profile),
        supportsParallel: profile.supportsParallel === true,
        waitsForRuntimeCancellation: profile.waitsForRuntimeCancellation !== false,
      };
    }));
  }

  async systemPrompt(): Promise<string | null> {
    return this.options.toolHost.systemPrompt?.(this.options.context, { tools: this.tools }) ?? null;
  }

  async externalContext() {
    return this.options.toolHost.externalContext?.(this.options.context, { tools: this.tools }) ?? [];
  }

  async toolChoice(messages: RuntimeMessage[]): Promise<ModelRequest['toolChoice']> {
    if (!this.tools.length) return undefined;
    let forcedChoice: ModelRequest['toolChoice'] | null = null;
    try {
      forcedChoice = (await this.options.toolHost.toolChoice?.(this.options.context, { tools: this.tools, messages })) ?? null;
    } catch {
      forcedChoice = null;
    }
    return forcedChoice ?? 'auto';
  }

  async previewPartialToolCall(name: string, rawArguments: string): Promise<ToolExecutionPreview | null> {
    if (this.isRouterTool(name)) return routerPartialPreview(name, rawArguments);
    if (!this.hasTool(name)) return null;
    const preview = this.options.toolHost.previewPartialToolCall;
    if (!preview) return null;
    return preview.call(this.options.toolHost, name, rawArguments, this.options.context).catch(() => null);
  }

  async canRunInParallel(toolCall: RuntimeToolCall, parsedArguments: unknown): Promise<boolean> {
    if (!this.isRouterTool(toolCall.name) && !this.hasTool(toolCall.name)) return false;
    if (!isPlainRecord(parsedArguments)) return false;
    if (this.options.strictApprovalRequiresSerial) return false;
    if (!this.options.orchestrator) return false;
    const profile = await this.profileFor(toolCall.name);
    if (profile.supportsParallel !== true) return false;
    return this.options.orchestrator.canRunWithoutApproval(toolCall, parsedArguments, this.options.context, this.options.approvalPolicy);
  }

  async runToolCall(toolCall: RuntimeToolCall, parsedArguments: unknown, options: ToolOrchestratorRunOptions = {}): Promise<ToolOrchestratorRunResult> {
    if (this.isRouterTool(toolCall.name)) return this.runRouterTool(toolCall, parsedArguments);
    if (!this.hasTool(toolCall.name)) {
      throw new Error(`Tool ${toolCall.name} was not advertised in this sampling step.`);
    }
    if (!this.options.orchestrator) throw new Error('Tool runtime is unavailable.');
    const profile = await this.profileFor(toolCall.name);
    return this.options.orchestrator.runToolCall(toolCall, parsedArguments, this.options.context, this.options.approvalPolicy, {
      ...options,
      waitsForRuntimeCancellation: profile.waitsForRuntimeCancellation !== false,
    });
  }

  isRouterTool(name: string): boolean {
    return this.routerToolNames.has(name);
  }

  private async runRouterTool(toolCall: RuntimeToolCall, parsedArguments: unknown): Promise<ToolOrchestratorRunResult> {
    if (toolCall.name === TOOL_SUGGEST_NAME) {
      const result = suggestDeferredTools(this.deferredTools, parsedArguments);
      const content = JSON.stringify(result);
      return {
        content,
        processed: true,
        result: { content, data: result, preview: toolSuggestPreview(result) },
        status: 'success',
      };
    }
    if (toolCall.name !== TOOL_SEARCH_NAME) throw new Error(`Unknown router tool: ${toolCall.name}`);
    const advertisedTools = this.tools.filter((tool) => !this.isRouterTool(tool.name));
    const result = searchTools(advertisedTools, this.deferredTools, parsedArguments);
    this.options.revealDeferredTools?.(result.revealedToolNames);
    const content = JSON.stringify(result);
    return {
      content,
      processed: true,
      result: { content, data: result, preview: toolSearchPreview(result) },
      status: 'success',
    };
  }

  private async profileFor(name: string): Promise<ToolRuntimeProfile> {
    const existing = this.profiles.get(name);
    if (existing) return existing;
    const profile = await runtimeProfileForTool(this.options.toolHost, this.options.context, name);
    this.profiles.set(name, profile);
    return profile;
  }
}

function routerPartialPreview(name: string, rawArguments: string): ToolExecutionPreview {
  const parsed = tryParseJsonObject(rawArguments);
  const query = typeof parsed?.query === 'string' ? parsed.query.trim() : '';
  const limit = typeof parsed?.limit === 'number' && Number.isFinite(parsed.limit) ? parsed.limit : undefined;
  const argumentsPreview = JSON.stringify({
    ...(query ? { query } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  if (name === TOOL_SUGGEST_NAME) {
    return {
      argumentsPreview,
      resultPreview: query ? `Suggest deferred tools matching "${query}".` : 'Suggest deferred tools.',
    };
  }
  return {
    argumentsPreview,
    resultPreview: query ? `Reveal deferred tools matching "${query}".` : 'Reveal matching deferred tools.',
  };
}

async function runtimeProfileForTool(toolHost: ToolHost, context: RuntimeToolExecutionContext, name: string): Promise<ToolRuntimeProfile> {
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

function toolExposure(profile: ToolRuntimeProfile): 'direct' | 'deferred' | 'hidden' {
  if (profile.exposure) return profile.exposure;
  return profile.visibleToModel === false ? 'hidden' : 'direct';
}

function searchTools(
  advertisedTools: RuntimeToolDefinition[],
  deferredTools: RuntimeToolDefinition[],
  parsedArguments: unknown,
): {
  availableToolNames: string[];
  query: string;
  revealedToolNames: string[];
  tools: RuntimeToolDefinition[];
} {
  const scored = rankedTools([...advertisedTools, ...deferredTools], parsedArguments);
  const advertisedNames = new Set(advertisedTools.map((tool) => tool.name));
  const deferredNames = new Set(deferredTools.map((tool) => tool.name));
  return {
    availableToolNames: scored.tools.filter((tool) => advertisedNames.has(tool.name)).map((tool) => tool.name),
    query: scored.query,
    tools: scored.tools,
    revealedToolNames: scored.tools.filter((tool) => deferredNames.has(tool.name)).map((tool) => tool.name),
  };
}

function suggestDeferredTools(tools: RuntimeToolDefinition[], parsedArguments: unknown): { query: string; suggestions: Array<{ name: string; description: string; revealWith: 'tool_search' }> } {
  const scored = rankedTools(tools, parsedArguments);
  return {
    query: scored.query,
    suggestions: scored.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      revealWith: TOOL_SEARCH_NAME,
    })),
  };
}

function rankedTools(tools: RuntimeToolDefinition[], parsedArguments: unknown): { query: string; tools: RuntimeToolDefinition[] } {
  const input = isPlainRecord(parsedArguments) ? parsedArguments : {};
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const limitInput = typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : 8;
  const limit = Math.max(1, Math.min(20, Math.floor(limitInput)));
  const terms = searchTerms(query);
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  const scored = tools
    .map((tool, index) => ({ index, score: deferredToolMatchScore(tool, terms, normalizedQuery, compactQuery), tool }))
    .filter((item) => !terms.length || item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.tool);
  return {
    query,
    tools: scored,
  };
}

function deferredToolMatchScore(tool: RuntimeToolDefinition, terms: string[], normalizedQuery: string, compactQuery: string): number {
  if (!terms.length) return 1;
  const normalizedName = normalizeSearchText(tool.name);
  const compactName = compactSearchText(tool.name);
  const nameTerms = new Set(searchTerms(tool.name));
  const description = normalizeSearchText(tool.description);
  const schema = normalizeSearchText(JSON.stringify(tool.inputSchema));
  let score = 0;
  if (normalizedQuery && normalizedName === normalizedQuery) score += 10_000;
  if (compactQuery && compactName === compactQuery) score += 8_000;
  for (const term of terms) {
    const compactTerm = compactSearchText(term);
    if (term === normalizedName) score += 5_000;
    else if (compactTerm && compactTerm === compactName) score += 4_000;
    else if (nameTerms.has(term)) score += 300;
    else if (normalizedName.includes(term)) score += 150;
    if (description.includes(term)) score += 20;
    if (schema.includes(term)) score += 4;
  }
  return score;
}

function toolSearchPreview(result: { availableToolNames: string[]; revealedToolNames: string[]; tools: RuntimeToolDefinition[] }): string {
  if (!result.tools.length) return 'No tools matched.';
  const parts: string[] = [];
  if (result.availableToolNames.length) {
    parts.push(`Available ${result.availableToolNames.length} tool(s): ${result.availableToolNames.join(', ')}`);
  }
  if (result.revealedToolNames.length) {
    parts.push(`Revealed ${result.revealedToolNames.length} deferred tool(s): ${result.revealedToolNames.join(', ')}`);
  }
  return parts.join('; ');
}

function toolSuggestPreview(result: { suggestions: Array<{ name: string }> }): string {
  if (!result.suggestions.length) return 'No deferred tool suggestions matched.';
  return `Suggested ${result.suggestions.length} deferred tool(s): ${result.suggestions.map((tool) => tool.name).join(', ')}`;
}

function searchTerms(value: string): string[] {
  return normalizeSearchText(value).split(/[^a-z0-9_:-]+/).filter(Boolean);
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().trim();
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, '');
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
