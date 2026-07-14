import type {
  ModelRequest,
  RuntimeConfigState,
  RuntimeMessage,
  RuntimeModelRequestStepSnapshot,
  RuntimeThread,
  RuntimeToolDefinition,
} from '@setsuna-desktop/contracts';
import type { ApprovalGate } from '../ports/approval-gate.js';
import type { Clock } from '../ports/clock.js';
import type { ConfigStore } from '../ports/config-store.js';
import type { McpStore } from '../ports/mcp-store.js';
import type { ProjectInstructionLoader } from '../ports/project-instruction-loader.js';
import type { RuntimeEnvironmentResolver } from '../ports/runtime-environment-resolver.js';
import type { SkillRegistry } from '../ports/skill-registry.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { RuntimeToolExecutionContext, ToolHost } from '../ports/tool-host.js';
import { compileRuntimePrompt } from './prompt-compiler.js';
import type { RuntimeMemoryCoordinator } from './runtime-memory-coordinator.js';
import type { RuntimeToolCallExecutor } from './runtime-tool-call-executor.js';
import {
  contextCompactionBudgetForConfig,
  samplingContextWindowForRequest,
  samplingInputMessageIds,
} from './runtime-context-compactor.js';
import type { RuntimeContextCompactor } from './runtime-context-compactor.js';
import { CONTEXT_COMPACTION_MAX_TOKENS, estimateRuntimeMessageTokens, estimateRuntimeToolDefinitionTokens } from './context-compaction.js';
import { modelFacingTools, samplingToolRuntimes } from './agent-loop-tool-utils.js';
import { RuntimePromptContextAssembler } from './runtime-prompt-context-assembler.js';
import { isReviewReadOnlyTool } from './runtime-review-profile.js';
import { RuntimeToolRouter } from './tool-router.js';

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
  clock: Clock;
  configStore?: ConfigStore;
  contextCompactor: Pick<RuntimeContextCompactor, 'compactMessagesBeforeModelRequest'>;
  environmentResolver: RuntimeEnvironmentResolver;
  mcpStore?: Pick<McpStore, 'listServerInputs'>;
  memory: Pick<RuntimeMemoryCoordinator, 'contextMessages'>;
  projectInstructions?: ProjectInstructionLoader;
  skillRegistry?: SkillRegistry;
  threadStore: ThreadStore;
  toolExecutor: Pick<
    RuntimeToolCallExecutor,
    | 'dynamicToolsForThread'
    | 'revealDeferredToolsForTurn'
    | 'revealedDeferredToolNamesForTurn'
    | 'toolOrchestratorFor'
  >;
  toolHost?: ToolHost;
};

/**
 * Builder for a single immutable model-sampling step.
 *
 * AgentLoop owns when a step is captured; this builder owns how provider
 * config, compaction, tools, memory, skills and world-state become one request.
 */
export class RuntimeSamplingContextBuilder {
  private readonly promptContexts: RuntimePromptContextAssembler;

