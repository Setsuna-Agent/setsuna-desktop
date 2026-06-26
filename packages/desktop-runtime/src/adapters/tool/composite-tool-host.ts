import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';

export class CompositeToolHost implements ToolHost {
  constructor(private readonly hosts: ToolHost[]) {}

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    const toolGroups = await Promise.all(this.hosts.map((host) => host.listTools(context)));
    return toolGroups.flat();
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

  private async hostFor(name: string, context: ToolExecutionContext): Promise<ToolHost | null> {
    for (const host of this.hosts) {
      const tools = await host.listTools(context);
      if (tools.some((tool) => tool.name === name)) return host;
    }
    return null;
  }
}
