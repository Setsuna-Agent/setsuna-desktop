import { ATTACH_PULL_REQUEST_TOOL, type PullRequestToolService } from '@setsuna-desktop/feature-pull-requests/contracts';
import type { ToolExecutionContext, ToolHost } from '../../ports/tool-host.js';

export class PullRequestToolHost implements ToolHost {
  private service: PullRequestToolService | null = null;
  bind(service: PullRequestToolService): () => void {
    this.service = service;
    return () => { if (this.service === service) this.service = null; };
  }
  async listTools(context: ToolExecutionContext) { return this.service?.listTools(context) ?? []; }
  systemPrompt(context: ToolExecutionContext, request?: Parameters<NonNullable<ToolHost['systemPrompt']>>[1]) {
    if (request && !request.tools.some((tool) => tool.name === ATTACH_PULL_REQUEST_TOOL)) return null;
    return this.service?.systemPrompt(context) ?? null;
  }
  toolRuntimeProfile(name: string) {
    return name === ATTACH_PULL_REQUEST_TOOL ? { supportsParallel: true, approvalMode: 'selfManaged' as const } : null;
  }
  async runTool(name: string, input: unknown, context: ToolExecutionContext) {
    if (name !== ATTACH_PULL_REQUEST_TOOL || !this.service || context.readOnly) throw new Error('Pull request attachment tool is unavailable.');
    return this.service.attach(input);
  }
}