  constructor(private readonly options: RuntimeSamplingContextBuilderOptions) {
    this.promptContexts = new RuntimePromptContextAssembler({
      memory: options.memory,
      projectInstructions: options.projectInstructions,
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
    const latestRuntimeConfig = await this.options.configStore?.getConfig().catch(() => null);
    const stepRuntimeConfig = latestRuntimeConfig ?? runtimeConfig ?? null;
    const environment = await this.options.environmentResolver.resolve({
      projectId: thread.projectId,
      threadId,
    });
    const toolContext: RuntimeToolExecutionContext = {
      environment,
      threadId,
      projectId: thread.projectId,
      turnId,
      permissionProfile: stepRuntimeConfig?.permissionProfile ?? 'workspace-write',
      sandboxWorkspaceWrite: stepRuntimeConfig?.sandboxWorkspaceWrite ?? {},
      features: stepRuntimeConfig?.features ?? {},
      signal,
    };
    const dynamicTools = this.options.toolExecutor.dynamicToolsForThread(threadId);
    const revealedDeferredToolNames = this.options.toolExecutor.revealedDeferredToolNamesForTurn(turnId);
    const toolRouter = this.options.toolHost && toolAccess !== 'none'
      ? await RuntimeToolRouter.create({
          toolHost: this.options.toolHost,
          orchestrator: this.options.toolExecutor.toolOrchestratorFor(toolContext, stepRuntimeConfig),
          context: toolContext,
          approvalPolicy: stepRuntimeConfig?.approvalPolicy ?? 'on-request',
          additionalDeferredTools: dynamicTools?.filter((tool) => tool.deferLoading),
          ...(toolAccess === 'read-only' ? { allowTool: (tool: RuntimeToolDefinition) => isReviewReadOnlyTool(tool.name) } : {}),
          revealedDeferredToolNames,
          revealDeferredTools: (names) => this.options.toolExecutor.revealDeferredToolsForTurn(turnId, names),
          strictApprovalRequiresSerial: Boolean(this.options.approvalGate && (stepRuntimeConfig?.approvalPolicy ?? 'on-request') === 'strict'),
        })
      : null;
    const threadHasGoal = Boolean(thread.goal);
    const availableTools = toolAccess === 'none'
      ? undefined
      : modelFacingTools(toolRouter?.tools, stepRuntimeConfig, dynamicTools, revealedDeferredToolNames, threadHasGoal);
    const tools = toolAccess === 'read-only'
      ? availableTools?.filter((tool) => isReviewReadOnlyTool(tool.name))
      : availableTools;
    const advertisedToolNames = tools?.map((tool) => tool.name) ?? [];
    const toolRuntimes = await samplingToolRuntimes(tools ?? [], toolRouter, dynamicTools, stepRuntimeConfig, threadHasGoal);
    const promptContext = await this.promptContexts.build({
      config: stepRuntimeConfig,
      hookContextMessages,
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
      messages: conversationMessages,
      reservedTokens,
      runtimeConfig: stepRuntimeConfig,
      signal,
      thread,
      threadId,
      turnId,
    });
    const compiledPrompt = compileRuntimePrompt({
      fragments,
      conversationMessages: compactedConversationMessages,
      createdAt: this.options.clock.now().toISOString(),
    });
    const messages = compiledPrompt.messages;
    const toolChoice = tools?.length ? (await toolRouter?.toolChoice(messages) ?? 'auto') : undefined;
    const snapshotThread = await this.options.threadStore.getThread(threadId).catch(() => null);
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
      deferredToolNames: toolRouter?.deferredToolNames() ?? [],
      routerToolNames: toolRouter?.routerOwnedToolNames() ?? [],
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

function modelRequestMessages(messages: RuntimeMessage[]): RuntimeMessage[] {
  return messages.filter((message) => message.visibility !== 'transcript');
}

function reservedOutputTokensForConfig(config: RuntimeConfigState | null | undefined): number {
  const activeProvider = config?.providers.find((provider) => provider.id === config.activeProviderId && provider.enabled)
    ?? config?.providers.find((provider) => provider.enabled)
    ?? config?.providers[0];
  const activeModel = activeProvider?.models.find((model) => model.enabled) ?? activeProvider?.models[0];
  const maxContextTokens = positiveSetting(
    activeModel?.contextWindowTokens
      ?? config?.desktopSettings?.modelContextWindow
      ?? config?.desktopSettings?.model_context_window,
  ) ?? CONTEXT_COMPACTION_MAX_TOKENS;
  const configuredOutputTokens = Math.max(0, Math.floor(activeModel?.maxOutputTokens ?? 0));
  return Math.min(configuredOutputTokens, Math.floor(maxContextTokens * OUTPUT_RESERVE_CONTEXT_RATIO));
}

function positiveSetting(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}
