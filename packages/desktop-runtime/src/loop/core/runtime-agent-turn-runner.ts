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

type RuntimeAgentTurnRunnerOptions = {
  clock: Clock;
  collaborationControl(): CollaborationControl;
  memoryControl(): MemoryControl;
  configStore?: ConfigStore;
  hooks: Pick<RuntimeHookCoordinator, 'runStopHooks' | 'runTurnStartHooks' | 'stopContinuationMessages'>;
  ids: IdGenerator;
  modelSampler: Pick<RuntimeModelSampler, 'sample'>;
  samplingContexts: Pick<RuntimeSamplingContextBuilder, 'build' | 'cleanupTurn'>;
  threadTitleGeneration(): Pick<ThreadTitleGenerationControl, 'start'>;
  toolExecutor: Pick<RuntimeToolCallExecutor, 'cleanupTurn' | 'runToolCalls'>;
  toolHost?: ToolHost;
  turnFinalizer: Pick<RuntimeTurnFinalizer, 'finish' | 'publishReviewModeMessage'>;
  turnInputs: Pick<RuntimeTurnInputCoordinator, 'drainMailboxMessages' | 'drainSteers'>;
  turnTasks: Pick<RuntimeTurnTaskRegistry, 'stopAcceptingSteers'>;
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

const COLLABORATION_WAIT_NOTE = '\n\n子线程仍在执行；主任务会继续等待，收到调研结果后再统一收口。';

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
    const taskKind = options.taskKind ?? 'regular';
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
      inputKind: options.inputKind,
      promptSource: options.promptSource,
      content: text,
      skillIds: selectedSkillIds.length ? selectedSkillIds : undefined,
      skillReferences: selectedSkillReferences.length ? selectedSkillReferences : undefined,
      attachments,
      createdAt,
      status: 'complete',
    };
    let modelUserMessage: RuntimeMessage = options.modelInput ? { ...userMessage, content: options.modelInput } : userMessage;
    const includeUserMessageInConversation = publishUserMessage || options.includeUserMessageInModel === true;
    let runtimeConfig = await this.options.configStore?.getConfig().catch(() => null);
    let responseLanguage = options.review?.language ?? resolveRuntimeResponseLanguage({
      currentUserContent: publishUserMessage && !userMessage.promptSource
        ? userMessage.content
        : taskKind === 'subagent'
          ? userMessage.content
          : undefined,
      conversationMessages: thread.messages,
      fallback: runtimeConfig?.desktopSettings?.interfaceLanguage ?? 'zh-CN',
    });
    let activeSkillIds = [...selectedSkillIds];
    let activeThinkingOptions = thinkingOptions;

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
      // 标题请求与主回答并行，避免额外增加首轮回复延迟；失败时首条消息投影已经提供 fallback。
      const threadTitleGeneration = this.options.threadTitleGeneration().start({
        attachmentCount: attachments.length,
        conversationModel: turnModel
          ? {
              providerId: turnModel.binding.providerId,
              model: turnModel.binding.modelCode,
            }
          : undefined,
        signal,
        taskKind,
        thread,
        userContent: userMessage.content,
      });

      throwIfAborted(signal);
      // SamplingContextBuilder 统一管理单次请求边界，使压缩逻辑能够计入临时提示片段、
      // 工具模式和输出预留空间。
      let conversationMessages = [...thread.messages, ...(includeUserMessageInConversation ? [modelUserMessage] : [])];
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
          responseLanguage = inferRuntimeResponseLanguage(message.content) ?? responseLanguage;
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

      // 一个 turn 可能包含多段 assistant：工具调用会结束当前段，把 tool 消息补回上下文后再问模型。
      while (true) {
        throwIfAborted(signal);
        appendMailboxMessagesToConversation(await this.options.turnInputs.drainMailboxMessages(threadId, turnId));
        appendSteersToConversation(await this.options.turnInputs.drainSteers(threadId, turnId));
        const stepContext = await this.options.samplingContexts.build({
          conversationMessages,
          hookContextMessages: additionalContextMessages,
          responseLanguage,
          runtimeConfig,
          signal,
          skillIds: activeSkillIds,
          thinkingOptions: activeThinkingOptions,
          thread,
          threadId,
          taskKind,
          turnId,
          samplingModel,
          turnModel,
          toolAccess: taskKind === 'review' || taskKind === 'subagent' ? 'read-only' : 'all',
        });
        cleanupEnvironment = stepContext.toolContext.environment;
        conversationMessages = stepContext.conversationMessages;
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
          const toolMessages = await this.options.toolExecutor.runToolCalls(toolCalls, stepContext.toolContext, stepContext.toolRouter, stepContext.runtimeConfig);
          if (toolMessages.some((message) => this.options.memoryControl().isSuccessfulRememberMessage(message))) {
            memorySavedByTool = true;
          }
          conversationMessages.push(...toolMessages);
          continue;
        }

        const pendingMailboxMessages = await this.options.turnInputs.drainMailboxMessages(threadId, turnId);
        const pendingSteers = await this.options.turnInputs.drainSteers(threadId, turnId);
        if (pendingMailboxMessages.length || pendingSteers.length) {
          await this.options.completeMessage(threadId, turnId, assistantMessageId, { content: roundText, phase: 'commentary', usage: sampled.usage, memoryCitation: roundMemoryCitation, providerMetadata: assistantMessage.providerMetadata });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            phase: 'commentary',
            memoryCitation: roundMemoryCitation,
            status: 'complete',
          });
          appendMailboxMessagesToConversation(pendingMailboxMessages);
          appendSteersToConversation(pendingSteers);
          continue;
        }

        const collaboration = this.options.collaborationControl();
        const pendingChildren = collaboration.pendingChildren(threadId);
        if (pendingChildren.total > 0) {
          if (pendingChildren.active > 0) {
            roundText += COLLABORATION_WAIT_NOTE;
            await this.options.publishAssistantItemDelta(threadId, turnId, assistantMessageId, COLLABORATION_WAIT_NOTE);
            await this.options.publishAssistantDelta(threadId, turnId, assistantMessageId, COLLABORATION_WAIT_NOTE);
          }
          await this.options.completeMessage(threadId, turnId, assistantMessageId, { content: roundText, phase: 'commentary', usage: sampled.usage, memoryCitation: roundMemoryCitation, providerMetadata: assistantMessage.providerMetadata });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            phase: 'commentary',
            memoryCitation: roundMemoryCitation,
            status: 'complete',
          });
          // 由 runtime 强制汇合：只要派生子任务尚未结束，父协作轮次就不能完成。
          conversationMessages.push(...await collaboration.collectPendingChildren(threadId, turnId, signal));
          continue;
        }

        const stopHookOutcome = await this.options.hooks.runStopHooks({
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
              language: options.review.language,
            } : undefined,
            taskKind,
            threadTitle: threadTitleGeneration,
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
      await this.dispatchTurnSettled(
        thread,
        turnId,
        cleanupStatus,
        settledContent,
        cleanupEnvironment?.cwd,
        runtimeConfig?.features,
      );
      try {
        await this.cleanupToolHostTurn({
          ...(cleanupEnvironment ? { environment: cleanupEnvironment } : {}),
          threadId,
          projectId: thread.projectId,
          turnId,
        }, { status: cleanupStatus });
      } finally {
        // 轮次级审批只在当前轮次活动期间有效。
        this.options.toolExecutor.cleanupTurn(turnId);
        // deferred 工具激活同样按 turn 清理,避免跨轮泄漏。
        this.options.samplingContexts.cleanupTurn(turnId);
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
  ): Promise<void> {
    if (!this.options.extensions) return;
    try {
      const outcome = await this.options.extensions.dispatch('turn.settled', {
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
