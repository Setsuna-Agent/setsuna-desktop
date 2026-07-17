import type {
  RuntimeMcpAuthStatus,
  RuntimeMcpResource,
  RuntimeMcpResourceTemplate,
  RuntimeMcpServerInput,
  RuntimeMcpToolInfo,
  RuntimeMcpToolList,
} from '@setsuna-desktop/contracts';

export type McpProgress = {
  progress: number;
  total?: number;
  message?: string;
};

export type McpRequestContext = {
  /**
   * MCP 逻辑会话作用域。runtime 工具调用使用线程级值，防止有状态服务器在对话之间
   * 泄露会话状态。
   */
  scopeId: string;
  /** 当前活动工具标识，用于将服务器发起的信息征询路由到界面。 */
  threadId?: string;
  turnId?: string;
  toolCallId?: string;
  toolName?: string;
  signal?: AbortSignal;
  onProgress?(progress: McpProgress): void;
};

export type McpToolCallResponse = {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError: boolean;
  _meta?: unknown;
};

export type McpResourceReadResponse = {
  contents: Array<Record<string, unknown>>;
  _meta?: unknown;
};

export type McpServerRuntimeState = 'connecting' | 'ready' | 'disconnected' | 'error';

export type McpServerRuntimeSnapshot = {
  serverKey: string;
  state: McpServerRuntimeState;
  tools: RuntimeMcpToolInfo[];
  resources: RuntimeMcpResource[];
  resourceTemplates: RuntimeMcpResourceTemplate[];
  serverInfo?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  instructions?: string;
  protocolVersion?: string;
  connectedAt?: string;
  updatedAt: string;
  error?: string;
  authStatus?: RuntimeMcpAuthStatus;
  authError?: string;
};

export type McpSnapshotOptions = {
  includeTools?: boolean;
  includeResources?: boolean;
};

/** 面向 runtime 的 MCP 客户端端口；协议细节保留在 SDK 适配器内部。 */
export type McpClientRuntime = {
  discoverTools(server: RuntimeMcpServerInput, context?: Partial<McpRequestContext>): Promise<RuntimeMcpToolList>;
  listTools(server: RuntimeMcpServerInput, context: McpRequestContext): Promise<RuntimeMcpToolInfo[]>;
  listResources(server: RuntimeMcpServerInput, context: McpRequestContext): Promise<RuntimeMcpResource[]>;
  listResourceTemplates(server: RuntimeMcpServerInput, context: McpRequestContext): Promise<RuntimeMcpResourceTemplate[]>;
  readResource(server: RuntimeMcpServerInput, uri: string, context: McpRequestContext): Promise<McpResourceReadResponse>;
  callTool(server: RuntimeMcpServerInput, toolName: string, args: unknown, context: McpRequestContext): Promise<McpToolCallResponse>;
  snapshot(server: RuntimeMcpServerInput, context: McpRequestContext, options?: McpSnapshotOptions): Promise<McpServerRuntimeSnapshot>;
  login(server: RuntimeMcpServerInput, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>;
  logout(server: RuntimeMcpServerInput): Promise<void>;
  authStatus(server: RuntimeMcpServerInput): Promise<{ status: RuntimeMcpAuthStatus; error?: string }>;
  invalidateServer(serverKey: string): Promise<void>;
  releaseScope(scopeId: string): Promise<void>;
  releaseThread(threadId: string): Promise<void>;
  shutdown(): Promise<void>;
};
