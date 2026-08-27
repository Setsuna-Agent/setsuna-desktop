import type { RuntimeMessageAttachment, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { McpOperationContext } from './control.js';

/**
 * Feature 持有的工具执行上下文。只包含 MCP 真正需要的字段，desktop-runtime
 * 的 `McpToolHostAdapter` 负责从 `ToolExecutionContext` 转换过来。
 */
export type McpToolExecutionContext = McpOperationContext & {
  threadId: string;
  toolCallId?: string;
  toolName?: string;
  signal?: AbortSignal;
};

export type McpToolRunContext = McpToolExecutionContext & {
  modelCapabilities?: {
    supportsImages: boolean;
  };
};

export type McpToolExternalContext = {
  id: string;
  label: string;
  content: string;
};

export type McpToolApprovalRequirement = {
  reason: string;
  argumentsPreview?: string;
  approvalKeys?: string[];
  persistentApprovalKeys?: string[];
  rejectWhenApprovalDisabled?: boolean;
};

export type McpToolExecutionPreview = {
  argumentsPreview?: string;
  resultPreview?: string;
  integrityToken?: string;
};

export type McpToolExecutionResult = {
  content: string;
  attachments?: RuntimeMessageAttachment[];
  preview?: string;
  data?: unknown;
  containsExternalContext?: boolean;
};

export type McpToolRuntimeProfile = {
  exposure?: 'direct' | 'deferred' | 'hidden';
  modelOutputTokenLimit?: number;
  searchAliases?: string[];
  supportsParallel?: boolean;
  waitsForRuntimeCancellation?: boolean;
  visibleToModel?: boolean;
  approvalMode?: 'orchestrated' | 'selfManaged';
  requiresSandboxBypassApproval?: boolean;
};

/**
 * Agent 运行时 MCP 工具服务。内部区分两组 owner：
 * - management tools：`configure_mcp_server`
 * - runtime tools：`resources` + `mcp__server__tool`
 *
 * desktop-runtime 的 `McpToolHostAdapter` 实现 `ToolHost`，把常规执行上下文
 * 转换到这里；本服务不依赖 desktop-runtime 的类型。
 */
export type McpRuntimeToolService = {
  listTools(context: McpToolExecutionContext): Promise<RuntimeToolDefinition[]>;
  toolRuntimeProfile(name: string, context: McpToolExecutionContext): McpToolRuntimeProfile | null;
  systemPrompt(
    context: McpToolExecutionContext,
    request?: { tools: RuntimeToolDefinition[] },
  ): string | null;
  externalContext(
    context: McpToolExecutionContext,
    request?: { tools: RuntimeToolDefinition[] },
  ): Promise<McpToolExternalContext[]>;
  approvalForTool(
    name: string,
    input: unknown,
    context: McpToolExecutionContext,
  ): Promise<McpToolApprovalRequirement | null>;
  previewToolCall(
    name: string,
    input: unknown,
    context: McpToolExecutionContext,
  ): Promise<McpToolExecutionPreview | null>;
  runTool(
    name: string,
    input: unknown,
    context: McpToolRunContext,
  ): Promise<McpToolExecutionResult>;
};
