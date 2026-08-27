import {
  mergeRuntimeMcpServerInput,
  type RuntimeMcpResource,
  type RuntimeMcpResourceTemplate,
  type RuntimeMcpServerInput,
  type RuntimeMcpServerList,
  type RuntimeMcpServerPatch,
  type RuntimeMcpToolInfo,
  type RuntimeMcpToolList,
} from '@setsuna-desktop/contracts';
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
} from '../contracts/control.js';
import type { McpStore } from '../contracts/store.js';

/** SDK manager 提供的仅协议操作面；配置事务由 McpControlService 收口。 */
export type McpProtocolService = {
  discoverTools(server: RuntimeMcpServerInput, options?: McpOperationOptions): Promise<RuntimeMcpToolList>;
  listTools(server: RuntimeMcpServerInput, context: McpOperationContext): Promise<RuntimeMcpToolInfo[]>;
  listResources(server: RuntimeMcpServerInput, context: McpOperationContext): Promise<RuntimeMcpResource[]>;
  listResourceTemplates(server: RuntimeMcpServerInput, context: McpOperationContext): Promise<RuntimeMcpResourceTemplate[]>;
  readResource(server: RuntimeMcpServerInput, uri: string, context: McpOperationContext): Promise<McpResourceReadResponse>;
  callTool(server: RuntimeMcpServerInput, toolName: string, input: unknown, context: McpOperationContext): Promise<McpToolCallResponse>;
  snapshot(server: RuntimeMcpServerInput, context: McpOperationContext, options?: McpSnapshotOptions): Promise<McpServerRuntimeSnapshot>;
  login(server: RuntimeMcpServerInput, options?: McpLoginOptions): Promise<void>;
  logout(server: RuntimeMcpServerInput): Promise<void>;
  authStatus(server: RuntimeMcpServerInput): Promise<McpAuthStatusResult>;
  invalidateServer(serverKey: string): Promise<void>;
  releaseThread(threadId: string): Promise<void>;
};

/**
 * MCP 配置与协议操作的单一控制面。
 *
 * 配置事务（upsert/update/delete）经由 `McpStore` 落盘后立即 invalidate
 * 对应连接。对外只暴露 `serverKey`，由本服务查询 `McpStore` 得到完整配置；
 * 连接 scope 由协议适配器按操作类型生成。
 */
export class McpControlService implements McpControl {
  constructor(
    private readonly store: McpStore,
    private readonly protocol: McpProtocolService,
  ) {}

  async listServers(options: { includeAuthStatus?: boolean } = {}): Promise<RuntimeMcpServerList> {
    const list = await this.store.listServers();
    return options.includeAuthStatus ? this.enrichAuthStatuses(list) : list;
  }

  async discoverTools(input: RuntimeMcpServerInput, options?: McpOperationOptions): Promise<RuntimeMcpToolList> {
    const existing = (await this.store.listServerInputs()).find((server) => server.key === input.key);
    return this.protocol.discoverTools(mergeRuntimeMcpServerInput(existing, input), options);
  }

  async upsertServer(input: RuntimeMcpServerInput): Promise<RuntimeMcpServerList> {
    const saved = await this.store.upsertServer(input);
    await this.protocol.invalidateServer(input.key);
    return saved;
  }

  async updateServer(key: string, patch: RuntimeMcpServerPatch): Promise<RuntimeMcpServerList> {
    const saved = await this.store.updateServer(key, patch);
    await this.protocol.invalidateServer(key);
    return saved;
  }

  async deleteServer(key: string): Promise<void> {
    await this.store.deleteServer(key);
    await this.protocol.invalidateServer(key);
  }

  async reloadServers(): Promise<void> {
    // 配置由 store 读；重新加载只是让已缓存连接按最新配置重连。
    const servers = await this.store.listServerInputs();
    await Promise.all(servers.map((server) => this.protocol.invalidateServer(server.key)));
  }

  async login(serverKey: string, options?: McpLoginOptions): Promise<void> {
    const server = await this.requireServer(serverKey);
    await this.protocol.login(server, options);
  }

  async logout(serverKey: string): Promise<void> {
    const server = await this.requireServer(serverKey);
    await this.protocol.logout(server);
  }

  async authStatus(serverKey: string): Promise<McpAuthStatusResult> {
    const server = await this.requireServer(serverKey);
    return this.protocol.authStatus(server);
  }

  async listTools(serverKey: string, context: McpOperationContext): Promise<RuntimeMcpToolInfo[]> {
    const server = await this.requireServer(serverKey);
    return this.protocol.listTools(server, context);
  }

  async listResources(serverKey: string, context: McpOperationContext): Promise<RuntimeMcpResource[]> {
    const server = await this.requireServer(serverKey);
    return this.protocol.listResources(server, context);
  }

  async listResourceTemplates(serverKey: string, context: McpOperationContext): Promise<RuntimeMcpResourceTemplate[]> {
    const server = await this.requireServer(serverKey);
    return this.protocol.listResourceTemplates(server, context);
  }

  async readResource(serverKey: string, uri: string, context: McpOperationContext): Promise<McpResourceReadResponse> {
    const server = await this.requireServer(serverKey);
    return this.protocol.readResource(server, uri, context);
  }

  callTool(serverKey: string, toolName: string, input: unknown, context: McpOperationContext): Promise<McpToolCallResponse> {
    return this.requireServer(serverKey).then((server) => this.protocol.callTool(server, toolName, input, context));
  }

  async snapshot(serverKey: string, context: McpOperationContext, options?: McpSnapshotOptions): Promise<McpServerRuntimeSnapshot> {
    const server = await this.requireServer(serverKey);
    return this.protocol.snapshot(server, context, options);
  }

  async invalidateServer(serverKey: string): Promise<void> {
    return this.protocol.invalidateServer(serverKey);
  }

  async releaseThread(threadId: string): Promise<void> {
    return this.protocol.releaseThread(threadId);
  }

  private async requireServer(serverKey: string): Promise<RuntimeMcpServerInput> {
    const server = (await this.store.listServerInputs()).find((item) => item.key === serverKey);
    if (!server) throw new Error(`MCP server not found: ${serverKey}`);
    return server;
  }

  private async enrichAuthStatuses(list: RuntimeMcpServerList): Promise<RuntimeMcpServerList> {
    const servers = await Promise.all(list.servers.map(async (server) => {
      const auth = await this.authStatus(server.key);
      return {
        ...server,
        ...(auth.status ? { authStatus: auth.status } : {}),
        ...(auth.error ? { authError: auth.error } : {}),
      };
    }));
    return { ...list, servers };
  }
}
