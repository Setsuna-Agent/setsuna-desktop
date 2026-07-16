import type { RuntimeMessage, RuntimeToolChoice, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { ToolExecutionContext, ToolExecutionResult, ToolExternalContext, ToolHost, ToolTurnCleanupOutcome } from '../../ports/tool-host.js';

export class CompositeToolHost implements ToolHost {
  private readonly toolNamesByContext = new WeakMap<ToolExecutionContext, Map<ToolHost, Set<string>>>();

  constructor(private readonly hosts: ToolHost[]) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    const toolGroups = await Promise.all(this.hosts.map((host) => host.listTools(context)));
    this.toolNamesByContext.set(context, new Map(this.hosts.map((host, index) => [
      host,
      new Set((toolGroups[index] ?? []).map((tool) => tool.name)),
    ])));
    return toolGroups.flat();
  }

  async environmentForToolContext(context: ToolExecutionContext) {
    for (const host of this.hosts) {
      const environment = await host.environmentForToolContext?.(context);
      if (environment) return environment;
    }
    return null;
  }

  async systemPrompt(context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): Promise<string | null> {
    const advertisedNames = request ? new Set(request.tools.map((tool) => tool.name)) : null;
    const ownedToolNames = advertisedNames ? await this.ownershipFor(context) : null;
    const prompts = await Promise.all(this.hosts.map(async (host) => {
      if (advertisedNames) {
        const hostToolNames = ownedToolNames?.get(host);
        if (!hostToolNames || !setsOverlap(hostToolNames, advertisedNames)) return '';
      }
      const prompt = await host.systemPrompt?.(context, request);
      return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : '';
    }));
    return prompts.filter(Boolean).join('\n\n') || null;
  }

  async externalContext(context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): Promise<ToolExternalContext[]> {
    const advertisedNames = request ? new Set(request.tools.map((tool) => tool.name)) : null;
    const ownedToolNames = advertisedNames ? await this.ownershipFor(context) : null;
    const contexts = await Promise.all(this.hosts.map(async (host) => {
      if (advertisedNames) {
        const hostToolNames = ownedToolNames?.get(host);
        if (!hostToolNames || !setsOverlap(hostToolNames, advertisedNames)) return [];
      }
      return await host.externalContext?.(context, request) ?? [];
    }));
    return contexts.flat();
  }

  async toolChoice(context: ToolExecutionContext, request: { tools: RuntimeToolDefinition[]; messages: RuntimeMessage[] }): Promise<RuntimeToolChoice | null> {
    const advertisedNames = new Set(request.tools.map((tool) => tool.name));
    const ownedToolNames = await this.ownershipFor(context);
    for (const host of this.hosts) {
      const hostToolNames = ownedToolNames.get(host);
      if (!hostToolNames || !setsOverlap(hostToolNames, advertisedNames)) continue;
      const choice = await host.toolChoice?.(context, request);
      if (choice) return choice;
    }
    return null;
  }

  async toolRuntimeProfile(name: string, context: ToolExecutionContext) {
    const host = await this.hostFor(name, context);
    return host?.toolRuntimeProfile?.(name, context) ?? null;
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const host = await this.hostFor(name, context);
    if (host) return host.runTool(name, input, context);
    throw new Error(`Unknown tool: ${name}`);
  }

  async approvalForTool(name: string, input: unknown, context: ToolExecutionContext) {
    const host = await this.hostFor(name, context);
    return host?.approvalForTool?.(name, input, context) ?? null;
  }

  async previewToolCall(name: string, input: unknown, context: ToolExecutionContext) {
    const host = await this.hostFor(name, context);
    return host?.previewToolCall?.(name, input, context) ?? null;
  }

  async previewPartialToolCall(name: string, rawArguments: string, context: ToolExecutionContext) {
    const host = await this.hostFor(name, context);
    return host?.previewPartialToolCall?.(name, rawArguments, context) ?? null;
  }

  async cleanupTurn(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome): Promise<void> {
    await Promise.all(this.hosts.map((host) => host.cleanupTurn?.(context, outcome)));
  }

  private async hostFor(name: string, context: ToolExecutionContext): Promise<ToolHost | null> {
    const ownership = await this.ownershipFor(context);
    return this.hosts.find((host) => ownership.get(host)?.has(name)) ?? null;
  }

  private async ownershipFor(context: ToolExecutionContext): Promise<Map<ToolHost, Set<string>>> {
    if (!this.toolNamesByContext.has(context)) await this.listTools(context);
    return this.toolNamesByContext.get(context) ?? new Map();
  }
}

function setsOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}
