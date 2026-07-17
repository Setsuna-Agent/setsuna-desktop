import type {
  RuntimeEnvironment,
  RuntimeMemoryCitation,
  RuntimeMessage,
  RuntimeToolCall,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../ports/clock.js';
import type { ConfigStore } from '../ports/config-store.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { ToolExecutionContext, ToolHost, ToolTurnCleanupOutcome } from '../ports/tool-host.js';
import type { RuntimeHookCoordinator } from './runtime-hook-coordinator.js';
import { isSuccessfulRememberMemoryMessage } from './runtime-memory-coordinator.js';
import type { RuntimeModelSampler } from './runtime-model-sampler.js';
import type { RuntimeSamplingContextBuilder } from './runtime-sampling-context-builder.js';
import type { RuntimeThreadTitleCoordinator } from './runtime-thread-title-coordinator.js';
import type { RuntimeToolCallExecutor } from './runtime-tool-call-executor.js';
import type { RuntimeTurnFinalizer } from './runtime-turn-finalizer.js';
import { HookStoppedTurnError } from './runtime-context-compactor.js';
import { isAbortError, throwIfAborted } from './runtime-turn-errors.js';
import { addRuntimeUsage } from './runtime-usage.js';
import type { RuntimeTurnInputCoordinator } from './runtime-turn-input-coordinator.js';
import type { RuntimeTurnExecutionInput } from './runtime-turn-run-factory.js';
import type { RuntimeQueuedSteer } from './turn-input-queue.js';
import type { RuntimeTurnTaskRegistry } from './turn-task-registry.js';
import type { RuntimeTurnTerminationCoordinator } from './runtime-turn-termination-coordinator.js';
import type { RuntimeCollaborationCoordinator } from './collaboration-coordinator.js';

type RuntimeAgentTurnRunnerOptions = {
  clock: Clock;
  collaborationCoordinator: Pick<RuntimeCollaborationCoordinator, 'collectPendingChildren' | 'pendingChildren'>;
  configStore?: ConfigStore;
  hooks: Pick<RuntimeHookCoordinator, 'planModeContextMessages' | 'runStopHooks' | 'runTurnStartHooks' | 'stopContinuationMessages'>;
  ids: IdGenerator;
  modelSampler: Pick<RuntimeModelSampler, 'sample'>;
  samplingContexts: Pick<RuntimeSamplingContextBuilder, 'build'>;
  threadTitles: Pick<RuntimeThreadTitleCoordinator, 'start'>;
  toolExecutor: Pick<RuntimeToolCallExecutor, 'cleanupTurn' | 'runToolCalls'>;
  toolHost?: ToolHost;
  turnFinalizer: Pick<RuntimeTurnFinalizer, 'finish' | 'publishReviewModeMessage'>;
  turnInputs: Pick<RuntimeTurnInputCoordinator, 'drainMailboxMessages' | 'drainSteers'>;
  turnTasks: Pick<RuntimeTurnTaskRegistry, 'stopAcceptingSteers'>;
  turnTermination: Pick<RuntimeTurnTerminationCoordinator, 'publishCancelledOnce'>;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
  completeMessage(
    threadId: string,
    turnId: string,
    messageId: string,
    payload?: {
      content?: string;
      usage?: RuntimeUsage;
      toolCalls?: RuntimeToolCall[];
      memoryCitation?: RuntimeMemoryCitation;
      planMode?: RuntimeMessage['planMode'];
    },
  ): Promise<void>;
  publishAssistantDelta(threadId: string, turnId: string, messageId: string, text: string): Promise<void>;
  publishMessage(threadId: string, turnId: string, message: RuntimeMessage): Promise<void>;
};

const COLLABORATION_WAIT_NOTE = '\n\n子线程仍在执行；主任务会继续等待，收到调研结果后再统一收口。';

export class RuntimeAgentTurnRunner {
  constructor(private readonly options: RuntimeAgentTurnRunnerOptions) {}

  async run({
    attachments,
    options = {},
    signal,
    skillIds,
    text,
    thinkingOptions = {},
    thread,
    threadId,
    turnId,
  }: RuntimeTurnExecutionInput): Promise<void> {
    const createdAt = this.options.clock.now().toISOString();
    let activeAssistantMessageId: string | null = null;
    const publishUserMessage = options.publishUserMessage !== false;
    const taskKind = options.taskKind ?? 'regular';
    const planOnly = options.planOnly === true;
    const userMessage: RuntimeMessage = options.userMessage ?? {
      id: this.options.ids.id('msg'),
      clientId: options.clientId,
      turnId,
      role: 'user',
      content: text,
      attachments,
      createdAt,
      status: 'complete',
    };
    const modelUserMessage: RuntimeMessage = options.modelInput ? { ...userMessage, content: options.modelInput } : userMessage;
    const includeUserMessageInConversation = publishUserMessage || options.includeUserMessageInModel === true;
    let runtimeConfig = await this.options.configStore?.getConfig().catch(() => null);
    let activeSkillIds = [...skillIds];
    let activeThinkingOptions = thinkingOptions;

    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.started',
      createdAt,
      payload: { input: text, taskKind },
    });
    if (options.planDecision === 'dismissed') {
      // 放弃计划：awaiting 状态已由 applyPendingPlanDecision 标记为 dismissed，无需调用模型，直接结束 turn。
      this.options.turnTasks.stopAcceptingSteers(threadId, turnId);
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
    if (publishUserMessage) await this.options.publishMessage(threadId, turnId, userMessage);
    if (options.review) await this.options.turnFinalizer.publishReviewModeMessage(threadId, turnId, 'entered', options.review.displayText);
    const turnStartHooks = await this.options.hooks.runTurnStartHooks({
      prompt: options.modelInput ?? text,
      runtimeConfig,
      signal,
      thread,
      turnId,
    });
    if (turnStartHooks.stopped) {
      this.options.turnTasks.stopAcceptingSteers(threadId, turnId);
      await this.options.publishMessage(threadId, turnId, {
        id: this.options.ids.id('msg'),
        turnId,
        role: 'assistant',
        content: turnStartHooks.reason,
        createdAt: this.options.clock.now().toISOString(),
        status: 'complete',
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
    const additionalContextMessages = [
      ...(options.runtimeContextMessages ?? []),
      ...turnStartHooks.contextMessages,
      ...(planOnly ? this.options.hooks.planModeContextMessages(turnId) : []),
    ];
    // 标题请求与主回答并行，避免额外增加首轮回复延迟；失败时首条消息投影已经提供 fallback。
    const threadTitleGeneration = this.options.threadTitles.start({
      attachments,
      signal,
      taskKind,
      thread,
      userContent: userMessage.content,
    });

    let usage: RuntimeUsage | undefined;
    let cleanupStatus: ToolTurnCleanupOutcome['status'] = 'completed';
    let cleanupEnvironment: RuntimeEnvironment | undefined;
    try {
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

      // 一个 turn 可能包含多段 assistant：工具调用会结束当前段，把 tool 消息补回上下文后再问模型。
      while (true) {
        throwIfAborted(signal);
        appendMailboxMessagesToConversation(await this.options.turnInputs.drainMailboxMessages(threadId, turnId));
        appendSteersToConversation(await this.options.turnInputs.drainSteers(threadId, turnId));
        const stepContext = await this.options.samplingContexts.build({
          conversationMessages,
          hookContextMessages: additionalContextMessages,
          runtimeConfig,
          signal,
          skillIds: activeSkillIds,
          thread,
          threadId,
          turnId,
          toolAccess: planOnly ? 'none' : taskKind === 'review' ? 'read-only' : 'all',
        });
        cleanupEnvironment = stepContext.toolContext.environment;
        conversationMessages = stepContext.conversationMessages;
        runtimeConfig = stepContext.runtimeConfig;

        const sampled = await this.options.modelSampler.sample({
          captureProtocolUsage: true,
          onAssistantStarted: (messageId) => {
            activeAssistantMessageId = messageId;
          },
          planMode: planOnly ? awaitingPlanConfirmationNotice() : undefined,
          planOnly,
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
          // 先把 toolCalls 挂到 assistant 消息上，再执行工具，UI 才能把后续 toolRuns 归到正确气泡。
          await this.options.completeMessage(threadId, turnId, assistantMessageId, {
            toolCalls,
            usage: sampled.usage,
            memoryCitation: roundMemoryCitation,
          });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            memoryCitation: roundMemoryCitation,
            toolCalls,
            status: 'complete',
          });
          const toolMessages = await this.options.toolExecutor.runToolCalls(toolCalls, stepContext.toolContext, stepContext.toolRouter, stepContext.runtimeConfig);
          if (toolMessages.some(isSuccessfulRememberMemoryMessage)) memorySavedByTool = true;
          conversationMessages.push(...toolMessages);
          continue;
        }

        const pendingMailboxMessages = await this.options.turnInputs.drainMailboxMessages(threadId, turnId);
        const pendingSteers = await this.options.turnInputs.drainSteers(threadId, turnId);
        if (pendingMailboxMessages.length || pendingSteers.length) {
          await this.options.completeMessage(threadId, turnId, assistantMessageId, { usage: sampled.usage, memoryCitation: roundMemoryCitation });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            memoryCitation: roundMemoryCitation,
            status: 'complete',
          });
          appendMailboxMessagesToConversation(pendingMailboxMessages);
          appendSteersToConversation(pendingSteers);
          continue;
        }

        const pendingChildren = this.options.collaborationCoordinator.pendingChildren(threadId);
        if (pendingChildren.total > 0) {
          if (pendingChildren.active > 0) {
            roundText += COLLABORATION_WAIT_NOTE;
            await this.options.publishAssistantDelta(threadId, turnId, assistantMessageId, COLLABORATION_WAIT_NOTE);
          }
          await this.options.completeMessage(threadId, turnId, assistantMessageId, { usage: sampled.usage, memoryCitation: roundMemoryCitation });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            memoryCitation: roundMemoryCitation,
            status: 'complete',
          });
          // 由 runtime 强制汇合：只要派生子任务尚未结束，父协作轮次就不能完成。
          conversationMessages.push(...await this.options.collaborationCoordinator.collectPendingChildren(threadId, turnId, signal));
          continue;
        }

        const stopHookOutcome = await this.options.hooks.runStopHooks({
          context: stepContext.toolContext,
          lastAssistantMessage: roundText,
          runtimeConfig,
          stopHookActive,
        });
        if (stopHookOutcome.shouldBlock && stopHookOutcome.blockReason) {
          await this.options.completeMessage(threadId, turnId, assistantMessageId, { usage: sampled.usage, memoryCitation: roundMemoryCitation });
          activeAssistantMessageId = null;
          conversationMessages.push({
            ...assistantMessage,
            content: roundText,
            memoryCitation: roundMemoryCitation,
            status: 'complete',
          });
          conversationMessages.push(...this.options.hooks.stopContinuationMessages(stopHookOutcome.blockReason, turnId));
          stopHookActive = true;
          continue;
        }

        this.options.turnTasks.stopAcceptingSteers(threadId, turnId);
        await this.options.turnFinalizer.finish({
          threadId,
          turnId,
          messageId: assistantMessageId,
          messageUsage: sampled.usage,
          usage,
          finalization: {
            explicitMemory: taskKind === 'goal' ? undefined : {
              alreadySaved: memorySavedByTool,
              config: runtimeConfig,
              projectId: thread.projectId,
              userContent: explicitMemoryUserContent,
            },
            memoryCitation: roundMemoryCitation,
            content: roundText,
            planMode: planOnly ? awaitingPlanConfirmationNotice() : undefined,
            review: options.review ? roundText : undefined,
            taskKind,
            threadTitle: threadTitleGeneration,
          },
        });
        activeAssistantMessageId = null;
        break;
      }
    } catch (error) {
      if (error instanceof HookStoppedTurnError) {
        if (activeAssistantMessageId) {
          await this.options.completeMessage(threadId, turnId, activeAssistantMessageId);
        }
        this.options.turnTasks.stopAcceptingSteers(threadId, turnId);
        await this.options.publishMessage(threadId, turnId, {
          id: this.options.ids.id('msg'),
          turnId,
          role: 'assistant',
          content: error.message,
          createdAt: this.options.clock.now().toISOString(),
          status: 'complete',
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
        if (activeAssistantMessageId) {
          await this.options.completeMessage(threadId, turnId, activeAssistantMessageId);
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
        await this.cleanupToolHostTurn({
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

function awaitingPlanConfirmationNotice(): NonNullable<RuntimeMessage['planMode']> {
  return {
    mode: 'plan',
    status: 'awaiting_confirmation',
  };
}
