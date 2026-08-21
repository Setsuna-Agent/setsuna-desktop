import type { RuntimeEnvironment } from './environment.js';
import type {
  RuntimeAssistantMessagePhase,
  RuntimeMessagePromptSource,
  RuntimeMessageProviderMetadata,
  RuntimeMessageRole,
} from './message-metadata.js';
import type { RuntimePermissionProfile, RuntimeSandboxWorkspaceWrite } from './permissions.js';
import type { RuntimePluginReference } from './plugin-reference.js';
import type { RuntimeUsage } from './usage.js';

export type { ModelProviderKind } from './model-provider.js';

export type RuntimeToolChoice = 'auto' | 'none' | { type: 'tool'; name: string };

export type RuntimeToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type RuntimeDynamicToolDefinition = RuntimeToolDefinition & {
  namespace?: string;
  toolName: string;
};

export type RuntimeDynamicToolContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string };

export type RuntimeDynamicToolCallResult = {
  contentItems: RuntimeDynamicToolContentItem[];
  success?: boolean;
};

export type RuntimeToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type RuntimeToolCallDelta = {
  id: string;
  name: string;
  argumentsDelta: string;
};

/**
 * 指向本地工具结果存储的引用。通用命名为 result_id；Shell/Git/MCP 输出并非
 * 快照，browser_snapshot 的 result_id 则对应 observation 快照。
 */
export type RuntimeToolResultRef = {
  resultId: string;
  originalEstimatedTokens: number;
  /** 截断后实际进入模型上下文的估算 token 数。 */
  visibleTokens: number;
  visibleTokenLimit: number;
  /** 本地存储本身也发生裁剪(单结果硬上限或线程配额)。 */
  locallyTruncated?: boolean;
};

/**
 * RuntimeEnvironment 引入前创建的持久化快照可能只包含 id 和 cwd。
 * 此处保留可选字段，使旧事件日志仍可读取；实时 runtime 执行则使用完整的
 * RuntimeEnvironment 契约。
 */
export type RuntimeModelRequestToolEnvironment = Pick<RuntimeEnvironment, 'id' | 'cwd'>
  & Partial<Omit<RuntimeEnvironment, 'id' | 'cwd'>>;

export type RuntimeModelRequestStepSkill = {
  id: string;
  name: string;
  path?: string;
  /** 注入的 Skill 来自已安装插件包时存在。 */
  plugin?: RuntimePluginReference;
};

export type RuntimePromptManifestEntry = {
  id: string;
  role: Extract<RuntimeMessageRole, 'system' | 'developer' | 'user' | 'assistant'>;
  source: 'product' | 'tool_policy' | 'tool_external_context' | 'environment' | 'permissions' | 'personalization' | 'project_workflow' | 'project_instruction' | 'memory' | 'skill' | RuntimeMessagePromptSource;
  trust: 'runtime' | 'trusted_local' | 'user' | 'external';
  lifecycle: 'runtime' | 'workspace' | 'turn';
  estimatedTokens: number;
  contentHash: string;
  sourcePath?: string;
};

export type RuntimeModelRequestWorldState = {
  activeProviderId?: string;
  configPath?: string;
  dataPath?: string;
  memoryEnabled?: boolean;
  storagePath?: string;
  threadMessageCount: number;
  threadUpdatedAt: string;
};

export type RuntimeModelRequestContextWindow = {
  autoCompactTokenLimit: number;
  compactionHash?: string;
  compactionSummaryMessageIds: string[];
  estimatedTokens: number;
  messageTokens?: number;
  toolDefinitionTokens?: number;
  reservedOutputTokens?: number;
  maxContextTokens: number;
  maxContextTokensK: number;
  messageCount: number;
  tokensUntilCompaction: number;
};

export type RuntimeModelRequestToolRuntime = {
  name: string;
  source: 'host' | 'dynamic' | 'collaboration' | 'goal';
  /**
   * direct: 定义随每次请求稳定下发；deferred: 通过 tool_search 命中后才追加到
   * 后续请求的 tools 后缀。旧快照只有 'direct'。
   */
  exposure: 'direct' | 'deferred';
  supportsParallel: boolean;
  waitsForRuntimeCancellation: boolean;
};

/** Model selected for future conversation turns; each started turn snapshots this identity. */
export type RuntimeThreadModelBinding = {
  providerId: string;
  modelId: string;
  modelCode: string;
};

