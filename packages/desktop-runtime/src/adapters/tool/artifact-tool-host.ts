import type {
  ArtifactRuntimeToolService,
  ArtifactToolExecutionContext,
} from '@setsuna-desktop/feature-artifact/contracts';
import type { ToolExecutionContext, ToolExecutionResult, ToolHost } from '../../ports/tool-host.js';

/** Adapts the generic runtime ToolHost port to the Artifact-owned tool service. */
export class ArtifactToolHost implements ToolHost {
  private service: ArtifactRuntimeToolService | null = null;

  bind(service: ArtifactRuntimeToolService): () => void {
    if (this.service && this.service !== service) {
      throw new Error('Artifact tool service is already bound.');
    }
    this.service = service;
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.service === service) this.service = null;
    };
  }

  listTools(context: ToolExecutionContext) {
    return this.service?.listTools(artifactContext(context)) ?? Promise.resolve([]);
  }

  toolRuntimeProfile(name: string) {
    return this.service?.toolRuntimeProfile(name) ?? null;
  }

  systemPrompt(context: ToolExecutionContext, request?: Parameters<NonNullable<ToolHost['systemPrompt']>>[1]) {
    return this.service?.systemPrompt(artifactContext(context), request) ?? null;
  }

  async runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (!this.service) throw new Error(`Unknown tool: ${name}`);
    return { ...await this.service.runTool(name, input, artifactContext(context)) };
  }
}

function artifactContext(context: ToolExecutionContext): ArtifactToolExecutionContext {
  return Object.freeze({
    threadId: context.threadId,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.environment ? { environment: context.environment } : {}),
  });
}
