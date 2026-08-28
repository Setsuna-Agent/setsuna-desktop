import {
  cloneRuntimeSkillReferences,
  isRuntimeInputMessageAttachment,
  type ModelRequest,
  type RuntimeConfigState,
  type RuntimeInterfaceLanguage,
  type RuntimeMessage,
  type RuntimeModelRequestStepSnapshot,
  type RuntimeTaskKind,
  type RuntimeThread,
  type RuntimeThreadGoalExecutionOptions,
  type RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { GoalControl } from '@setsuna-desktop/feature-goal/contracts';
import type { CollaborationControl } from '@setsuna-desktop/feature-collaboration/contracts';
import type { McpStore } from '@setsuna-desktop/feature-mcp/contracts';
import type { MemoryControl } from '@setsuna-desktop/feature-memory/contracts';
import type { SkillRegistry } from '@setsuna-desktop/feature-skills/contracts';
import type { ApprovalGate } from '../../ports/approval-gate.js';
import type { AttachmentStore } from '../../ports/attachment-store.js';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ProjectInstructionLoader } from '../../ports/project-instruction-loader.js';
import type { ProjectWorkflowResolver } from '../../ports/project-workflow-resolver.js';
import type { RuntimeEnvironmentResolver } from '../../ports/runtime-environment-resolver.js';
import {
  appendRuntimeDebugTraceSafely,
  runtimeDebugTraceEnabled,
  type RuntimeDebugTraceSink,
} from '../../ports/runtime-debug-trace.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeToolExecutionContext, ToolHost } from '../../ports/tool-host.js';
import type { ToolResultStore } from '../../ports/tool-result-store.js';
import {
  CONTEXT_COMPACTION_MAX_TOKENS,
  estimateRuntimeMessageTokens,
  estimateRuntimeToolDefinitionTokens,
  fitRuntimeMessagesToContextBudget,
} from '../context/context-compaction.js';
import { compileRuntimePrompt } from '../context/prompt-compiler.js';
import { buildRuntimeAttachmentContext, messagesForModel } from '../context/runtime-attachment-context.js';
import type { RuntimeContextCompactor } from '../context/runtime-context-compactor.js';
import {
  contextCompactionBudgetForConfig,
  samplingContextWindowForRequest,
  samplingInputMessageIds,
} from '../context/runtime-context-compactor.js';
import { RuntimePromptContextAssembler } from '../context/runtime-prompt-context-assembler.js';
import { isReviewReadOnlyTool } from '../context/runtime-review-profile.js';
import type { RuntimeToolCallExecutor } from '../tools/runtime-tool-call-executor.js';
import { RUNTIME_PROVIDED_TOOL_NAMES, RuntimeToolRouter } from '../tools/tool-router.js';
import { modelFacingTools, samplingToolRuntimes } from './agent-loop-tool-utils.js';
import { normalizeModelConversationHistory } from './runtime-model-message-order.js';
import { runtimeTaskModelRequest } from './runtime-task-model.js';
import type { RuntimeResolvedTurnModel } from './runtime-thread-model.js';

const OUTPUT_RESERVE_CONTEXT_RATIO = 0.15;

export type RuntimeSamplingStepContext = {
  conversationMessages: RuntimeMessage[];
  messages: RuntimeMessage[];
  modelRequest: Pick<ModelRequest, 'model' | 'providerId'>;
  modelHistoryWarnings?: string[];
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
  debugTrace?: RuntimeDebugTraceSink;
  environmentResolver: RuntimeEnvironmentResolver;
  ids: IdGenerator;
  collaborationControl(): CollaborationControl;
  goalControl(): GoalControl;
  mcpStore?: Pick<McpStore, 'listServerInputs'>;
  memoryControl(): Pick<MemoryControl, 'contextMessages'>;
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
  toolResultStore?: ToolResultStore;
};

/**
 * 单个不可变模型采样步骤的构建器。
 *
 * AgentLoop 决定何时捕获步骤；此构建器负责将供应商配置、压缩结果、工具、
 * 记忆、Skill 和世界状态组合为一次请求。
 */