export type RuntimeModelRequestStepSnapshot = {
  threadId: string;
  turnId: string;
  threadLastSeq: number;
  projectId?: string;
  modelBinding?: RuntimeThreadModelBinding;
  conversationMessageIds: string[];
  messageIds: string[];
  inputMessageIds?: string[];
  toolNames: string[];
  /**
   * 本次采样中向模型声明的工具列表所对应的显式别名。
   * 旧快照只有 toolNames；新快照同时写入两者，便于调试。
   */
  advertisedToolNames?: string[];
  toolRuntimes?: RuntimeModelRequestToolRuntime[];
  toolChoice?: RuntimeToolChoice;
  toolEnvironment?: RuntimeModelRequestToolEnvironment | null;
  selectedSkills: RuntimeModelRequestStepSkill[];
  mcpServerKeys: string[];
  mcpServerCount: number;
  permissionProfile: RuntimePermissionProfile;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
  /** deferred 工具目录大小;未启用 tool_search 时省略。 */
  deferredToolCatalogSize?: number;
  /** 本 turn 已通过 tool_search 激活并追加到 tools 后缀的 deferred 工具名。 */
  loadedDeferredToolNames?: string[];
  /** 本次请求 tool 消息中可见(截断后)输出 token 之和。 */
  toolResultVisibleTokens?: number;
  /** 本次请求 tool 消息中原始输出 token 之和(仅统计被截断的结果)。 */
  toolResultOriginalTokens?: number;
  contextWindow?: RuntimeModelRequestContextWindow;
  promptManifest?: RuntimePromptManifestEntry[];
  featureKeys: string[];
  worldState: RuntimeModelRequestWorldState;
};

export type RuntimeStreamItemKind =
  | 'agent_message'
  | 'reasoning'
  | 'tool_call'
  | 'collab_tool_call'
  | 'tool_result'
  | 'plan'
  | 'context_compaction'
  | 'warning'
  | 'error';

export type RuntimeCollabToolName = 'spawn_agent' | 'send_input' | 'resume_agent' | 'wait' | 'close_agent';

export type RuntimeCollabToolCall = {
  tool: RuntimeCollabToolName;
  senderThreadId: string;
  receiverThreadId?: string;
  newThreadId?: string;
  prompt?: string;
  agentStatus?: string;
};

export type RuntimeStreamItem = {
  id: string;
  kind: RuntimeStreamItemKind;
  content?: string;
  phase?: RuntimeAssistantMessagePhase;
  name?: string;
  role?: RuntimeMessageRole;
  status?: 'in_progress' | 'completed' | 'failed' | 'cancelled';
  transcriptMessageId?: string;
  toolCall?: RuntimeToolCall;
  collabToolCall?: RuntimeCollabToolCall;
};

export type RuntimeSafetyBuffering = {
  model?: string;
  fasterModel?: string;
  reasons?: string[];
  showBufferingUi?: boolean;
  useCases?: string[];
};

export type RuntimeModelVerification = {
  model?: string;
  provider?: string;
  serverModel?: string;
  warnings?: string[];
};

export type ModelStreamEvent =
  | { type: 'assistant_metadata'; providerMetadata: RuntimeMessageProviderMetadata }
  | { type: 'item_started'; item: RuntimeStreamItem }
  | { type: 'item_delta'; itemId: string; delta: string }
  | { type: 'item_completed'; item: RuntimeStreamItem }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'reasoning_summary_delta'; itemId?: string; text: string; summaryIndex?: number }
  | { type: 'reasoning_summary_part_added'; itemId?: string; summaryIndex?: number }
  | { type: 'reasoning_raw_delta'; itemId?: string; text: string; contentIndex?: number }
  | { type: 'plan_delta'; itemId?: string; text: string }
  | { type: 'tool_call_delta'; call: RuntimeToolCallDelta }
  | { type: 'tool_calls'; toolCalls: RuntimeToolCall[] }
  | { type: 'safety_buffering'; buffering: RuntimeSafetyBuffering }
  | { type: 'model_verification'; verification: RuntimeModelVerification }
  | { type: 'token_count'; usage: RuntimeUsage; modelContextWindow?: number; tokensUntilCompaction?: number }
  | { type: 'turn_diff'; unifiedDiff: string }
  | { type: 'usage'; usage: RuntimeUsage }
  | { type: 'done'; finishReason?: string };
