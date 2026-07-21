import type { RuntimeMessage, RuntimeMessagePromptSource, RuntimeMessageProviderMetadata } from './threads.js';
import type { RuntimeUsage } from './usage.js';
import type { RuntimePermissionProfile, RuntimeSandboxWorkspaceWrite } from './config.js';
import type { RuntimeEnvironment } from './environment.js';
import type { RuntimePluginReference } from './plugins.js';

export type ModelProviderKind = 'openai-compatible' | 'openai-responses' | 'anthropic';

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
  role: Extract<RuntimeMessage['role'], 'system' | 'developer' | 'user' | 'assistant'>;
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
  exposure: 'direct';
  supportsParallel: boolean;
  waitsForRuntimeCancellation: boolean;
};

export type RuntimeModelRequestStepSnapshot = {
  threadId: string;
  turnId: string;
  threadLastSeq: number;
  projectId?: string;
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
  name?: string;
  role?: RuntimeMessage['role'];
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

export type ModelRequest = {
  model: string;
  messages: RuntimeMessage[];
  tools?: RuntimeToolDefinition[];
  toolChoice?: RuntimeToolChoice;
  stepSnapshot?: RuntimeModelRequestStepSnapshot;
  maxOutputTokens?: number;
  temperature?: number;
  thinking?: boolean;
  reasoningEffort?: string;
  signal?: AbortSignal;
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
