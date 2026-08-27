import type {
  RuntimeMcpAuthStatus,
  RuntimeMcpResource,
  RuntimeMcpResourceTemplate,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
  RuntimeMcpToolInfo,
  RuntimeMcpToolList,
} from '@setsuna-desktop/contracts';
import type { McpElicitationHandler } from './elicitation.js';
import type { McpStore } from './store.js';

/**
 * 凭据保险库的窄接口。feature 只依赖这四个操作，不注入整个 native bridge。
 */
export type McpCredentialStore = {
  status(): Promise<{ available: boolean; backend: string }>;
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

/** 网络环境解析结果：值为字符串时用于替换，`null` 表示从环境中移除。 */
export type McpNetworkEnvironment = Record<string, string | null>;

export type McpOperationOptions = {
  signal?: AbortSignal;
};

export type McpOperationContext = McpOperationOptions & {
  /** 存在时使用线程级逻辑会话；缺省 scope 由具体 control 操作内部决定。 */
  threadId?: string;
  turnId?: string;
  toolCallId?: string;
  toolName?: string;
  onProgress?(progress: { progress: number; total?: number; message?: string }): void;
};

export type McpResourceReadResponse = {
  contents: Array<Record<string, unknown>>;
  _meta?: unknown;
};

export type McpToolCallResponse = {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError: boolean;
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

export type McpAuthStatusResult = { status: RuntimeMcpAuthStatus; error?: string };

export type McpSnapshotOptions = {
  includeTools?: boolean;
  includeResources?: boolean;
};

export type McpLoginOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

/**
 * Feature 唯一的宿主输入面。
 *
 * 由 desktop-runtime 的 composition root 在 feature 激活时提供。feature 只依赖
 * 这些窄接口，不持有 `DesktopNativeBridge`，以便 SDK manager 只出现在 feature
 * 内部。
 */
export type McpRuntimeHost = {
  store: McpStore;
  credentials: McpCredentialStore;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  resolveNetworkEnvironment(): Promise<McpNetworkEnvironment>;
  openExternal(url: string): Promise<void>;
  elicitation: McpElicitationHandler;
};

/** REST、App Server、Skill、Plugin 和线程生命周期使用的唯一 MCP 控制面。 */
export type McpControl = {
  listServers(options?: { includeAuthStatus?: boolean }): Promise<RuntimeMcpServerList>;
  discoverTools(input: RuntimeMcpServerInput, options?: McpOperationOptions): Promise<RuntimeMcpToolList>;
  upsertServer(input: RuntimeMcpServerInput): Promise<RuntimeMcpServerList>;
  updateServer(key: string, patch: RuntimeMcpServerPatch): Promise<RuntimeMcpServerList>;
  deleteServer(key: string): Promise<void>;
  reloadServers(): Promise<void>;
  login(serverKey: string, options?: McpLoginOptions): Promise<void>;
  logout(serverKey: string): Promise<void>;
  authStatus(serverKey: string): Promise<McpAuthStatusResult>;
  listTools(serverKey: string, context: McpOperationContext): Promise<RuntimeMcpToolInfo[]>;
  listResources(serverKey: string, context: McpOperationContext): Promise<RuntimeMcpResource[]>;
  listResourceTemplates(serverKey: string, context: McpOperationContext): Promise<RuntimeMcpResourceTemplate[]>;
  readResource(serverKey: string, uri: string, context: McpOperationContext): Promise<McpResourceReadResponse>;
  callTool(serverKey: string, toolName: string, input: unknown, context: McpOperationContext): Promise<McpToolCallResponse>;
  snapshot(serverKey: string, context: McpOperationContext, options?: McpSnapshotOptions): Promise<McpServerRuntimeSnapshot>;
  invalidateServer(serverKey: string): Promise<void>;
  releaseThread(threadId: string): Promise<void>;
};
