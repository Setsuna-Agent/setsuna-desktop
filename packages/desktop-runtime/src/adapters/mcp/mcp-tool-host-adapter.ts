import type { RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type {
  McpToolExecutionResult,
  McpToolRunContext,
  McpToolRuntimeProfile,
  McpRuntimeToolService,
} from '@setsuna-desktop/feature-mcp/contracts';
import type {
  ToolApprovalRequirement,
  ToolExecutionContext,
  ToolExecutionPreview,
  ToolExecutionResult,
  ToolExternalContext,
  ToolHost,
  ToolRuntimeProfile,
} from '../../ports/tool-host.js';
import { capabilityNotAvailableError } from './mcp-capability-not-available.js';

/**
 * 把 desktop-runtime 的 `ToolHost` 桥接到 feature 的 `McpRuntimeToolService`。
 *
 * 本 adapter 只做类型转换和 bind/unbind，不含 MCP 工具定义、审批判断、preview
 * 或执行逻辑。未绑定时 `listTools()` 返回空数组、prompt/context 返回空、
 * `runTool()` 抛出 capability unavailable。
 */
export class McpToolHostAdapter implements ToolHost {
  private delegate: McpRuntimeToolService | null = null;
  private readonly contexts = new WeakMap<ToolExecutionContext, McpToolRunContext>();

  bind(delegate: McpRuntimeToolService): () => void {
    if (this.delegate) throw new Error('MCP runtime tools are already bound.');
    this.delegate = delegate;
    return () => {
      if (this.delegate === delegate) this.delegate = null;
    };
  }

  async listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]> {
    if (!this.delegate) return [];
    return this.delegate.listTools(this.contextFor(context));
  }

  systemPrompt(context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): string | null {
    if (!this.delegate) return null;
    return this.delegate.systemPrompt(this.contextFor(context), request);
  }

  externalContext(context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): Promise<ToolExternalContext[]> {
    if (!this.delegate) return Promise.resolve([]);
    return this.delegate.externalContext(this.contextFor(context), request);
  }

  toolRuntimeProfile(name: string, context: ToolExecutionContext): ToolRuntimeProfile | null {
    if (!this.delegate) return null;
    const profile = this.delegate.toolRuntimeProfile(name, this.contextFor(context));
    return profile ? toHostProfile(profile) : null;
  }

  approvalForTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolApprovalRequirement | null> {
    if (!this.delegate) return Promise.resolve(null);
    return this.delegate.approvalForTool(name, input, this.contextFor(context));
  }

  previewToolCall(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionPreview | null> {
    if (!this.delegate) return Promise.resolve(null);
    return this.delegate.previewToolCall(name, input, this.contextFor(context));
  }

  runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    if (!this.delegate) return Promise.reject(capabilityNotAvailableError());
    return this.delegate.runTool(name, input, this.contextFor(context)).then(toHostExecutionResult);
  }

  private contextFor(context: ToolExecutionContext): McpToolRunContext {
    let converted = this.contexts.get(context);
    if (!converted) {
      converted = toMcpRunContext(context);
      this.contexts.set(context, converted);
    }
    return converted;
  }
}

function toMcpRunContext(context: ToolExecutionContext): McpToolRunContext {
  return {
    threadId: context.threadId,
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.modelCapabilities ? { modelCapabilities: context.modelCapabilities } : {}),
    ...(context.onToolOutputDelta
      ? {
          onProgress: (progress: { progress: number; total?: number; message?: string }) => {
            const total = progress.total !== undefined ? `/${progress.total}` : '';
            context.onToolOutputDelta?.({
              delta: `${progress.message ? `${progress.message} ` : ''}${progress.progress}${total}\n`,
            });
          },
        }
      : {}),
  };
}

function toHostProfile(profile: McpToolRuntimeProfile): ToolRuntimeProfile {
  return {
    ...(profile.exposure ? { exposure: profile.exposure } : {}),
    ...(profile.modelOutputTokenLimit !== undefined ? { modelOutputTokenLimit: profile.modelOutputTokenLimit } : {}),
    ...(profile.searchAliases ? { searchAliases: profile.searchAliases } : {}),
    ...(profile.supportsParallel !== undefined ? { supportsParallel: profile.supportsParallel } : {}),
    ...(profile.waitsForRuntimeCancellation !== undefined ? { waitsForRuntimeCancellation: profile.waitsForRuntimeCancellation } : {}),
    ...(profile.visibleToModel !== undefined ? { visibleToModel: profile.visibleToModel } : {}),
    ...(profile.approvalMode ? { approvalMode: profile.approvalMode } : {}),
    ...(profile.requiresSandboxBypassApproval !== undefined ? { requiresSandboxBypassApproval: profile.requiresSandboxBypassApproval } : {}),
  };
}

function toHostExecutionResult(result: McpToolExecutionResult): ToolExecutionResult {
  return {
    content: result.content,
    ...(result.attachments?.length ? { attachments: result.attachments } : {}),
    ...(result.preview ? { preview: result.preview } : {}),
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.containsExternalContext !== undefined ? { containsExternalContext: result.containsExternalContext } : {}),
  };
}
