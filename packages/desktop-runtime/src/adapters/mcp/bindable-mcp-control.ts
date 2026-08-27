import type {
  McpAuthStatusResult,
  McpControl,
  McpLoginOptions,
  McpOperationContext,
  McpOperationOptions,
  McpResourceReadResponse,
  McpServerRuntimeSnapshot,
  McpSnapshotOptions,
  McpToolCallResponse,
} from '@setsuna-desktop/feature-mcp/contracts';
import type {
  RuntimeMcpResource,
  RuntimeMcpResourceTemplate,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
  RuntimeMcpToolInfo,
  RuntimeMcpToolList,
} from '@setsuna-desktop/contracts';
import { capabilityNotAvailableError } from './mcp-capability-not-available.js';

/**
 * 在 feature 激活前持有 MCP 控制面的稳定端口。
 *
 * runtime factory 先创建它，其它宿主模块只依赖该对象。feature 激活后由
 * composition root 绑定具体的 `McpControl`。未绑定时：
 * - `releaseThread()`：安全 no-op（兼容 feature 激活前的旧 side-conversation 清理）；
 * - `invalidateServer()`：在启动恢复阶段允许 no-op；
 * - 其余配置/登录/查询/调用操作：抛出明确的 capability unavailable 错误。
 */
export class BindableMcpControl implements McpControl {
  private delegate: McpControl | null = null;

  bind(delegate: McpControl): () => void {
    if (this.delegate) throw new Error('MCP control is already bound.');
    this.delegate = delegate;
    return () => {
      if (this.delegate === delegate) this.delegate = null;
    };
  }

  async listServers(options?: { includeAuthStatus?: boolean }): Promise<RuntimeMcpServerList> {
    return this.requireDelegate().listServers(options);
  }

  discoverTools(input: RuntimeMcpServerInput, options?: McpOperationOptions): Promise<RuntimeMcpToolList> {
    return this.requireDelegate().discoverTools(input, options);
  }

  async upsertServer(input: RuntimeMcpServerInput): Promise<RuntimeMcpServerList> {
    return this.requireDelegate().upsertServer(input);
  }

  async updateServer(key: string, patch: RuntimeMcpServerPatch): Promise<RuntimeMcpServerList> {
    return this.requireDelegate().updateServer(key, patch);
  }

  async deleteServer(key: string): Promise<void> {
    return this.requireDelegate().deleteServer(key);
  }

  async reloadServers(): Promise<void> {
    return this.requireDelegate().reloadServers();
  }

  login(serverKey: string, options?: McpLoginOptions): Promise<void> {
    return this.requireDelegate().login(serverKey, options);
  }

  logout(serverKey: string): Promise<void> {
    return this.requireDelegate().logout(serverKey);
  }

  authStatus(serverKey: string): Promise<McpAuthStatusResult> {
    return this.requireDelegate().authStatus(serverKey);
  }

  listTools(serverKey: string, context: McpOperationContext): Promise<RuntimeMcpToolInfo[]> {
    return this.requireDelegate().listTools(serverKey, context);
  }

  listResources(serverKey: string, context: McpOperationContext): Promise<RuntimeMcpResource[]> {
    return this.requireDelegate().listResources(serverKey, context);
  }

  listResourceTemplates(serverKey: string, context: McpOperationContext): Promise<RuntimeMcpResourceTemplate[]> {
    return this.requireDelegate().listResourceTemplates(serverKey, context);
  }

  readResource(serverKey: string, uri: string, context: McpOperationContext): Promise<McpResourceReadResponse> {
    return this.requireDelegate().readResource(serverKey, uri, context);
  }

  callTool(serverKey: string, toolName: string, input: unknown, context: McpOperationContext): Promise<McpToolCallResponse> {
    return this.requireDelegate().callTool(serverKey, toolName, input, context);
  }

  snapshot(serverKey: string, context: McpOperationContext, options?: McpSnapshotOptions): Promise<McpServerRuntimeSnapshot> {
    return this.requireDelegate().snapshot(serverKey, context, options);
  }

  async invalidateServer(serverKey: string): Promise<void> {
    if (!this.delegate) return;
    return this.delegate.invalidateServer(serverKey);
  }

  async releaseThread(threadId: string): Promise<void> {
    if (!this.delegate) return;
    return this.delegate.releaseThread(threadId);
  }

  private requireDelegate(): McpControl {
    if (!this.delegate) throw capabilityNotAvailableError();
    return this.delegate;
  }
}
