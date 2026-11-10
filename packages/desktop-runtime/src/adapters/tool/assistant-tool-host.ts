import type { AssistantsToolService } from '@setsuna-desktop/feature-assistants/contracts';
import type { ToolExecutionContext, ToolHost } from '../../ports/tool-host.js';

/**
 * Exposes assistant orchestration tools only inside assistant conversations, and confines those
 * conversations to them: file, shell and other host tools stay in the project conversations.
 */
export class AssistantToolHost implements ToolHost {
  private service: AssistantsToolService | null = null;
  private toolNames: ReadonlySet<string> = new Set();

  bind(service: AssistantsToolService): () => void {
    this.service = service;
    this.toolNames = new Set(service.listTools().map((tool) => tool.name));
    return () => {
      if (this.service !== service) return;
      this.service = null;
      this.toolNames = new Set();
    };
  }

  pendingMutationCount(): number { return this.service?.pendingMutationCount() ?? 0; }
  setMaintenancePaused(paused: boolean): void { this.service?.setMaintenancePaused(paused); }

  exclusiveToolScope(context: ToolExecutionContext): ReadonlySet<string> | null {
    // Fail closed before optional activation and after unload: ownership outlives the service.
    return context.featureId === 'assistants' || this.service?.isAssistantThread(context.threadId) ? this.toolNames : null;
  }

  async listTools(context: ToolExecutionContext) {
    return this.available(context) ? this.service!.listTools(context.interfaceLanguage) : [];
  }

  toolRuntimeProfile(name: string) {
    return this.toolNames.has(name) ? { supportsParallel: false, approvalMode: 'selfManaged' as const } : null;
  }

  systemPrompt(context: ToolExecutionContext) {
    return this.available(context) ? this.service!.systemPrompt(context.threadId, context.interfaceLanguage) : null;
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    if (!this.toolNames.has(name) || !this.available(context)) throw new Error('Assistant tools are unavailable in this conversation.');
    return this.service!.runTool(name, input, {
      threadId: context.threadId,
      ...(context.turnId ? { turnId: context.turnId } : {}),
      ...(context.interfaceLanguage ? { interfaceLanguage: context.interfaceLanguage } : {}),
    });
  }

  private available(context: ToolExecutionContext): boolean {
    return Boolean(this.service?.isAssistantThread(context.threadId)) && !context.readOnly && !context.unattended;
  }
}
