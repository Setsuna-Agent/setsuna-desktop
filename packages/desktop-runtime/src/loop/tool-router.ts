import type {
  ModelRequest,
  RuntimeConfigState,
  RuntimeMessage,
  RuntimeModelRequestToolRuntime,
  RuntimeToolCall,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type {
  RuntimeToolExecutionContext,
  ToolExecutionPreview,
  ToolHost,
  ToolRuntimeProfile,
} from '../ports/tool-host.js';
import type {
  ToolOrchestrator,
  ToolOrchestratorRunOptions,
  ToolOrchestratorRunResult,
} from './tool-orchestrator.js';

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

export type RuntimeToolRouterOptions = {
  toolHost: ToolHost;
  orchestrator: ToolOrchestrator | null;
  context: RuntimeToolExecutionContext;
  approvalPolicy: RuntimeConfigState['approvalPolicy'];
  allowTool?(tool: RuntimeToolDefinition): boolean;
  strictApprovalRequiresSerial?: boolean;
};

export class RuntimeToolRouter {
  private constructor(
    private readonly options: RuntimeToolRouterOptions,
    readonly tools: RuntimeToolDefinition[],
    private readonly profiles: Map<string, ToolRuntimeProfile>,
  ) {}

  static async create(options: RuntimeToolRouterOptions): Promise<RuntimeToolRouter> {
    const allTools = await options.toolHost.listTools(options.context);
    const profiles = new Map<string, ToolRuntimeProfile>();
    const visibleTools: RuntimeToolDefinition[] = [];

    for (const tool of allTools) {
      if (options.allowTool && !options.allowTool(tool)) continue;
      const profile = await runtimeProfileForTool(options.toolHost, options.context, tool.name);
      profiles.set(tool.name, profile);
      if (toolIsHidden(profile)) continue;
      visibleTools.push(tool);
    }

    return new RuntimeToolRouter(options, visibleTools, profiles);
  }

  hasTool(name: string): boolean {
    return this.tools.some((tool) => tool.name === name);
  }

  advertisedToolNames(): string[] {
    return this.tools.map((tool) => tool.name);
  }

  async toolRuntimeMetadata(): Promise<RuntimeModelRequestToolRuntime[]> {
    return Promise.all(this.tools.map(async (tool) => {
      const profile = await this.profileFor(tool.name);
      return {
        name: tool.name,
        source: 'host' as const,
        exposure: 'direct' as const,
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
        waitsForRuntimeCancellation: profile.waitsForRuntimeCancellation !== false,
      },
    );
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
