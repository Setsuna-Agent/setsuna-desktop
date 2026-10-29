import type {
  ModelRequest,
  RegenerateMessageInput,
  RuntimeInterfaceLanguage,
  RuntimeMessage,
  RuntimeTaskKind,
  RuntimeThread,
  RuntimeThreadGoal,
  SendTurnInput,
} from '@setsuna-desktop/contracts';
import { isRuntimeInputMessageAttachment } from '@setsuna-desktop/contracts';
import type { CollaborationSubagentTurnInput } from '@setsuna-desktop/feature-collaboration/contracts';
import type { ReviewControl, ReviewTurnRequest, WorkspaceTaskTurnRequest } from '@setsuna-desktop/feature-review/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';
import { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import type { RuntimeModelInputGuard } from './runtime-model-input-guard.js';
import {
  effectiveRuntimeThreadModelBinding,
  resolveRuntimeTurnModel,
  type RuntimeResolvedTurnModel,
} from './runtime-thread-model.js';

export type RuntimeTurnThinkingOptions = Pick<ModelRequest, 'thinking' | 'reasoningEffort'>;

export type RuntimeTurnExecutionOptions = {
  userInitiated?: boolean;
  unattended?: boolean;
  clientId?: string;
  includeUserMessageInModel?: boolean;
  inputKind?: RuntimeMessage['inputKind'];
  modelInput?: string;
  promptSource?: RuntimeMessage['promptSource'];
  publishUserMessage?: boolean;
  queuedInputId?: string;
  review?: {
    displayText: string;
    language: RuntimeInterfaceLanguage;
  };
  runtimeContextMessages?: RuntimeMessage[];
  taskKind?: RuntimeTaskKind;
  userMessage?: RuntimeMessage;
};

export type RuntimeTurnExecutionInput = {
  attachments: NonNullable<RuntimeMessage['attachments']>;
  options?: RuntimeTurnExecutionOptions;
  samplingModel?: RuntimeResolvedTurnModel;
  signal: AbortSignal;
  skillIds: string[];
  skillReferences?: RuntimeMessage['skillReferences'];
  text: string;
  turnModel?: RuntimeResolvedTurnModel;
  thinkingOptions?: RuntimeTurnThinkingOptions;
  thread: RuntimeThread;
  threadId: string;
  turnId: string;
};

type RuntimeTurnRunFactoryOptions = {
  clock: Clock;
  configStore?: ConfigStore;
  eventWriter: Pick<RuntimeEventWriter, 'append' | 'flushThread'>;
  ids: IdGenerator;
  inputGuard: Pick<RuntimeModelInputGuard, 'assertAttachmentsSupported'>;
  reviewControl: Pick<ReviewControl, 'prepare'>;
  claimAttachments(threadId: string, attachments: NonNullable<RuntimeMessage['attachments']>): Promise<NonNullable<RuntimeMessage['attachments']>>;
  normalizeAttachments(value: unknown): NonNullable<RuntimeMessage['attachments']>;
  publishStoredEventsSince(threadId: string, sinceSeq: number): Promise<void>;
  runTurn(input: RuntimeTurnExecutionInput): Promise<void>;
  threadStore: ThreadStore;
  turnTasks: RuntimeTurnTaskRegistry;
};

/** 为受支持的轮次入口提供工厂，具体执行仍由 AgentLoop 负责。 */
export class RuntimeTurnRunFactory {
  private readonly inferredBindingWrites = new Map<string, Promise<void>>();

  constructor(private readonly options: RuntimeTurnRunFactoryOptions) {}

  /** Persists a legacy history inference before a mutation can erase its provider evidence. */
  async persistInferredThreadModelBinding(threadId: string): Promise<void> {
    const existing = this.inferredBindingWrites.get(threadId);
    if (existing) return existing;
    const write = this.writeInferredThreadModelBinding(threadId);
    this.inferredBindingWrites.set(threadId, write);
    try {
      await write;
    } finally {
      if (this.inferredBindingWrites.get(threadId) === write) {
        this.inferredBindingWrites.delete(threadId);
      }
    }
  }

  async createRegular(
    threadId: string,
    input: SendTurnInput,
    execution: { queuedInputId?: string; unattended?: boolean } = {},
  ): Promise<{ turnId: string; done: Promise<void> }> {
    const text = input.input.trim();
    let attachments = this.options.normalizeAttachments(input.attachments);
    if (!text && !attachments.length) throw new Error('Turn input is required.');
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);

    const thread = await this.requireThread(threadId);
    const turnModel = await this.resolveTurnModel(thread, input.modelSelection);
    await this.options.inputGuard.assertAttachmentsSupported(attachments, turnModel?.model);
    attachments = await this.options.claimAttachments(threadId, attachments);
    const turnId = this.options.ids.id('turn');
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'regular',
      acceptingSteers: true,
    }, (task) => this.options.runTurn({
      attachments,
      signal: task.controller.signal,
      skillIds: input.skillIds ?? [],
      skillReferences: input.skillReferences,
      text,
      turnModel,
      thinkingOptions: turnThinkingOptions(input),
      thread,
      threadId,
      turnId,
      options: {
        clientId: input.clientId,
        queuedInputId: execution.queuedInputId,
        unattended: execution.unattended,
        runtimeContextMessages: execution.unattended ? unattendedTurnContext(turnId, this.options.clock.now().toISOString()) : undefined,
        taskKind: 'regular',
      },
    }));
    return { turnId, done: run.done };
  }

  async createMailboxTriggered(threadId: string, thread: RuntimeThread, turnId: string, content: string, execution: { unattended?: boolean } = {}): Promise<{ turnId: string; done: Promise<void> }> {
    const turnModel = await this.resolveTurnModel(thread);
    const taskKind = isCollaborationChildThread(thread) ? 'subagent' : 'regular';
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind,
      acceptingSteers: true,
    }, (task) => this.options.runTurn({
      attachments: [],
      signal: task.controller.signal,
      skillIds: [],
      text: `Mailbox message received: ${content.slice(0, 160)}`,
      turnModel,
      thread,
      threadId,
      turnId,
      options: {
        unattended: execution.unattended,
        runtimeContextMessages: execution.unattended ? unattendedTurnContext(turnId, this.options.clock.now().toISOString()) : undefined,
        includeUserMessageInModel: true,
        publishUserMessage: false,
        ...(taskKind === 'subagent'
          ? { inputKind: 'subagent_task' as const, promptSource: 'collaboration' as const }
          : {}),
        taskKind,
      },
    }));
    return { turnId, done: run.done };
  }

  /**
   * 创建子代理 turn：调用者不是用户而是父线程的协作协调器，因此输入被标记为
   * subagent_task / collaboration，审批自动审查不能把它当作真实用户授权。
   */
  async createSubagent(
    threadId: string,
    input: CollaborationSubagentTurnInput,
    execution: { unattended?: boolean } = {},
  ): Promise<{ turnId: string; done: Promise<void> }> {
    const text = input.prompt.trim();
    if (!text) throw new Error('Subagent prompt is required.');
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);
    let thread = await this.requireThread(threadId);
    const turnModel = await this.resolveTurnModel(thread);
    const turnId = input.turnId ?? this.options.ids.id('turn');
    const attachments = input.attachments ?? [];
    await this.options.inputGuard.assertAttachmentsSupported(attachments, turnModel?.model);
    for (const message of input.contextMessages ?? []) {
      await this.options.eventWriter.append(threadId, {
        id: this.options.ids.id('event'), threadId, turnId, type: 'message.created',
        createdAt: message.createdAt, payload: { message },
      });
    }
    if (input.contextMessages?.length) thread = await this.requireThread(threadId);
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'subagent',
      acceptingSteers: true,
    }, (task) => this.options.runTurn({
      attachments,
      signal: task.controller.signal,
      skillIds: [...(input.skillIds ?? [...thread.messages].reverse().find((message) => message.role === 'user' && message.skillIds?.length)?.skillIds ?? [])],
      text,
      turnModel,
      thinkingOptions: input.configuration ? {
        ...(input.configuration.thinking !== undefined ? { thinking: input.configuration.thinking } : {}),
        ...(input.configuration.reasoningEffort ? { reasoningEffort: input.configuration.reasoningEffort } : {}),
      } : undefined,
      thread,
      threadId,
      turnId,
      options: {
        unattended: execution.unattended,
        runtimeContextMessages: [
          ...(input.configuration?.instructions ? [{
            id: `collaboration_role_${turnId}`, turnId, role: 'developer' as const,
            content: input.configuration.instructions, createdAt: this.options.clock.now().toISOString(),
            visibility: 'model' as const, status: 'complete' as const,
          }] : []),
          ...(execution.unattended ? unattendedTurnContext(turnId, this.options.clock.now().toISOString()) : []),
        ],
        userInitiated: input.userInitiated,
        inputKind: input.userInitiated ? undefined : 'subagent_task',
        promptSource: input.userInitiated ? undefined : 'collaboration',
        taskKind: 'subagent',
      },
    }));
    return { turnId, done: run.done };
  }

  async createWorkspaceTask(threadId: string, input: WorkspaceTaskTurnRequest): Promise<{ turnId: string; done: Promise<void> }> {
    const text = input.displayText.trim();
    const prompt = input.prompt.trim();
    if (!text || !prompt) throw new Error('Workspace task text and prompt are required.');
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);
    const thread = await this.requireThread(threadId);
    const turnModel = await this.resolveTurnModel(thread, input.modelSelection);
    const turnId = this.options.ids.id('turn');
    const run = this.options.turnTasks.run({ turnId, threadId, taskKind: 'regular', acceptingSteers: true }, (task) => this.options.runTurn({
      attachments: [], signal: task.controller.signal, skillIds: [],
      text, turnModel, thread, threadId, turnId,
      options: {
        taskKind: 'regular', modelInput: prompt,
        runtimeContextMessages: [{
          id: 'workspace_task_policy', turnId, role: 'developer', visibility: 'model', status: 'complete',
          createdAt: this.options.clock.now().toISOString(), content: input.developerInstructions,
        }],
      },
    }));
    return { turnId, done: run.done };
  }

  async createReview(threadId: string, input: ReviewTurnRequest): Promise<{ turnId: string; done: Promise<void> }> {
    const displayText = input.displayText.trim();
    const prompt = input.prompt.trim();
    if (!displayText) throw new Error('review display text is required');
    if (!prompt) throw new Error('review prompt is required');
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);
    const thread = await this.requireThread(threadId);
    const turnModel = await this.resolveTurnModel(thread, input.conversationModelSelection);
    const samplingModel = await this.resolveTurnModel(thread, input.modelSelection);
    const turnId = this.options.ids.id('turn');
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'review',
      acceptingSteers: true,
    }, (task) => this.options.runTurn({
      attachments: [],
      samplingModel,
      signal: task.controller.signal,
      skillIds: [],
      text: displayText,
      turnModel,
      thread,
      threadId,
      turnId,
      options: {
        ...reviewTurnOptions(input, turnId, this.options.clock.now().toISOString()),
        userMessage: {
          id: turnId,
          turnId,
          role: 'user',
          inputKind: 'review',
          content: displayText,
          createdAt: this.options.clock.now().toISOString(),
          status: 'complete',
        },
      },
    }));
    return { turnId, done: run.done };
  }

  async createGoalContinuation(
    threadId: string,
    goal: RuntimeThreadGoal,
    execution: { turnId?: string } = {},
  ): Promise<{ turnId: string; done: Promise<void> }> {
    const thread = await this.requireThread(threadId);
    const turnModel = await this.resolveTurnModel(thread, goal.execution?.modelSelection);
    const sourceMessage = goal.execution?.sourceMessageId
      ? thread.messages.find((message) => message.id === goal.execution?.sourceMessageId)
      : undefined;
    // 首轮 Goal 的附件已经随可见用户消息进入模型历史；只有该消息被压缩出模型窗口后，
    // 才需要在合成的续轮输入上重新附加，避免首轮重复发送图片或文件。
    const attachments = sourceMessage && sourceMessage.visibility !== 'transcript'
      ? []
      : this.options.normalizeAttachments(goal.execution?.attachments);
    const turnId = execution.turnId ?? this.options.ids.id('turn_goal');
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'goal',
      acceptingSteers: true,
    }, (task) => this.options.runTurn({
      attachments,
      signal: task.controller.signal,
      skillIds: goal.execution?.skillIds ?? [],
      text: 'Continue the active goal.',
      turnModel,
      thinkingOptions: turnThinkingOptions(goal.execution ?? {}),
      thread,
      threadId,
      turnId,
      options: {
        // 不把合成的续写内容写入对话记录，但要与 runtime 上下文一起作为兼容 OpenAI 的
        // 供应商所需用户消息发送。
        includeUserMessageInModel: true,
        publishUserMessage: false,
        taskKind: 'goal',
      },
    }));
    return { turnId, done: run.done };
  }

  async createRegenerate(
    threadId: string,
    messageId: string,
    input: RegenerateMessageInput,
  ): Promise<{ turnId: string; taskKind: 'regular' | 'review'; done: Promise<void> }> {
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);
    await this.options.eventWriter.flushThread(threadId);
    const originalThread = await this.requireThread(threadId);
    const originalMessage = originalThread.messages.find((message) => message.id === messageId);
    if (!originalMessage) throw new Error(`Message not found: ${messageId}`);
    if (originalMessage.role !== 'user' || originalMessage.contextCompaction) throw new Error('Only user messages can be regenerated.');
    if (originalMessage.inputKind === 'goal') {
      throw new Error('Goal messages cannot be regenerated as regular turns.');
    }

    const text = typeof input.content === 'string' ? input.content.trim() : originalMessage.content.trim();
    const skillIds = input.skillIds ?? originalMessage.skillIds ?? [];
    let attachments = this.options.normalizeAttachments(input.attachments ?? originalMessage.attachments);
    if (!text && !attachments.length) throw new Error('Message content is required.');
    const config = await this.options.configStore?.getConfig().catch(() => null);
    const turnModel = resolveRuntimeTurnModel(config, originalThread);
    // Review owns its policy and dedicated model. Resolve both before changing history,
    // so an unavailable Feature or incompatible attachment leaves the original review intact.
    const reviewRequest = originalMessage.inputKind === 'review'
      ? await this.options.reviewControl.prepare({
          threadId,
          target: { type: 'custom', instructions: text },
          language: config?.desktopSettings?.interfaceLanguage ?? 'en-US',
          modelSelection: turnModel?.binding,
        })
      : undefined;
    const samplingModel = reviewRequest
      ? resolveRuntimeTurnModel(config, originalThread, reviewRequest.modelSelection)
      : undefined;
    await this.options.inputGuard.assertAttachmentsSupported(attachments, (samplingModel ?? turnModel)?.model);
    // Validate ownership before editing or truncating history; a rejected asset must leave it intact.
    attachments = await this.options.claimAttachments(threadId, attachments);
    if (
      text !== originalMessage.content
      || input.attachments !== undefined
      || input.skillIds !== undefined
      || input.skillReferences !== undefined
    ) {
      await this.options.threadStore.updateMessage(threadId, messageId, {
        content: text,
        ...(input.attachments !== undefined ? { attachments: attachments.filter(isRuntimeInputMessageAttachment) } : {}),
        skillIds,
        ...(input.skillReferences !== undefined ? { skillReferences: input.skillReferences } : {}),
      });
    }
    await this.options.threadStore.truncateMessagesAfter(threadId, messageId, false);
    await this.options.publishStoredEventsSince(threadId, originalThread.lastSeq);

    const thread = await this.requireThread(threadId);
    const userMessage = thread.messages.find((message) => message.id === messageId);
    if (!userMessage || userMessage.role !== 'user') throw new Error(`User message not found after regeneration setup: ${messageId}`);
    const turnId = this.options.ids.id('turn');
    const taskKind = reviewRequest ? 'review' : 'regular';
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind,
      acceptingSteers: true,
    }, (task) => this.options.runTurn({
      attachments,
      samplingModel,
      signal: task.controller.signal,
      skillIds: userMessage.skillIds ?? [],
      skillReferences: userMessage.skillReferences,
      text,
      turnModel,
      thinkingOptions: reviewRequest ? undefined : turnThinkingOptions(input),
      thread,
      threadId,
      turnId,
      options: {
        ...(reviewRequest ? reviewTurnOptions(reviewRequest, turnId, this.options.clock.now().toISOString()) : {}),
        userMessage,
        publishUserMessage: false,
        taskKind,
      },
    }));
    return { turnId, taskKind, done: run.done };
  }

  private async requireThread(threadId: string): Promise<RuntimeThread> {
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  }

  private async writeInferredThreadModelBinding(threadId: string): Promise<void> {
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread || thread.modelBinding) return;
    if (!thread.messages.some((message) => (
      message.role === 'assistant' && Boolean(message.providerMetadata?.source)
    ))) return;
    const config = await this.options.configStore?.getConfig().catch(() => null);
    const modelBinding = effectiveRuntimeThreadModelBinding(config, thread);
    if (!modelBinding) return;
    await this.options.eventWriter.append(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      type: 'thread.updated',
      createdAt: this.options.clock.now().toISOString(),
      payload: { modelBinding },
    });
  }

  private async resolveTurnModel(
    thread: RuntimeThread,
    requested?: SendTurnInput['modelSelection'],
  ): Promise<RuntimeResolvedTurnModel | undefined> {
    const config = await this.options.configStore?.getConfig().catch(() => null);
    return resolveRuntimeTurnModel(config, thread, requested);
  }
}

