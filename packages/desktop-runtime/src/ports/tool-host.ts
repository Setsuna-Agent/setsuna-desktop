import type { RuntimePermissionProfile, RuntimeToolDefinition } from '@setsuna-desktop/contracts';

export type ToolExecutionContext = {
  threadId: string;
  projectId?: string;
  turnId?: string;
  permissionProfile?: RuntimePermissionProfile;
  signal?: AbortSignal;
};

export type ToolExecutionResult = {
  content: string;
  preview?: string;
  data?: unknown;
};

export type ToolApprovalRequirement = {
  reason: string;
  argumentsPreview?: string;
};

export type ToolHost = {
  listTools(context: ToolExecutionContext): Promise<RuntimeToolDefinition[]>;
  approvalForTool?(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolApprovalRequirement | null>;
  runTool(name: string, input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
};
