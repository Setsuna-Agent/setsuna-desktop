import type {
  RuntimeMcpResource,
  RuntimeMcpResourceTemplate,
  RuntimeMcpServerInput,
  RuntimeMcpToolInfo,
  RuntimeMcpToolList,
} from '@setsuna-desktop/contracts';
import type {
  McpAuthStatusResult,
  McpLoginOptions,
  McpOperationContext,
  McpOperationOptions,
  McpResourceReadResponse,
  McpServerRuntimeSnapshot,
  McpSnapshotOptions,
  McpToolCallResponse,
} from '../../../contracts/control.js';
import { threadScopeId, SdkMcpConnectionManager } from './sdk-mcp-connection-manager.js';
import type { McpProtocolService } from '../../mcp-control-service.js';

/**
 * 把 SDK 连接管理器适配为 `McpProtocolService`。
 *
 * `SdkMcpConnectionManager` 接受 `McpConnectionContext`（含 scopeId），
 * 而控制面暴露 `McpOperationContext`（无 scopeId）。本适配器负责在内部生成
 * thread/discovery/status scope，避免 scope 泄漏到外部契约。
 */
export class SdkMcpProtocolAdapter implements McpProtocolService {
  constructor(private readonly manager: SdkMcpConnectionManager) {}

  discoverTools(server: RuntimeMcpServerInput, options?: McpOperationOptions): Promise<RuntimeMcpToolList> {
    return this.manager.discoverTools(server, {
      scopeId: `discovery:${server.key}`,
      ...(options?.signal ? { signal: options.signal } : {}),
    });
  }

  listTools(server: RuntimeMcpServerInput, context: McpOperationContext): Promise<RuntimeMcpToolInfo[]> {
    return this.manager.listTools(server, toConnectionContext(context, 'runtime:mcp-tools'));
  }

  listResources(server: RuntimeMcpServerInput, context: McpOperationContext): Promise<RuntimeMcpResource[]> {
    return this.manager.listResources(server, toConnectionContext(context, 'runtime:mcp-resources'));
  }

  listResourceTemplates(server: RuntimeMcpServerInput, context: McpOperationContext): Promise<RuntimeMcpResourceTemplate[]> {
    return this.manager.listResourceTemplates(server, toConnectionContext(context, 'runtime:mcp-resources'));
  }

  readResource(server: RuntimeMcpServerInput, uri: string, context: McpOperationContext): Promise<McpResourceReadResponse> {
    return this.manager.readResource(server, uri, toConnectionContext(context, 'runtime:mcp-resources'));
  }

  callTool(server: RuntimeMcpServerInput, toolName: string, input: unknown, context: McpOperationContext): Promise<McpToolCallResponse> {
    return this.manager.callTool(server, toolName, input, toConnectionContext(context, 'runtime:mcp-tools'));
  }

  snapshot(server: RuntimeMcpServerInput, context: McpOperationContext, options?: McpSnapshotOptions): Promise<McpServerRuntimeSnapshot> {
    return this.manager.snapshot(server, toConnectionContext(context, 'runtime:mcp-status'), options);
  }

  login(server: RuntimeMcpServerInput, options?: McpLoginOptions): Promise<void> {
    return this.manager.login(server, options);
  }

  logout(server: RuntimeMcpServerInput): Promise<void> {
    return this.manager.logout(server);
  }

  authStatus(server: RuntimeMcpServerInput): Promise<McpAuthStatusResult> {
    return this.manager.authStatus(server);
  }

  invalidateServer(serverKey: string): Promise<void> {
    return this.manager.invalidateServer(serverKey);
  }

  releaseThread(threadId: string): Promise<void> {
    return this.manager.releaseThread(threadId);
  }
}

function toConnectionContext(context: McpOperationContext, fallbackScopeId: string) {
  const threadId = context.threadId;
  const scopeId = threadId ? threadScopeId(threadId) : fallbackScopeId;
  return {
    scopeId,
    ...(threadId ? { threadId } : {}),
    ...(context.turnId ? { turnId: context.turnId } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
    ...(context.toolName ? { toolName: context.toolName } : {}),
    ...(context.signal ? { signal: context.signal } : {}),
    ...(context.onProgress ? { onProgress: context.onProgress } : {}),
  };
}
