import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { BrowserRuntimeToolService } from '@setsuna-desktop/feature-browser/contracts';
import type {
  ToolApprovalRequirement,
  ToolExecutionContext,
  ToolExecutionPreview,
  ToolExecutionResult,
  ToolHost,
  ToolRuntimeProfile,
} from '../../ports/tool-host.js';

/** Adapts the generic runtime ToolHost port to the Browser-owned tool service. */
export class BrowserToolHost implements ToolHost {
  private service: BrowserRuntimeToolService | null = null;

  bind(service: BrowserRuntimeToolService): () => void {
    if (this.service && this.service !== service) {
      throw new Error('Browser tool service is already bound.');
    }
    this.service = service;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.service === service) this.service = null;
    };
  }

  listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    return this.service?.listTools(context) ?? Promise.resolve([]);
  }

  toolRuntimeProfile(name: string): ToolRuntimeProfile | null {
    return this.service?.toolRuntimeProfile(name) ?? null;
  }

  systemPrompt(
    context: ToolExecutionContext,
    request?: { tools: RuntimeToolDefinition[] },
  ): string | null {
    return this.service?.systemPrompt(context, request) ?? null;
  }

  async approvalForTool(
    name: string,
    input: unknown,
  ): Promise<ToolApprovalRequirement | null> {
    return this.service?.approvalForTool(name, input) ?? null;
  }

  async previewToolCall(
    name: string,
    input: unknown,
  ): Promise<ToolExecutionPreview | null> {
    return this.service?.previewToolCall(name, input) ?? null;
  }

  async runTool(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (!this.service) throw new Error(`Unknown tool: ${name}`);
    const result = await this.service.runTool(name, input, context);
    return { ...result };
  }
}
