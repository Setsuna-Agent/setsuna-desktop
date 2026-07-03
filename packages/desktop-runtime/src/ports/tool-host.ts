import type { RuntimeMessage, RuntimePermissionProfile, RuntimeToolChoice, RuntimeToolDefinition } from '@setsuna-desktop/contracts';

export type ToolExecutionContext = {
  threadId: string;
  projectId?: string;
  turnId?: string;
  toolCallId?: string;
  permissionProfile?: RuntimePermissionProfile;
  signal?: AbortSignal;
  onToolOutputDelta?(delta: ToolOutputDelta): void;
};

export type ToolOutputDelta = {
  delta: string;
  stream?: 'stdout' | 'stderr';
  processId?: string;
};

export type ToolExecutionResult = {
  content: string;
  preview?: string;
  data?: unknown;
  containsExternalContext?: boolean;
};

export type ToolExecutionPreview = {
  argumentsPreview?: string;
  resultPreview?: string;
};

export type ToolApprovalRequirement = {
  reason: string;
  argumentsPreview?: string;
};

export type ToolHost = {
  listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]>;
  systemPrompt?(context: ToolExecutionContext): Promise<string | null> | string | null;
  toolChoice?(context: ToolExecutionContext, request: { tools: RuntimeToolDefinition[]; messages: RuntimeMessage[] }): Promise<RuntimeToolChoice | null> | RuntimeToolChoice | null;
  approvalForTool?(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolApprovalRequirement | null>;
  previewToolCall?(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionPreview | null>;
  previewPartialToolCall?(name: string, rawArguments: string, context: ToolExecutionContext): Promise<ToolExecutionPreview | null>;
  runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
};
