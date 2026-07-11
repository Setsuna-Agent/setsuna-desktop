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
import type { SkillRegistry } from '../ports/skill-registry.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { RuntimeToolExecutionContext, ToolHost } from '../ports/tool-host.js';
import { escapeSkillAttribute, neutralizePersonalizationTags, neutralizeSkillTags } from './prompt-utils.js';
import type { RuntimeMemoryCoordinator } from './runtime-memory-coordinator.js';
import type { RuntimeToolCallExecutor } from './runtime-tool-call-executor.js';
import {
  contextCompactionBudgetForConfig,
  samplingContextWindowForMessages,
  samplingInputMessageIds,
} from './runtime-context-compactor.js';
import type { RuntimeContextCompactor } from './runtime-context-compactor.js';
import { modelFacingTools, samplingToolRuntimes } from './agent-loop-tool-utils.js';
import { RuntimeToolRouter } from './tool-router.js';

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
  mcpStore?: Pick<McpStore, 'listServerInputs'>;
  memory: Pick<RuntimeMemoryCoordinator, 'contextMessages'>;
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
  constructor(private readonly options: RuntimeSamplingContextBuilderOptions) {}

  async build({
    conversationMessages,
    hookContextMessages,
    runtimeConfig,
    signal,
    skillIds,
    thread,
    threadId,
    turnId,
  }: {
    conversationMessages: RuntimeMessage[];
    hookContextMessages: RuntimeMessage[];
    runtimeConfig: RuntimeConfigState | null | undefined;
    signal: AbortSignal;
    skillIds: string[];
    thread: RuntimeThread;
    threadId: string;
    turnId: string;
  }): Promise<RuntimeSamplingStepContext> {
    const latestRuntimeConfig = await this.options.configStore?.getConfig().catch(() => null);
    const stepRuntimeConfig = latestRuntimeConfig ?? runtimeConfig ?? null;
    const compactedConversationMessages = await this.options.contextCompactor.compactMessagesBeforeModelRequest({
      force: false,
      messages: conversationMessages,
      runtimeConfig: stepRuntimeConfig,
      signal,
      thread,
      threadId,
      turnId,
    });
    const toolContext: RuntimeToolExecutionContext = {
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
    const toolRouter = this.options.toolHost
      ? await RuntimeToolRouter.create({
          toolHost: this.options.toolHost,
          orchestrator: this.options.toolExecutor.toolOrchestratorFor(toolContext, stepRuntimeConfig),
          context: toolContext,
          approvalPolicy: stepRuntimeConfig?.approvalPolicy ?? 'on-request',
          additionalDeferredTools: dynamicTools?.filter((tool) => tool.deferLoading),
          revealedDeferredToolNames,
          revealDeferredTools: (names) => this.options.toolExecutor.revealDeferredToolsForTurn(turnId, names),
          strictApprovalRequiresSerial: Boolean(this.options.approvalGate && (stepRuntimeConfig?.approvalPolicy ?? 'on-request') === 'strict'),
        })
      : null;
    const threadHasGoal = Boolean(thread.goal);
    const tools = modelFacingTools(toolRouter?.tools, stepRuntimeConfig, dynamicTools, revealedDeferredToolNames, threadHasGoal);
    const advertisedToolNames = tools?.map((tool) => tool.name) ?? [];
    const toolRuntimes = await samplingToolRuntimes(tools ?? [], toolRouter, dynamicTools, stepRuntimeConfig, threadHasGoal);
    const skillContext = await this.skillContextMessages(skillIds);
    // Prompt ordering is intentional: durable policy -> temporary capabilities -> current conversation.
    const messages: RuntimeMessage[] = [
      ...this.personalizationContextMessages(stepRuntimeConfig),
      ...(await this.options.memory.contextMessages(thread.projectId, stepRuntimeConfig)),
      ...(await this.toolSystemPromptMessages(toolContext, toolRouter)),
      ...skillContext.messages,
      ...hookContextMessages,
      ...compactedConversationMessages,
    ];
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
      toolEnvironment: toolRouter?.environment ?? null,
      selectedSkills: skillContext.selectedSkills,
      mcpServerKeys,
      mcpServerCount: mcpServerKeys.length,
      permissionProfile: toolContext.permissionProfile,
      ...(toolContext.sandboxWorkspaceWrite ? { sandboxWorkspaceWrite: toolContext.sandboxWorkspaceWrite } : {}),
      contextWindow: samplingContextWindowForMessages(modelRequestMessages(messages), contextCompactionBudgetForConfig(stepRuntimeConfig)),
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

  private async skillContextMessages(skillIds: string[]): Promise<{
    messages: RuntimeMessage[];
    selectedSkills: RuntimeModelRequestStepSnapshot['selectedSkills'];
  }> {
    const injections = await this.options.skillRegistry?.selectedSkillInjections(skillIds);
    if (!injections?.length) return { messages: [], selectedSkills: [] };
    const messages = injections.map((skill) => ({
      id: `skill_${skill.id}`,
      role: 'system' as const,
      content: `<skill name="${escapeSkillAttribute(skill.name)}" id="${escapeSkillAttribute(skill.id)}">\n${neutralizeSkillTags(skill.content)}\n</skill>`,
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete' as const,
    }));
    return {
      messages,
      selectedSkills: injections.map((skill) => ({ id: skill.id, name: skill.name })),
    };
  }

  private async toolSystemPromptMessages(context: RuntimeToolExecutionContext, toolRouter: RuntimeToolRouter | null): Promise<RuntimeMessage[]> {
    const prompt = toolRouter ? await toolRouter.systemPrompt() : await this.options.toolHost?.systemPrompt?.(context);
    if (typeof prompt !== 'string' || !prompt.trim()) return [];
    return [{
      id: 'desktop_local_tool_rules',
      role: 'system',
      content: prompt.trim(),
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
    }];
  }

  private personalizationContextMessages(config: RuntimeConfigState | null | undefined): RuntimeMessage[] {
    if (!config) return [];
    const globalPrompt = config.globalPrompt.trim();
    const styleInstruction = config.setsunaStyle === 'daily'
      ? 'Setsuna style: use a more everyday, conversational tone. Be warm, lightweight, and practical; do not over-index on code unless the user asks for development work.'
      : 'Setsuna style: use a development-oriented tone. Prioritize concrete engineering judgment, repo evidence, implementation steps, and validation when code changes are involved.';
    return [{
      id: 'desktop_personalization',
      role: 'system',
      content: [
        'Desktop personalization:',
        'Apply these user preferences when they do not conflict with higher-priority instructions, desktop runtime rules, or the current user request.',
        styleInstruction,
        globalPrompt ? `User global prompt:\n${neutralizePersonalizationTags(globalPrompt)}` : '',
      ].filter(Boolean).join('\n'),
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
    }];
  }
}

function modelRequestMessages(messages: RuntimeMessage[]): RuntimeMessage[] {
  return messages.filter((message) => message.visibility !== 'transcript');
}
