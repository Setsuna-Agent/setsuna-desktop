import type { NotificationToolService } from '@setsuna-desktop/feature-notifications/contracts';
import type { ToolExecutionContext, ToolHost } from '../../ports/tool-host.js';

export class NotificationToolHost implements ToolHost {
  private service: NotificationToolService | null = null;
  bind(service: NotificationToolService): () => void {
    this.service = service;
    return () => { if (this.service === service) this.service = null; };
  }
  async listTools(context: ToolExecutionContext) {
    return context.readOnly ? [] : this.service?.listTools() ?? [];
  }
  toolRuntimeProfile(name: string) {
    return name === 'send_notification' ? { supportsParallel: false, approvalMode: 'selfManaged' as const } : null;
  }
  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    if (name !== 'send_notification' || !this.service || context.readOnly) throw new Error('Notification tool is unavailable.');
    return this.service.send(input, context);
  }
}