export class RuntimeSamplingContextBuilder {
  private readonly promptContexts: RuntimePromptContextAssembler;
  /** turnId → 已激活 deferred 工具名;跨 sampling step 保持,turn 结束清理。 */
  private readonly deferredActivations = new Map<string, Set<string>>();

  constructor(private readonly options: RuntimeSamplingContextBuilderOptions) {
    this.promptContexts = new RuntimePromptContextAssembler({
      memoryControl: options.memoryControl,
      projectInstructions: options.projectInstructions,
      projectWorkflow: options.projectWorkflow,
      skillRegistry: options.skillRegistry,
      toolHost: options.toolHost,
    });
  }

  /** turn 结束时清理 deferred 激活状态,避免跨 turn 泄漏。 */
  cleanupTurn(turnId: string): void {
    this.deferredActivations.delete(turnId);
  }

  async build({
    conversationMessages,
    hookContextMessages,
    responseLanguage,
    runtimeConfig,
    signal,
    skillIds,
    thinkingOptions,
    thread,
    threadId,
    taskKind,
    turnId,
    turnModel,
    toolAccess = 'all',
  }: {
    conversationMessages: RuntimeMessage[];
    hookContextMessages: RuntimeMessage[];
    responseLanguage: RuntimeInterfaceLanguage;
    runtimeConfig: RuntimeConfigState | null | undefined;
    signal: AbortSignal;
    skillIds: string[];
    thinkingOptions?: Pick<ModelRequest, 'thinking' | 'reasoningEffort'>;
    thread: RuntimeThread;
    threadId: string;
    taskKind: RuntimeTaskKind;
    turnId: string;
    turnModel?: RuntimeResolvedTurnModel;
    toolAccess?: 'all' | 'read-only' | 'none';
  }): Promise<RuntimeSamplingStepContext> {
    const normalizedConversation = normalizeModelConversationHistory(conversationMessages);
    const orderedConversationMessages = normalizedConversation.messages;
    const latestRuntimeConfig = await this.options.configStore?.getConfig().catch(() => null);
    const stepRuntimeConfig = latestRuntimeConfig ?? runtimeConfig ?? null;
    const samplingModel = samplingModelForTask(stepRuntimeConfig, taskKind, turnModel);
    const debugTraceEnabled = runtimeDebugTraceEnabled(this.options.debugTrace);
    const snapshotThread = await this.options.threadStore.getThread(threadId).catch(() => null);
    if (debugTraceEnabled) {
      appendRuntimeDebugTraceSafely(this.options.debugTrace, {
        afterEventSeq: snapshotThread?.lastSeq ?? thread.lastSeq,
        kind: 'model.history.normalized',
        payload: {
          inputMessageCount: conversationMessages.length,
          interruptedToolResultMessageIds:
            normalizedConversation.diagnostics.interruptedToolResultMessageIds,
          orphanToolResultMessageIds:
            normalizedConversation.diagnostics.orphanToolResultMessageIds,
          outputMessageCount: orderedConversationMessages.length,
          warnings: normalizedConversation.warnings,
          wireToolCallRewrites: normalizedConversation.diagnostics.wireToolCallRewrites,
        },
        spanId: `model-history:${turnId}:${conversationMessages.at(-1)?.id ?? 'empty'}`,
        threadId,
        turnId,
      });
    }
    const environment = await this.options.environmentResolver.resolve({
      projectId: thread.projectId,
      threadId,
      threadCreatedAt: thread.createdAt,
    });
    const attachmentContext = await buildRuntimeAttachmentContext({
      attachmentStore: this.options.attachmentStore,
      messages: [...(snapshotThread?.messages ?? thread.messages), ...orderedConversationMessages],
      now: this.options.clock.now(),
      threadId,
      turnId,
    });
    const activeModelSupportsImages = samplingModel.model?.supportsImages === true;
    const configuredSandbox = stepRuntimeConfig?.sandboxWorkspaceWrite ?? {};
    const sandboxWorkspaceWrite = configuredSandbox;
    const goalExecution = goalExecutionForTurn({
      messages: [...(snapshotThread?.messages ?? thread.messages), ...orderedConversationMessages],
      skillIds,
      thinkingOptions,
      turnId,
      modelSelection: turnModel
        ? {
            providerId: turnModel.binding.providerId,
            modelId: turnModel.binding.modelId,
          }
        : undefined,
    });
    const toolContext: RuntimeToolExecutionContext = {
      environment,
      ...(goalExecution ? { goalExecution } : {}),
      threadId,
      projectId: thread.projectId,
      turnId,
      modelCapabilities: {
        supportsImages: activeModelSupportsImages,
      },
      permissionProfile: stepRuntimeConfig?.permissionProfile ?? 'workspace-write',
      sandboxWorkspaceWrite,
      ...(attachmentContext.readableRoots.length
        ? { directToolReadableRoots: attachmentContext.readableRoots }
        : {}),
      features: runtimeToolFeatureFlags(stepRuntimeConfig?.features),
      signal,
    };
    const dynamicTools = this.options.toolExecutor.dynamicToolsForThread(threadId);
    // Tool follow-ups must reflect Goal mutations committed earlier in the same turn.
    const goalControl = this.options.goalControl();
    const stepGoal = await goalControl.getGoal(threadId).catch((error) => {
      // A broken optional Goal projection must not take ordinary Core turns down with it.
      // Goal turns still fail closed because continuing without their state would change semantics.
      if (taskKind === 'goal') throw error;
      return null;
    });
    const goalCompletionPending = Boolean(
      stepGoal
      && goalControl.isCompletionPending(turnId, stepGoal.id),
    );
    const goalTools = goalControl.toolDefinitions(stepGoal, goalCompletionPending);
    const collaborationControl = this.options.collaborationControl();
    const collaborationTools = collaborationControl.toolDefinitions(stepRuntimeConfig);
    const toolRouter = this.options.toolHost && toolAccess !== 'none'
      ? await RuntimeToolRouter.create({
          toolHost: this.options.toolHost,
          orchestrator: this.options.toolExecutor.toolOrchestratorFor(toolContext, stepRuntimeConfig),
          context: toolContext,
          approvalPolicy: stepRuntimeConfig?.approvalPolicy ?? 'on-request',
          ...(toolAccess === 'read-only' ? { allowTool: (tool: RuntimeToolDefinition) => isReviewReadOnlyTool(tool.name) } : {}),
          strictApprovalRequiresSerial: Boolean(this.options.approvalGate && (stepRuntimeConfig?.approvalPolicy ?? 'on-request') === 'strict'),
          toolResultStore: this.options.toolResultStore,
          // deferred 激活按 turn 保持,新的 sampling step 恢复上一 step 的加载集合。
          loadedDeferredToolNames: this.deferredActivationNames(turnId),
          onDeferredActivated: (names) => this.recordDeferredActivation(turnId, names),
        })
      : null;
    const availableTools = toolAccess === 'none'
      ? undefined
      : modelFacingTools(
          toolRouter?.tools,
          dynamicTools,
          collaborationTools,
          goalTools,
          toolRouter?.loadedDeferredToolNames(),
          toolRouter?.catalogToolDefinitions,
        );
    const sideConversation = (snapshotThread ?? thread).kind === 'side';
    const scopedTools = sideConversation
      ? availableTools?.filter((tool) => (
          !collaborationControl.isToolName(tool.name) && !goalControl.isToolName(tool.name)
        ))
      : availableTools;
    const tools = toolAccess === 'read-only'
      ? scopedTools?.filter((tool) => (
          isReviewReadOnlyTool(tool.name) || RUNTIME_PROVIDED_TOOL_NAMES.has(tool.name)
        ))
      : scopedTools;
    const advertisedToolNames = tools?.map((tool) => tool.name) ?? [];
    const toolRuntimes = await samplingToolRuntimes(
      tools ?? [],
      toolRouter,
      dynamicTools,
      collaborationTools,
      goalTools,
    );
    const contextBudget = contextCompactionBudgetForConfig(stepRuntimeConfig, samplingModel.model);
    const persistentContextBudget = taskKind === 'review'
      ? contextCompactionBudgetForConfig(stepRuntimeConfig, turnModel?.model)
      : contextBudget;
    const promptContext = await this.promptContexts.build({
      config: stepRuntimeConfig,
      hookContextMessages: [
        ...(taskKind === 'goal' && stepGoal?.status === 'active' && !goalCompletionPending
          ? goalControl.continuationContextMessages(stepGoal)
          : []),
        ...hookContextMessages,
        ...(attachmentContext.contextMessage ? [attachmentContext.contextMessage] : []),
      ],
      responseLanguage,
      skillCatalogContextWindowTokens: contextBudget?.maxContextTokens,
      skillActivationText: currentTurnSkillActivationText(orderedConversationMessages, turnId),
      skillIds,
      thread,
      toolContext,
      toolRouter,
      tools: tools ?? [],
      // 权限与工具安全规则基于完整允许目录,不随 tool_search 结果变化。
      catalogTools: toolRouter?.catalogToolDefinitions ?? tools ?? [],
    });
    const fragments = promptContext.fragments;
    const transientPrompt = compileRuntimePrompt({ fragments, conversationMessages: [], createdAt: this.options.clock.now().toISOString() });
    const reservedOutputTokens = reservedOutputTokensForConfig(stepRuntimeConfig, samplingModel.model);
    const reservedTokens = estimateRuntimeMessageTokens(transientPrompt.messages)
      + estimateRuntimeToolDefinitionTokens(tools)
      + reservedOutputTokens;
    const persistentConversationMessages = await this.options.contextCompactor.compactMessagesBeforeModelRequest({
      contextBudget: persistentContextBudget,
      conversationModel: turnModel
        ? {
            providerId: turnModel.binding.providerId,
            model: turnModel.binding.modelCode,
          }
        : samplingModel.request,
      force: false,
      messages: orderedConversationMessages,
      reservedTokens,
      runtimeConfig: stepRuntimeConfig,
      signal,
      thread,
      threadId,
      turnId,
    });
    const compactedConversationMessages = taskKind === 'review'
      ? fitRuntimeMessagesToContextBudget({
          budget: contextBudget,
          messages: persistentConversationMessages,
          reservedTokens,
        })
      : persistentConversationMessages;
    const providerConversationMessages = await messagesForModel(compactedConversationMessages, {
      resolvedAttachments: attachmentContext.resolvedAttachments,
      supportsImages: activeModelSupportsImages,
    });
    const compiledPrompt = compileRuntimePrompt({
      fragments,
      conversationMessages: providerConversationMessages,
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
      ...(turnModel ? { modelBinding: { ...turnModel.binding } } : {}),
      conversationMessageIds: compactedConversationMessages.map((message) => message.id),
      messageIds: messages.map((message) => message.id),
      inputMessageIds: samplingInputMessageIds(messages, turnId),
      toolNames: advertisedToolNames,
      advertisedToolNames,
      toolRuntimes,
      ...(toolRouter?.deferredCatalogSize() !== undefined && toolRouter.deferredCatalogSize() > 0
        ? { deferredToolCatalogSize: toolRouter.deferredCatalogSize() }
        : {}),
      ...(toolRouter?.loadedDeferredToolNames().length
        ? { loadedDeferredToolNames: toolRouter.loadedDeferredToolNames() }
        : {}),
      ...toolResultTokenTelemetry(modelRequestMessages(messages)),
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
        budget: contextBudget,
      }),
      promptManifest: compiledPrompt.manifest,
      featureKeys: Object.keys(toolContext.features ?? {}).sort(),
      worldState: {
        ...(stepRuntimeConfig?.activeProviderId ? { activeProviderId: stepRuntimeConfig.activeProviderId } : {}),
        ...(stepRuntimeConfig?.configPath ? { configPath: stepRuntimeConfig.configPath } : {}),
        ...(stepRuntimeConfig?.dataPath ? { dataPath: stepRuntimeConfig.dataPath } : {}),
        threadMessageCount: snapshotThread?.messageCount ?? thread.messageCount,
        threadUpdatedAt: snapshotThread?.updatedAt ?? thread.updatedAt,
      },
    };
    return {
      conversationMessages: compactedConversationMessages,
      messages,
      modelRequest: samplingModel.request,
      ...(normalizedConversation.warnings.length
        ? { modelHistoryWarnings: normalizedConversation.warnings }
        : {}),
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

  private deferredActivationNames(turnId: string): string[] {
    return [...(this.deferredActivations.get(turnId) ?? [])];
  }

  private recordDeferredActivation(turnId: string, names: string[]): void {
    if (!names.length) return;
    const existing = this.deferredActivations.get(turnId) ?? new Set<string>();
    for (const name of names) existing.add(name);
    this.deferredActivations.set(turnId, existing);
  }
}

/**
 * 汇总本次请求 tool 消息中被截断结果的可视/原始 token 遥测,便于判断
 * 上下文成本下降来自工具定义减少还是结果裁剪。
 */
function toolResultTokenTelemetry(messages: RuntimeMessage[]): {
  toolResultOriginalTokens?: number;
  toolResultVisibleTokens?: number;
} {
  let original = 0;
  let visible = 0;
  for (const message of messages) {
    const ref = message.toolResultRef;
    if (!ref) continue;
    original += ref.originalEstimatedTokens;
    visible += ref.visibleTokens;
  }
  return {
    ...(original > 0 ? { toolResultOriginalTokens: original } : {}),
    ...(visible > 0 ? { toolResultVisibleTokens: visible } : {}),
  };
}

function goalExecutionForTurn({
  messages,
  modelSelection,
  skillIds,
  thinkingOptions,
  turnId,
}: {
  messages: RuntimeMessage[];
  modelSelection?: RuntimeThreadGoalExecutionOptions['modelSelection'];
  skillIds: string[];
  thinkingOptions: Pick<ModelRequest, 'thinking' | 'reasoningEffort'> | undefined;
  turnId: string;
}): RuntimeThreadGoalExecutionOptions | undefined {
  const sourceMessage = messages.find((message) => (
    message.turnId === turnId
    && message.role === 'user'
    && message.visibility !== 'model'
  ));
  if (!sourceMessage) return undefined;
  const thinking = thinkingOptions?.thinking === true;
  return {
    attachments: sourceMessage.attachments
      ?.filter(isRuntimeInputMessageAttachment)
      .map((attachment) => ({ ...attachment })),
    modelSelection: modelSelection ? { ...modelSelection } : undefined,
    sourceMessageId: sourceMessage.id,
    skillIds: skillIds.length ? [...skillIds] : undefined,
    skillReferences: cloneRuntimeSkillReferences(sourceMessage.skillReferences),
    thinking,
    thinkingEffort: thinking ? thinkingOptions?.reasoningEffort : undefined,
  };
}

function runtimeToolFeatureFlags(
  features: Record<string, boolean> | undefined,
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(features ?? {}),
  );
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

function reservedOutputTokensForConfig(
  config: RuntimeConfigState | null | undefined,
  modelOverride?: RuntimeConfigState['providers'][number]['models'][number],
): number {
  const activeModel = modelOverride ?? activeModelForConfig(config);
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

function samplingModelForTask(
  config: RuntimeConfigState | null | undefined,
  taskKind: RuntimeTaskKind,
  turnModel?: RuntimeResolvedTurnModel,
): {
  model: RuntimeConfigState['providers'][number]['models'][number] | undefined;
  request: Pick<ModelRequest, 'model' | 'providerId'>;
} {
  const activeModel = activeModelForConfig(config);
  if (taskKind !== 'review') {
    if (turnModel) {
      return {
        model: turnModel.model,
        request: {
          providerId: turnModel.binding.providerId,
          model: turnModel.binding.modelCode,
        },
      };
    }
    return {
      model: activeModel,
      request: { model: 'local-runtime-smoke' },
    };
  }

  const request = runtimeTaskModelRequest(
    config,
    'review',
    'local-runtime-smoke',
    turnModel
      ? {
          providerId: turnModel.binding.providerId,
          model: turnModel.binding.modelCode,
        }
      : undefined,
  );
  const reference = config?.taskModels?.review;
  const provider = request.providerId && reference
    ? config?.providers.find((item) => item.id === request.providerId && item.enabled)
    : undefined;
  const model = turnModel && request.providerId === turnModel.binding.providerId
    && request.model === turnModel.binding.modelCode
    ? turnModel.model
    : provider && reference
      ? provider.models.find((item) => item.id === reference.modelId && item.code.trim() === request.model)
      : undefined;
  return { model: model ?? activeModel, request };
}

function positiveSetting(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
