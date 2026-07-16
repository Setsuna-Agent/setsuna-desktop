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
   * Logical MCP session scope. Runtime tool calls use a thread-scoped value so
   * stateful servers cannot leak session state between conversations.
   */
  scopeId: string;
  /** Active tool identity used to route server-initiated elicitation to UI. */
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

/** Runtime-facing MCP client port. Protocol details stay inside the SDK adapter. */
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
