import type {
  ModelRequest,
  RuntimeConfigState,
  RuntimeMessage,
  RuntimeModelRequestStepSnapshot,
  RuntimeThread,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { ApprovalGate } from '../../ports/approval-gate.js';
import type { AttachmentStore } from '../../ports/attachment-store.js';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { McpStore } from '../../ports/mcp-store.js';
import type { ProjectInstructionLoader } from '../../ports/project-instruction-loader.js';
import type { ProjectWorkflowResolver } from '../../ports/project-workflow-resolver.js';
import type { RuntimeEnvironmentResolver } from '../../ports/runtime-environment-resolver.js';
import type { SkillRegistry } from '../../ports/skill-registry.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeToolExecutionContext, ToolHost } from '../../ports/tool-host.js';
import {
  CONTEXT_COMPACTION_MAX_TOKENS,
  estimateRuntimeMessageTokens,
  estimateRuntimeToolDefinitionTokens,
} from '../context/context-compaction.js';
import { compileRuntimePrompt } from '../context/prompt-compiler.js';
import { buildRuntimeAttachmentContext, messageForModel } from '../context/runtime-attachment-context.js';
import type { RuntimeContextCompactor } from '../context/runtime-context-compactor.js';
import {
  contextCompactionBudgetForConfig,
  samplingContextWindowForRequest,
  samplingInputMessageIds,
} from '../context/runtime-context-compactor.js';
import { RuntimePromptContextAssembler } from '../context/runtime-prompt-context-assembler.js';
import { isReviewReadOnlyTool } from '../context/runtime-review-profile.js';
import type { RuntimeMemoryCoordinator } from '../memory/runtime-memory-coordinator.js';
import type { RuntimeToolCallExecutor } from '../tools/runtime-tool-call-executor.js';
import { RuntimeToolRouter } from '../tools/tool-router.js';
import { modelFacingTools, samplingToolRuntimes } from './agent-loop-tool-utils.js';
import { normalizeModelConversationOrder } from './runtime-model-message-order.js';

const OUTPUT_RESERVE_CONTEXT_RATIO = 0.15;

export type RuntimeSamplingStepContext = {
  conversationMessages: RuntimeMessage[];
  messages: RuntimeMessage[];
  runtimeConfig: RuntimeConfigState | null | undefined;
  snapshot: RuntimeModelRequestStepSnapshot;
  toolChoice: ModelRequest['toolChoice'];
  toolContext: RuntimeToolExecutionContext;
  toolRouter: RuntimeToolRouter | null;
  tools?: RuntimeToolDefinition[];
};

type RuntimeSamplingContextBuilderOptions = {
  approvalGate?: ApprovalGate;
  attachmentStore?: Pick<AttachmentStore, 'resolveForThread'>;
  clock: Clock;
  configStore?: ConfigStore;
  contextCompactor: Pick<RuntimeContextCompactor, 'compactMessagesBeforeModelRequest'>;
  environmentResolver: RuntimeEnvironmentResolver;
  mcpStore?: Pick<McpStore, 'listServerInputs'>;
  memory: Pick<RuntimeMemoryCoordinator, 'contextMessages'>;
  projectInstructions?: ProjectInstructionLoader;
  projectWorkflow?: ProjectWorkflowResolver;
  skillRegistry?: SkillRegistry;
  threadStore: ThreadStore;
  toolExecutor: Pick<
    RuntimeToolCallExecutor,
    | 'dynamicToolsForThread'
    | 'toolOrchestratorFor'
  >;
  toolHost?: ToolHost;
};

/**
 * 单个不可变模型采样步骤的构建器。
 *
 * AgentLoop 决定何时捕获步骤；此构建器负责将供应商配置、压缩结果、工具、
 * 记忆、Skill 和世界状态组合为一次请求。
 */
export class RuntimeSamplingContextBuilder {
  private readonly promptContexts: RuntimePromptContextAssembler;

  constructor(private readonly options: RuntimeSamplingContextBuilderOptions) {
    this.promptContexts = new RuntimePromptContextAssembler({
      memory: options.memory,
      projectInstructions: options.projectInstructions,
      projectWorkflow: options.projectWorkflow,
      skillRegistry: options.skillRegistry,
      toolHost: options.toolHost,
    });
  }

  async build({
    conversationMessages,
    hookContextMessages,
    runtimeConfig,
    signal,
    skillIds,
    thread,
    threadId,
    turnId,
    toolAccess = 'all',
  }: {
    conversationMessages: RuntimeMessage[];
    hookContextMessages: RuntimeMessage[];
    runtimeConfig: RuntimeConfigState | null | undefined;
    signal: AbortSignal;
    skillIds: string[];
    thread: RuntimeThread;
    threadId: string;
    turnId: string;
    toolAccess?: 'all' | 'read-only' | 'none';
  }): Promise<RuntimeSamplingStepContext> {
    const orderedConversationMessages = normalizeModelConversationOrder(conversationMessages);
    const latestRuntimeConfig = await this.options.configStore?.getConfig().catch(() => null);
    const stepRuntimeConfig = latestRuntimeConfig ?? runtimeConfig ?? null;
    const environment = await this.options.environmentResolver.resolve({
      projectId: thread.projectId,
      threadId,
      threadCreatedAt: thread.createdAt,
    });
    const snapshotThread = await this.options.threadStore.getThread(threadId).catch(() => null);
    const attachmentContext = await buildRuntimeAttachmentContext({
      attachmentStore: this.options.attachmentStore,
      messages: [...(snapshotThread?.messages ?? thread.messages), ...orderedConversationMessages],
      now: this.options.clock.now(),
      threadId,
      turnId,
    });
    const configuredSandbox = stepRuntimeConfig?.sandboxWorkspaceWrite ?? {};
    const sandboxWorkspaceWrite = attachmentContext.readableRoots.length
      ? {
          ...configuredSandbox,
          readableRoots: [...new Set([
            environment.workspaceRoot,
            ...(configuredSandbox.readableRoots ?? []),
            ...attachmentContext.readableRoots,
          ])],
        }
      : configuredSandbox;
    const toolContext: RuntimeToolExecutionContext = {
      environment,
      threadId,
      projectId: thread.projectId,
      turnId,
      modelCapabilities: {
        supportsImages: activeModelForConfig(stepRuntimeConfig)?.supportsImages === true,
      },
      permissionProfile: stepRuntimeConfig?.permissionProfile ?? 'workspace-write',
      sandboxWorkspaceWrite,
      features: stepRuntimeConfig?.features ?? {},
      signal,
    };
    const dynamicTools = this.options.toolExecutor.dynamicToolsForThread(threadId);
    const toolRouter = this.options.toolHost && toolAccess !== 'none'
      ? await RuntimeToolRouter.create({
          toolHost: this.options.toolHost,
          orchestrator: this.options.toolExecutor.toolOrchestratorFor(toolContext, stepRuntimeConfig),
          context: toolContext,
          approvalPolicy: stepRuntimeConfig?.approvalPolicy ?? 'on-request',
          ...(toolAccess === 'read-only' ? { allowTool: (tool: RuntimeToolDefinition) => isReviewReadOnlyTool(tool.name) } : {}),
          strictApprovalRequiresSerial: Boolean(this.options.approvalGate && (stepRuntimeConfig?.approvalPolicy ?? 'on-request') === 'strict'),
        })
      : null;
    const threadHasGoal = Boolean(thread.goal);
    const availableTools = toolAccess === 'none'
      ? undefined
      : modelFacingTools(toolRouter?.tools, stepRuntimeConfig, dynamicTools, threadHasGoal);
    const tools = toolAccess === 'read-only'
      ? availableTools?.filter((tool) => isReviewReadOnlyTool(tool.name))
      : availableTools;
    const advertisedToolNames = tools?.map((tool) => tool.name) ?? [];
    const toolRuntimes = await samplingToolRuntimes(tools ?? [], toolRouter, dynamicTools, stepRuntimeConfig, threadHasGoal);
    const promptContext = await this.promptContexts.build({
      config: stepRuntimeConfig,
      hookContextMessages: [
        ...hookContextMessages,
        ...(attachmentContext.contextMessage ? [attachmentContext.contextMessage] : []),
      ],
      skillActivationText: currentTurnSkillActivationText(orderedConversationMessages, turnId),
      skillIds,
      thread,
      toolContext,
      toolRouter,
      tools: tools ?? [],
    });
    const fragments = promptContext.fragments;
    const transientPrompt = compileRuntimePrompt({ fragments, conversationMessages: [], createdAt: this.options.clock.now().toISOString() });
    const reservedOutputTokens = reservedOutputTokensForConfig(stepRuntimeConfig);
    const reservedTokens = estimateRuntimeMessageTokens(transientPrompt.messages)
      + estimateRuntimeToolDefinitionTokens(tools)
      + reservedOutputTokens;
    const compactedConversationMessages = await this.options.contextCompactor.compactMessagesBeforeModelRequest({
      force: false,
      messages: orderedConversationMessages,
      reservedTokens,
      runtimeConfig: stepRuntimeConfig,
      signal,
      thread,
      threadId,
      turnId,
    });
    const compiledPrompt = compileRuntimePrompt({
      fragments,
      conversationMessages: compactedConversationMessages.map(messageForModel),
      createdAt: this.options.clock.now().toISOString(),
    });
    const messages = compiledPrompt.messages;
    const toolChoice = tools?.length ? (await toolRouter?.toolChoice(messages) ?? 'auto') : undefined;
    const mcpServerKeys = await this.mcpServerKeysForSnapshot();
    const snapshot: RuntimeModelRequestStepSnapshot = {
      threadId,
      turnId,
      threadLastSeq: snapshotThread?.lastSeq ?? thread.lastSeq,
      ...(thread.projectId ? { projectId: thread.projectId } : {}),
      conversationMessageIds: compactedConversationMessages.map((message) => message.id),
      messageIds: messages.map((message) => message.id),
      inputMessageIds: samplingInputMessageIds(messages, turnId),
      toolNames: advertisedToolNames,
      advertisedToolNames,
      toolRuntimes,
      ...(toolChoice ? { toolChoice } : {}),
      toolEnvironment: environment,
      selectedSkills: promptContext.selectedSkills,
      mcpServerKeys,
      mcpServerCount: mcpServerKeys.length,
      permissionProfile: toolContext.permissionProfile,
      ...(toolContext.sandboxWorkspaceWrite ? { sandboxWorkspaceWrite: toolContext.sandboxWorkspaceWrite } : {}),
      contextWindow: samplingContextWindowForRequest({
        messages: modelRequestMessages(messages),
        tools,
        reservedOutputTokens,
        budget: contextCompactionBudgetForConfig(stepRuntimeConfig),
      }),
      promptManifest: compiledPrompt.manifest,
      featureKeys: Object.keys(toolContext.features ?? {}).sort(),
      worldState: {
        ...(stepRuntimeConfig?.activeProviderId ? { activeProviderId: stepRuntimeConfig.activeProviderId } : {}),
        ...(stepRuntimeConfig?.configPath ? { configPath: stepRuntimeConfig.configPath } : {}),
        ...(stepRuntimeConfig?.dataPath ? { dataPath: stepRuntimeConfig.dataPath } : {}),
        ...(stepRuntimeConfig ? { memoryEnabled: stepRuntimeConfig.memoryEnabled } : {}),
        ...(stepRuntimeConfig?.storagePath ? { storagePath: stepRuntimeConfig.storagePath } : {}),
        threadMessageCount: snapshotThread?.messageCount ?? thread.messageCount,
        threadUpdatedAt: snapshotThread?.updatedAt ?? thread.updatedAt,
      },
    };
    return {
      conversationMessages: compactedConversationMessages,
      messages,
      runtimeConfig: stepRuntimeConfig,
      snapshot,
      toolChoice,
      toolContext,
      toolRouter,
      tools,
    };
  }

  private async mcpServerKeysForSnapshot(): Promise<string[]> {
    const servers = await this.options.mcpStore?.listServerInputs().catch(() => []);
    if (!servers?.length) return [];
    return servers
      .filter((server) => server.enabled !== false)
      .map((server) => server.key.trim())
      .filter(Boolean)
      .sort();
  }
}

function currentTurnSkillActivationText(messages: RuntimeMessage[], turnId: string): string {
  const currentTurnMessages = messages.filter((message) => message.role === 'user' && message.turnId === turnId);
  const fallbackMessage = [...messages].reverse().find((message) => message.role === 'user');
  const activationMessages = currentTurnMessages.length ? currentTurnMessages : fallbackMessage ? [fallbackMessage] : [];
  return activationMessages.flatMap((message) => [
    message.content,
    ...(message.attachments ?? []).flatMap((attachment) => [attachment.name, attachment.type]),
  ]).map((value) => value.trim()).filter(Boolean).join('\n');
}

function modelRequestMessages(messages: RuntimeMessage[]): RuntimeMessage[] {
  return messages.filter((message) => message.visibility !== 'transcript');
}

function reservedOutputTokensForConfig(config: RuntimeConfigState | null | undefined): number {
  const activeModel = activeModelForConfig(config);
  const maxContextTokens = positiveSetting(
    activeModel?.contextWindowTokens
      ?? config?.desktopSettings?.modelContextWindow
      ?? config?.desktopSettings?.model_context_window,
  ) ?? CONTEXT_COMPACTION_MAX_TOKENS;
  const configuredOutputTokens = Math.max(0, Math.floor(activeModel?.maxOutputTokens ?? 0));
  return Math.min(configuredOutputTokens, Math.floor(maxContextTokens * OUTPUT_RESERVE_CONTEXT_RATIO));
}

function activeModelForConfig(config: RuntimeConfigState | null | undefined): RuntimeConfigState['providers'][number]['models'][number] | undefined {
  const activeProvider = config?.providers.find((provider) => provider.id === config.activeProviderId && provider.enabled)
    ?? config?.providers.find((provider) => provider.enabled)
    ?? config?.providers[0];
  return activeProvider?.models.find((model) => model.enabled) ?? activeProvider?.models[0];
}

function positiveSetting(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
