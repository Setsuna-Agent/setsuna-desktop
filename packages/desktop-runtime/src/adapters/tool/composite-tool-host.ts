import type { RuntimeMessage, RuntimeToolChoice, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost, ToolTurnCleanupOutcome } from '../../ports/tool-host.js';

export class CompositeToolHost implements ToolHost {
  constructor(private readonly hosts: ToolHost[]) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    const toolGroups = await Promise.all(this.hosts.map((host) => host.listTools(context)));
    return toolGroups.flat();
  }

  async environmentForToolContext(context: ToolExecutionContext) {
    for (const host of this.hosts) {
      const environment = await host.environmentForToolContext?.(context);
      if (environment) return environment;
    }
    return null;
  }

  async systemPrompt(context: ToolExecutionContext): Promise<string | null> {
    const prompts = await Promise.all(this.hosts.map(async (host) => {
      const prompt = await host.systemPrompt?.(context);
      return typeof prompt === 'string' && prompt.trim() ? prompt.trim() : '';
    }));
    return prompts.filter(Boolean).join('\n\n') || null;
  }

  async toolChoice(context: ToolExecutionContext, request: { tools: RuntimeToolDefinition[]; messages: RuntimeMessage[] }): Promise<RuntimeToolChoice | null> {
    for (const host of this.hosts) {
      const choice = await host.toolChoice?.(context, request);
      if (choice) return choice;
    }
    return null;
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
    for (const host of this.hosts) {
      const tools = await host.listTools(context);
      if (tools.some((tool) => tool.name === name)) return host;
    }
    return null;
  }
}
