import type { AutomationToolService } from '@setsuna-desktop/feature-automation/contracts';
import type { ToolExecutionContext, ToolHost } from '../../ports/tool-host.js';

export class AutomationToolHost implements ToolHost {
  private service: AutomationToolService | null = null;
  bind(service: AutomationToolService): () => void {
    this.service = service;
    return () => { if (this.service === service) this.service = null; };
  }
  pendingMutationCount(): number { return this.service?.pendingMutationCount() ?? 0; }
  setMaintenancePaused(paused: boolean): void { this.service?.setMaintenancePaused(paused); }
  async listTools(context: ToolExecutionContext) {
    return context.readOnly || context.unattended ? [] : this.service?.listTools() ?? [];
  }
  toolRuntimeProfile(name: string) {
    return name === 'manage_automation' ? { supportsParallel: false, approvalMode: 'selfManaged' as const } : null;
  }
  systemPrompt(context: ToolExecutionContext) {
    return context.readOnly || context.unattended ? null : this.service?.systemPrompt() ?? null;
  }
  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    if (name !== 'manage_automation' || !this.service || context.readOnly || context.unattended) throw new Error('Automation management is unavailable in this turn.');
    return this.service.runTool(input, context.threadId);
  }
}
