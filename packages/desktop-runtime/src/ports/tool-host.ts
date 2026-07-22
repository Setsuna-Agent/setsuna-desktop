import type {
  RuntimeEnvironment,
  RuntimeMessage,
  RuntimePermissionProfile,
  RuntimePluginReference,
  RuntimeSandboxWorkspaceWrite,
  RuntimeToolChoice,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';

export type ToolExecutionEnvironment = RuntimeEnvironment;

export type ToolExecutionContext = {
  threadId: string;
  projectId?: string;
  turnId?: string;
  toolCallId?: string;
  modelCapabilities?: {
    supportsImages: boolean;
  };
  environment?: ToolExecutionEnvironment;
  permissionProfile?: RuntimePermissionProfile;
  sandboxWorkspaceWrite?: RuntimeSandboxWorkspaceWrite;
  features?: Record<string, boolean>;
  sandbox?: ToolSandboxAttempt;
  signal?: AbortSignal;
  onToolOutputDelta?(delta: ToolOutputDelta): void;
  /** Opaque snapshot binding produced by previewToolCall and verified by the host before mutation. */
  expectedPreviewIntegrityToken?: string;
};

/**
 * runtime 工具执行上下文：在通用 ToolExecutionContext 基础上，
 * 强制要求 turnId、permissionProfile、sandboxWorkspaceWrite 与 abort signal。
 * agent-loop 与 tool-orchestrator 共享该类型，避免重复定义导致字段漂移。
 */
export type RuntimeToolExecutionContext = ToolExecutionContext & {
  environment: ToolExecutionEnvironment;
  turnId: string;
  permissionProfile: RuntimePermissionProfile;
  sandboxWorkspaceWrite: RuntimeSandboxWorkspaceWrite | undefined;
  signal: AbortSignal;
};

export type ToolSandboxAttempt = {
  mode: 'default' | 'bypass';
  networkAccess?: 'default' | 'enabled';
  retryReason?: string;
};

export type ToolOutputDelta = {
  delta: string;
  stream?: 'stdout' | 'stderr';
  processId?: string;
};

export type ToolExecutionResult = {
  content: string;
  attachments?: RuntimeMessage['attachments'];
  preview?: string;
  data?: unknown;
  containsExternalContext?: boolean;
};

export type ToolTurnCleanupOutcome = {
  status: 'completed' | 'cancelled' | 'failed';
};

export class ToolExecutionError extends Error {
  readonly failureKind?: string;
  readonly failureStage?: string;
  readonly data?: unknown;

  constructor(message: string, options: { failureKind?: string; failureStage?: string; data?: unknown } = {}) {
    super(message);
    this.name = 'ToolExecutionError';
    this.failureKind = options.failureKind;
    this.failureStage = options.failureStage;
    this.data = options.data;
  }
}

export type ToolExecutionPreview = {
  argumentsPreview?: string;
  resultPreview?: string;
  integrityToken?: string;
};

export type ToolExternalContext = {
  id: string;
  label: string;
  content: string;
};

export type ToolRuntimeProfile = {
  exposure?: 'direct' | 'hidden';
  /** 插件提供的原生工具必须在执行开始前声明归属，供事件持久化和 UI 实时展示。 */
  plugin?: RuntimePluginReference;
  supportsParallel?: boolean;
  waitsForRuntimeCancellation?: boolean;
  visibleToModel?: boolean;
  /** 工具自行管理可审计交互生命周期，不能再接受第二次通用审批。 */
  approvalMode?: 'orchestrated' | 'selfManaged';
};

export type ToolApprovalRequirement = {
  reason: string;
  argumentsPreview?: string;
  approvalKeys?: string[];
  persistentApprovalKeys?: string[];
};

export type ToolHost = {
  listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]>;
  environmentForToolContext?(context: ToolExecutionContext): Promise<ToolExecutionEnvironment | null> | ToolExecutionEnvironment | null;
  systemPrompt?(context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): Promise<string | null> | string | null;
  externalContext?(context: ToolExecutionContext, request?: { tools: RuntimeToolDefinition[] }): Promise<ToolExternalContext[]> | ToolExternalContext[];
  toolChoice?(context: ToolExecutionContext, request: { tools: RuntimeToolDefinition[]; messages: RuntimeMessage[] }): Promise<RuntimeToolChoice | null> | RuntimeToolChoice | null;
  toolRuntimeProfile?(name: string, context: ToolExecutionContext): Promise<ToolRuntimeProfile | null> | ToolRuntimeProfile | null;
  approvalForTool?(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolApprovalRequirement | null>;
  previewToolCall?(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionPreview | null>;
  previewPartialToolCall?(name: string, rawArguments: string, context: ToolExecutionContext): Promise<ToolExecutionPreview | null>;
  runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
  cleanupTurn?(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome): Promise<void> | void;
};
