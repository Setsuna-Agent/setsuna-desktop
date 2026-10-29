import { ContextTokenCalibration } from '../context/context-token-calibration.js';
import {
  normalizeRuntimeSkillReferences,
  type RuntimeEnvironment,
  type RuntimeMemoryCitation,
  type RuntimeMessage,
  type RuntimeToolCall,
  type RuntimeUsage,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { ExtensionRuntime } from '../../ports/extension-runtime.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { ToolExecutionContext, ToolHost, ToolTurnCleanupOutcome } from '../../ports/tool-host.js';
import type { CollaborationControl } from '@setsuna-desktop/feature-collaboration/contracts';
import type { MemoryControl } from '@setsuna-desktop/feature-memory/contracts';
import type {
  ThreadTitleGenerationControl,
} from '@setsuna-desktop/feature-thread-title-generation/contracts';
import { HookStoppedTurnError } from '../context/runtime-context-compactor.js';
import {
  inferRuntimeResponseLanguage,
  requestedRuntimeResponseLanguage,
  resolveRuntimeResponseLanguage,
} from '../context/runtime-response-language.js';
import type { RuntimeHookCoordinator } from '../lifecycle/runtime-hook-coordinator.js';
import type { RuntimeTurnFinalizer } from '../lifecycle/runtime-turn-finalizer.js';
import type { RuntimeTurnInputCoordinator } from '../lifecycle/runtime-turn-input-coordinator.js';
import type { RuntimeTurnTerminationCoordinator } from '../lifecycle/runtime-turn-termination-coordinator.js';
import type { RuntimeQueuedSteer } from '../lifecycle/turn-input-queue.js';
import type { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import type { RuntimeToolCallExecutor } from '../tools/runtime-tool-call-executor.js';
import type { RuntimeModelSampler } from './runtime-model-sampler.js';
import { assertNewToolCallBatchInvariants } from './runtime-model-message-order.js';
import type { RuntimeSamplingContextBuilder } from './runtime-sampling-context-builder.js';
import { isAbortError, throwIfAborted } from './runtime-turn-errors.js';
import type { RuntimeTurnExecutionInput } from './runtime-turn-run-factory.js';
import { addRuntimeUsage } from './runtime-usage.js';
import { runtimeConfigForTurn } from './runtime-turn-policy.js';

type RuntimeAgentTurnRunnerOptions = {
  goalCompletionBlockReason(threadId: string, turnId: string): Promise<string | null>;
  clock: Clock;
  collaborationControl(): CollaborationControl;
  memoryControl(): MemoryControl;
  configStore?: ConfigStore;
  hooks: Pick<RuntimeHookCoordinator, 'runStopHooks' | 'runTurnStartHooks' | 'stopContinuationMessages'>;
  ids: IdGenerator;
  modelSampler: Pick<RuntimeModelSampler, 'sample'>;
  samplingContexts: Pick<RuntimeSamplingContextBuilder, 'build'>;
  threadTitleGeneration(): Pick<ThreadTitleGenerationControl, 'start'>;
  toolExecutor: Pick<RuntimeToolCallExecutor, 'cleanupTurn' | 'runToolCalls'>;
  toolHost?: ToolHost;
  turnFinalizer: Pick<RuntimeTurnFinalizer, 'finish' | 'publishReviewModeMessage'>;
  turnInputs: Pick<RuntimeTurnInputCoordinator, 'drainMailboxMessages' | 'drainSteers'>;
  turnTasks: Pick<RuntimeTurnTaskRegistry, 'stopAcceptingSteers' | 'taskFor'>;
  turnTermination: Pick<RuntimeTurnTerminationCoordinator, 'publishCancelledOnce'>;
  extensions?: Pick<ExtensionRuntime, 'dispatch'>;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
  completeMessage(
    threadId: string,
    turnId: string,
    messageId: string,
    payload: {
      content?: string;
      phase: NonNullable<RuntimeMessage['phase']>;
      usage?: RuntimeUsage;
      toolCalls?: RuntimeToolCall[];
      memoryCitation?: RuntimeMemoryCitation;
      providerMetadata?: RuntimeMessage['providerMetadata'];
    },
  ): Promise<void>;
  publishAssistantDelta(threadId: string, turnId: string, messageId: string, text: string): Promise<void>;
  publishAssistantItemDelta(threadId: string, turnId: string, messageId: string, text: string): Promise<void>;
  publishMessage(
    threadId: string,
    turnId: string,
    message: RuntimeMessage,
    options?: { queuedInputId?: string },
  ): Promise<void>;
};


export class RuntimeAgentTurnRunner {
  constructor(private readonly options: RuntimeAgentTurnRunnerOptions) {}

  async run({
    attachments,
    options = {},
    samplingModel,
    signal,
    skillIds,
    skillReferences,
    text,
    thinkingOptions = {},
    thread,
    threadId,
    turnModel,
    turnId,
  }: RuntimeTurnExecutionInput): Promise<void> {
    const createdAt = this.options.clock.now().toISOString();
    let activeAssistantMessageId: string | null = null;
    const publishUserMessage = options.publishUserMessage !== false;
    // Direct ordinary resumes keep delegated provenance; explicit review/goal modes keep their own policy.
    const taskKind = (options.taskKind === undefined || options.taskKind === 'regular')
      && thread.kind !== 'side' && thread.parentThreadId ? 'subagent' : options.taskKind ?? 'regular';
    const selectedSkillIds = [...new Set(skillIds.map((skillId) => skillId.trim()).filter(Boolean))];
    const selectedSkillReferences = normalizeRuntimeSkillReferences({
      content: text,
      references: skillReferences,
      skillIds: selectedSkillIds,
    });
    const userMessage: RuntimeMessage = options.userMessage ?? {
      id: this.options.ids.id('msg'),
      clientId: options.clientId,
      turnId,
      role: 'user',
      inputKind: taskKind === 'subagent' && !options.userInitiated ? 'subagent_task' : options.inputKind,
      promptSource: taskKind === 'subagent' && !options.userInitiated ? 'collaboration' : options.promptSource,
      content: text,
      skillIds: selectedSkillIds.length ? selectedSkillIds : undefined,
      skillReferences: selectedSkillReferences.length ? selectedSkillReferences : undefined,
      attachments,
      createdAt,
      status: 'complete',
    };
    // Regeneration keeps the message ID, but compaction must recognize its input
    // as part of the current execution rather than the original turn's history.
    let modelUserMessage: RuntimeMessage = {
      ...userMessage,
      turnId,
      content: options.modelInput || userMessage.content,
    };
    const includeUserMessageInConversation = publishUserMessage || options.includeUserMessageInModel === true;
    let runtimeConfig = runtimeConfigForTurn(await this.options.configStore?.getConfig().catch(() => null), options.unattended);
    let responseLanguage = resolveRuntimeResponseLanguage({
      currentUserContent: publishUserMessage && !userMessage.promptSource
        ? userMessage.content
        : taskKind === 'subagent'
          ? userMessage.content
          : undefined,
      conversationMessages: thread.messages,
      // 审查沿用用户请求的语言，界面语言只作为兜底；普通对话跟随已选界面语言。
      fallback: options.review?.language ?? 'zh-CN',
      interfaceLanguage: taskKind === 'review' ? undefined : runtimeConfig?.desktopSettings?.interfaceLanguage ?? 'zh-CN',
    });
    let activeSkillIds = [...selectedSkillIds];
    let activeThinkingOptions = thinkingOptions;
    const runningTask = this.options.turnTasks.taskFor(threadId, turnId);
    if (runningTask) runningTask.thinkingOptions = activeThinkingOptions;

    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.started',
      createdAt,
      payload: {
        input: text,
        taskKind,
        ...(turnModel ? { modelBinding: { ...turnModel.binding } } : {}),
      },
    });
    if (publishUserMessage) {
      await this.options.publishMessage(threadId, turnId, userMessage, {
        queuedInputId: options.queuedInputId,
      });
    }
    if (options.review) await this.options.turnFinalizer.publishReviewModeMessage(threadId, turnId, 'entered', options.review.displayText);
    let usage: RuntimeUsage | undefined;
    let cleanupStatus: ToolTurnCleanupOutcome['status'] = 'completed';
    let cleanupEnvironment: RuntimeEnvironment | undefined;
    let settledContent: string | undefined;
    try {
      const turnStartHooks = await this.options.hooks.runTurnStartHooks({
        unattended: options.unattended,
        prompt: options.modelInput ?? text,
        runtimeConfig,
        signal,
        thread,
        turnId,
      });
      if (turnStartHooks.stopped) {
        settledContent = turnStartHooks.reason;
        this.options.turnTasks.stopAcceptingSteers(threadId, turnId);
        await this.options.publishMessage(threadId, turnId, {
          id: this.options.ids.id('msg'),
          turnId,
          role: 'assistant',
          content: turnStartHooks.reason,
          streamParts: [{ type: 'content', content: turnStartHooks.reason }],
          createdAt: this.options.clock.now().toISOString(),
          status: 'complete',
          phase: 'final_answer',
        });
        await this.options.appendEvent(threadId, {
          id: this.options.ids.id('event'),
          threadId,
          turnId,
          type: 'turn.completed',
          createdAt: this.options.clock.now().toISOString(),
          payload: { taskKind },
        });
        return;
      }
      if (turnStartHooks.prompt !== undefined) {
        modelUserMessage = { ...modelUserMessage, content: turnStartHooks.prompt };
      }
      const additionalContextMessages = [
        ...(options.runtimeContextMessages ?? []),
        ...turnStartHooks.contextMessages,
      ];
      // 标题由 Feature 在后台生成并落盘，不阻塞主回答，也不绑定当前轮次的取消信号。
      void this.options.threadTitleGeneration().start({
        attachmentCount: attachments.length,
        conversationModel: turnModel
          ? {
              providerId: turnModel.binding.providerId,
              model: turnModel.binding.modelCode,
            }
          : undefined,
        taskKind,
        thread,
        turnId,
        userContent: userMessage.content,
      });

      throwIfAborted(signal);
      // SamplingContextBuilder 统一管理单次请求边界，使压缩逻辑能够计入临时提示片段、
      // 工具模式和输出预留空间。
      // Regeneration reuses the stored user message. Replace its model-facing copy in place
      // so the full review prompt (or a hook rewrite) is applied without duplicating the input.
      let conversationMessages = includeUserMessageInConversation
        ? [...thread.messages, modelUserMessage]
        : thread.messages.map((message) => message.id === userMessage.id ? modelUserMessage : message);
      // review turn 展示给用户的是简短文案，发给模型的是完整 review prompt，两者在这里分流。
      runtimeConfig = runtimeConfig ?? await this.options.configStore?.getConfig().catch(() => null);
      let explicitMemoryUserContent = userMessage.content;
      const appendSteersToConversation = (steers: RuntimeQueuedSteer[]) => {
        if (!steers.length) return false;
        const messages = steers.map((steer) => steer.message);
        // 与现有 turn/steer 语义对齐：steer 是同一 turn 的原始用户输入，
        // 不在 runtime 侧改写成额外提示词，只在下一个 sampling step 并入上下文。
        conversationMessages.push(...messages);
        for (const message of messages) {
          responseLanguage = (taskKind !== 'review' && runtimeConfig?.desktopSettings?.interfaceLanguage
            ? requestedRuntimeResponseLanguage(message.content)
            : inferRuntimeResponseLanguage(message.content)) ?? responseLanguage;
        }
        activeSkillIds = [...new Set([...activeSkillIds, ...steers.flatMap((steer) => steer.skillIds)])];
        const thinkingSteer = [...steers].reverse().find((steer) => typeof steer.thinking === 'boolean');
        if (thinkingSteer) {
          activeThinkingOptions = {
            thinking: thinkingSteer.thinking === true,
            ...(thinkingSteer.thinking === true && thinkingSteer.thinkingEffort
              ? { reasoningEffort: thinkingSteer.thinkingEffort }
              : {}),
          };
        }
        const steerText = messages
          .map((message) => message.content.trim())
          .filter(Boolean)
          .join('\n\n');
        if (steerText) explicitMemoryUserContent = [explicitMemoryUserContent, steerText].filter(Boolean).join('\n\n');
        return true;
      };
      const appendMailboxMessagesToConversation = (messages: RuntimeMessage[]) => {
        if (!messages.length) return false;
        conversationMessages.push(...messages);
        return true;
      };
      let memorySavedByTool = false;
      let stopHookActive = false;
      const publishedModelHistoryWarnings = new Set<string>();
      const loadedToolNames = new Set<string>();
      const contextTokenCalibration = new ContextTokenCalibration();

      // 一个 turn 可能包含多段 assistant：工具调用会结束当前段，把 tool 消息补回上下文后再问模型。
      while (true) {
        throwIfAborted(signal);
        appendMailboxMessagesToConversation(await this.options.turnInputs.drainMailboxMessages(threadId, turnId));
        appendSteersToConversation(await this.options.turnInputs.drainSteers(threadId, turnId));
        if (runningTask) runningTask.thinkingOptions = activeThinkingOptions;
        const collaboration = this.options.collaborationControl();
        // Receive child results between model steps even while the parent still has tools to run.
        conversationMessages.push(...await collaboration.collectPendingChildren(threadId, turnId, signal, { wait: false }));
        const stepContext = await this.options.samplingContexts.build({
          loadedToolNames,
          contextTokenCalibration,
          conversationMessages,
          hookContextMessages: additionalContextMessages,
          responseLanguage,
          runtimeConfig,
          unattended: options.unattended,
          signal,
          skillIds: activeSkillIds,
          thinkingOptions: activeThinkingOptions,
          thread,
          threadId,
          taskKind,
          turnId,
          samplingModel,
          turnModel,
          toolAccess: taskKind === 'review' ? 'read-only' : 'all',
        });
        cleanupEnvironment = stepContext.toolContext.environment;
        conversationMessages = stepContext.conversationMessages;
        responseLanguage = stepContext.responseLanguage;
        runtimeConfig = stepContext.runtimeConfig;
        const newModelHistoryWarnings = (stepContext.modelHistoryWarnings ?? [])
          .filter((warning) => !publishedModelHistoryWarnings.has(warning));
        if (newModelHistoryWarnings.length) {
          newModelHistoryWarnings.forEach((warning) => publishedModelHistoryWarnings.add(warning));
          await this.options.appendEvent(threadId, {
            id: this.options.ids.id('event'),
            threadId,
            turnId,
            type: 'model.verification',
            createdAt: this.options.clock.now().toISOString(),
            payload: {
              verification: {
                warnings: newModelHistoryWarnings,
              },
            },
          });
        }

        const sampled = await this.options.modelSampler.sample({
          captureProtocolUsage: true,
          onAssistantStarted: (messageId) => {
            activeAssistantMessageId = messageId;
          },
          signal,
          step: stepContext,
          thinkingOptions: activeThinkingOptions,
          threadId,
          turnId,
        });
        const {
          assistantMessage,
          assistantMessageId,
          memoryCitation: roundMemoryCitation,
          toolCalls,
        } = sampled;
        usage = addRuntimeUsage(usage, sampled.usage);
        contextTokenCalibration.record(stepContext.modelRequest, stepContext.messages, stepContext.tools, sampled.usage);
        let roundText = sampled.text;

        if (toolCalls.length) {
          throwIfAborted(signal);
          assertNewToolCallBatchInvariants(toolCalls);
          // 先把 toolCalls 挂到 assistant 消息上，再执行工具，UI 才能把后续 toolRuns 归到正确气泡。
          await this.options.completeMessage(threadId, turnId, assistantMessageId, {
            content: roundText,
            phase: 'commentary',
            toolCalls,
            usage: sampled.usage,
            memoryCitation: roundMemoryCitation,
            providerMetadata: assistantMessage.providerMetadata,
          });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            phase: 'commentary',
            memoryCitation: roundMemoryCitation,
            toolCalls,
            status: 'complete',
          });
          const execution = await this.options.toolExecutor.runToolCalls(toolCalls, stepContext.toolContext, stepContext.toolRouter, stepContext.runtimeConfig);
          memorySavedByTool ||= execution.memorySavedByTool;
          conversationMessages.push(...execution.messages);
          continue;
        }

        const continueWithInput = async (mailbox: RuntimeMessage[], steers: RuntimeQueuedSteer[]) => {
          await this.options.completeMessage(threadId, turnId, assistantMessageId, { content: roundText, phase: 'commentary', usage: sampled.usage, memoryCitation: roundMemoryCitation, providerMetadata: assistantMessage.providerMetadata });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            phase: 'commentary',
            memoryCitation: roundMemoryCitation,
            status: 'complete',
          });
          appendMailboxMessagesToConversation(mailbox);
          appendSteersToConversation(steers);
        };
        const pendingMailboxMessages = await this.options.turnInputs.drainMailboxMessages(threadId, turnId);
        const pendingSteers = await this.options.turnInputs.drainSteers(threadId, turnId);
        if (pendingMailboxMessages.length || pendingSteers.length) {
          await continueWithInput(pendingMailboxMessages, pendingSteers);
          continue;
        }

        const pendingChildren = await collaboration.pendingChildren(threadId);
        if (pendingChildren.total > 0) {
          await continueWithInput([], []);
          // A child completion or newly queued input wakes this join; the next step drains input.
          conversationMessages.push(...await collaboration.collectPendingChildren(threadId, turnId, signal));
          continue;
        }

        const completionBlock = await this.options.goalCompletionBlockReason(threadId, turnId);
        const stopHookOutcome = completionBlock ? { shouldBlock: true, blockReason: completionBlock } : await this.options.hooks.runStopHooks({
          context: stepContext.toolContext,
          lastAssistantMessage: roundText,
          runtimeConfig,
          stopHookActive,
        });
        if (stopHookOutcome.shouldBlock && stopHookOutcome.blockReason) {
          await this.options.completeMessage(threadId, turnId, assistantMessageId, { content: roundText, phase: 'commentary', usage: sampled.usage, memoryCitation: roundMemoryCitation, providerMetadata: assistantMessage.providerMetadata });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            phase: 'commentary',
            memoryCitation: roundMemoryCitation,
            status: 'complete',
          });
          conversationMessages.push(...this.options.hooks.stopContinuationMessages(stopHookOutcome.blockReason, turnId));
          stopHookActive = true;
          continue;
        }

        this.options.turnTasks.stopAcceptingSteers(threadId, turnId);
        // Close admission before the last drain. Input accepted during ledger/hook awaits
        // belongs to this turn and must not be stranded behind its final answer.
        const finalMailbox = await this.options.turnInputs.drainMailboxMessages(threadId, turnId);
        const finalSteers = await this.options.turnInputs.drainSteers(threadId, turnId);
        if (finalMailbox.length || finalSteers.length) {
          const task = this.options.turnTasks.taskFor(threadId, turnId);
          if (task) task.acceptingSteers = true;
          await continueWithInput(finalMailbox, finalSteers);
          continue;
        }
        settledContent = roundText;
        await this.options.turnFinalizer.finish({
          threadId,
          turnId,
          messageId: assistantMessageId,
          messageUsage: sampled.usage,
          usage,
          finalization: {
            explicitMemory: taskKind === 'goal' ? undefined : {
              alreadySaved: memorySavedByTool,
              projectId: thread.projectId,
              userContent: explicitMemoryUserContent,
            },
            memoryCitation: roundMemoryCitation,
            providerMetadata: assistantMessage.providerMetadata,
            content: roundText,
            review: options.review ? {
              content: roundText,
              language: responseLanguage,
            } : undefined,
            taskKind,
          },
        });
        activeAssistantMessageId = null;
        break;
      }
    } catch (error) {
      if (error instanceof HookStoppedTurnError) {
        settledContent = error.message;
        if (activeAssistantMessageId) {
          await this.options.completeMessage(threadId, turnId, activeAssistantMessageId, { phase: 'commentary' });
        }
        this.options.turnTasks.stopAcceptingSteers(threadId, turnId);
        await this.options.publishMessage(threadId, turnId, {
          id: this.options.ids.id('msg'),
          turnId,
          role: 'assistant',
          content: error.message,
          streamParts: [{ type: 'content', content: error.message }],
          createdAt: this.options.clock.now().toISOString(),
          status: 'complete',
          phase: 'final_answer',
        });
        await this.options.appendEvent(threadId, {
          id: this.options.ids.id('event'),
          threadId,
          turnId,
          type: 'turn.completed',
          createdAt: this.options.clock.now().toISOString(),
          payload: { taskKind },
        });
        return;
      }
      if (isAbortError(error)) {
        cleanupStatus = 'cancelled';
        settledContent = error instanceof Error ? error.message : 'Turn cancelled.';
        if (activeAssistantMessageId) {
          await this.options.completeMessage(threadId, turnId, activeAssistantMessageId, { phase: 'commentary' });
        }
        await this.options.turnTermination.publishCancelledOnce(
          threadId,
          turnId,
          taskKind,
          error instanceof Error ? error.message : 'Turn cancelled.',
          { marker: true },
        );
        return;
      }
      cleanupStatus = 'failed';
      settledContent = error instanceof Error ? error.message : String(error);
      if (activeAssistantMessageId) {
        await this.options.completeMessage(threadId, turnId, activeAssistantMessageId, { phase: 'commentary' });
        activeAssistantMessageId = null;
      }
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'runtime.error',
        createdAt: this.options.clock.now().toISOString(),
        payload: {
          message: error instanceof Error ? error.message : String(error),
          code: 'turn_failed',
        },
      });
      throw error;
    } finally {
      try {
        // Hooks may end a turn before its normal join. No owned child outlives that boundary.
        await this.options.collaborationControl().cancelChildren(threadId, turnId);
        await this.dispatchTurnSettled(
          thread,
          turnId,
          cleanupStatus,
          settledContent,
          cleanupEnvironment?.cwd,
          runtimeConfig?.features,
          options.unattended,
        );
      } finally {
        try {
          await this.cleanupToolHostTurn({
            ...(options.unattended ? { unattended: true } : {}),
            ...(cleanupEnvironment ? { environment: cleanupEnvironment } : {}),
            threadId,
            projectId: thread.projectId,
            turnId,
          }, { status: cleanupStatus });
        } finally {
          // 轮次级审批只在当前轮次活动期间有效。
          this.options.toolExecutor.cleanupTurn(turnId);
        }
      }
    }
  }

  private async dispatchTurnSettled(
    thread: RuntimeTurnExecutionInput['thread'],
    turnId: string,
    status: ToolTurnCleanupOutcome['status'],
    content?: string,
    cwd?: string,
    features?: Record<string, boolean>,
    unattended?: boolean,
  ): Promise<void> {
    if (!this.options.extensions) return;
    try {
      const outcome = await this.options.extensions.dispatch('turn.settled', {
        ...(unattended ? { unattended: true } : {}),
        threadId: thread.id,
        turnId,
        projectId: thread.projectId,
        cwd,
        ...(features ? { features } : {}),
        payload: { status, ...(content ? { content } : {}) },
      });
      if (!outcome.feedback) return;
      await this.options.appendEvent(thread.id, {
        id: this.options.ids.id('event'),
        threadId: thread.id,
        turnId,
        type: 'runtime.warning',
        createdAt: this.options.clock.now().toISOString(),
        payload: { message: outcome.feedback, code: 'extension_turn_settled' },
      });
    } catch (error) {
      await this.options.appendEvent(thread.id, {
        id: this.options.ids.id('event'),
        threadId: thread.id,
        turnId,
        type: 'runtime.warning',
        createdAt: this.options.clock.now().toISOString(),
        payload: {
          message: error instanceof Error ? error.message : String(error),
          code: 'extension_turn_settled_failed',
        },
      }).catch(() => undefined);
    }
  }

  async cleanupToolHostTurn(context: ToolExecutionContext, outcome: ToolTurnCleanupOutcome): Promise<void> {
    const cleanupTurn = this.options.toolHost?.cleanupTurn;
    if (!cleanupTurn || !context.turnId) return;
    try {
      await cleanupTurn.call(this.options.toolHost, context, outcome);
    } catch (error) {
      await this.options.appendEvent(context.threadId, {
        id: this.options.ids.id('event'),
        threadId: context.threadId,
        turnId: context.turnId,
        type: 'runtime.warning',
        createdAt: this.options.clock.now().toISOString(),
        payload: {
          message: error instanceof Error ? error.message : String(error),
          code: 'tool_cleanup_failed',
        },
      }).catch(() => undefined);
    }
  }
}