function unattendedTurnContext(turnId: string, createdAt: string): RuntimeMessage[] {
  return [{
    id: 'unattended_task_policy', turnId, role: 'developer', visibility: 'model', status: 'complete', createdAt,
    content: 'This is an unattended scheduled task. Execute the assigned work autonomously within this turn\'s tool permissions. Do not ask the user questions or display input forms. Infer reasonable defaults; if essential information or credentials are missing, report the blocker in the final answer and finish. Do not create new schedules or persistent goals from this run.',
  }];
}

function reviewTurnOptions(
  request: ReviewTurnRequest,
  turnId: string,
  createdAt: string,
): RuntimeTurnExecutionOptions {
  return {
    modelInput: request.prompt.trim(),
    review: { displayText: request.displayText.trim(), language: request.language },
    runtimeContextMessages: [{
      id: 'desktop_review_policy',
      turnId,
      role: 'developer',
      promptSource: 'review',
      visibility: 'model',
      status: 'complete',
      createdAt,
      content: request.developerInstructions,
    }],
    taskKind: 'review',
  };
}

function isCollaborationChildThread(thread: RuntimeThread): boolean {
  return thread.kind !== 'side' && Boolean(thread.parentThreadId);
}

function turnThinkingOptions(input: { thinking?: boolean; thinkingEffort?: string }): RuntimeTurnThinkingOptions {
  const thinking = input.thinking === true;
  const reasoningEffort = typeof input.thinkingEffort === 'string' && input.thinkingEffort.trim() ? input.thinkingEffort.trim() : undefined;
  return {
    thinking,
    ...(thinking && reasoningEffort ? { reasoningEffort } : {}),
  };
}
