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
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { runtimeReviewPolicyMessage } from '../context/runtime-review-profile.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';
import { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import type { RuntimeModelInputGuard } from './runtime-model-input-guard.js';
import {
  effectiveRuntimeThreadModelBinding,
  resolveRuntimeTurnModel,
  type RuntimeResolvedTurnModel,
} from './runtime-thread-model.js';

export type RuntimeTurnThinkingOptions = Pick<ModelRequest, 'thinking' | 'reasoningEffort'>;

export type RuntimeReviewTurnInput = {
  displayText: string;
  language?: RuntimeInterfaceLanguage;
  modelSelection?: SendTurnInput['modelSelection'];
  prompt: string;
};

export type RuntimeTurnExecutionOptions = {
  clientId?: string;
  includeUserMessageInModel?: boolean;
  inputKind?: RuntimeMessage['inputKind'];
  modelInput?: string;
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
    execution: { queuedInputId?: string } = {},
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
        taskKind: 'regular',
      },
    }));
    return { turnId, done: run.done };
  }

  async createMailboxTriggered(threadId: string, thread: RuntimeThread, turnId: string, content: string): Promise<{ turnId: string; done: Promise<void> }> {
    const turnModel = await this.resolveTurnModel(thread);
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'regular',
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
        includeUserMessageInModel: true,
        publishUserMessage: false,
        taskKind: 'regular',
      },
    }));
    return { turnId, done: run.done };
  }

  async createReview(threadId: string, input: RuntimeReviewTurnInput): Promise<{ turnId: string; done: Promise<void> }> {
    const displayText = input.displayText.trim();
    const prompt = input.prompt.trim();
    if (!displayText) throw new Error('review display text is required');
    if (!prompt) throw new Error('review prompt is required');
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);
    const thread = await this.requireThread(threadId);
    const turnModel = await this.resolveTurnModel(thread, input.modelSelection);
    const turnId = this.options.ids.id('turn');
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'review',
      acceptingSteers: false,
    }, (task) => this.options.runTurn({
      attachments: [],
      signal: task.controller.signal,
      skillIds: [],
      text: displayText,
      turnModel,
      thread,
      threadId,
      turnId,
      options: {
        modelInput: prompt,
        review: {
          displayText,
          language: input.language ?? 'zh-CN',
        },
        runtimeContextMessages: [runtimeReviewPolicyMessage(turnId, this.options.clock.now().toISOString(), input.language ?? 'zh-CN')],
        taskKind: 'review',
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
  ): Promise<{ turnId: string; done: Promise<void> }> {
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);
    await this.options.eventWriter.flushThread(threadId);
    const originalThread = await this.requireThread(threadId);
    const originalMessage = originalThread.messages.find((message) => message.id === messageId);
    if (!originalMessage) throw new Error(`Message not found: ${messageId}`);
    if (originalMessage.role !== 'user' || originalMessage.contextCompaction) throw new Error('Only user messages can be regenerated.');
    // Goal 与 Review 都有普通轮次不具备的执行语义，不能借“编辑并重试”降级成 regular turn。
    if (originalMessage.inputKind === 'goal' || originalMessage.inputKind === 'review') {
      throw new Error(`${originalMessage.inputKind === 'goal' ? 'Goal' : 'Review'} messages cannot be regenerated as regular turns.`);
    }

    const text = typeof input.content === 'string' ? input.content.trim() : originalMessage.content.trim();
    const skillIds = input.skillIds ?? originalMessage.skillIds ?? [];
    if (!text) throw new Error('Message content is required.');
    const turnModel = await this.resolveTurnModel(originalThread);
    await this.options.inputGuard.assertAttachmentsSupported(
      this.options.normalizeAttachments(originalMessage.attachments),
      turnModel?.model,
    );
    if (
      text !== originalMessage.content
      || input.skillIds !== undefined
      || input.skillReferences !== undefined
    ) {
      await this.options.threadStore.updateMessage(threadId, messageId, {
        content: text,
        skillIds,
        ...(input.skillReferences !== undefined ? { skillReferences: input.skillReferences } : {}),
      });
    }
    await this.options.threadStore.truncateMessagesAfter(threadId, messageId, false);
    await this.options.publishStoredEventsSince(threadId, originalThread.lastSeq);

    const thread = await this.requireThread(threadId);
    const userMessage = thread.messages.find((message) => message.id === messageId);
    if (!userMessage || userMessage.role !== 'user') throw new Error(`User message not found after regeneration setup: ${messageId}`);
    const attachments = await this.options.claimAttachments(
      threadId,
      this.options.normalizeAttachments(userMessage.attachments),
    );
    const turnId = this.options.ids.id('turn');
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'regular',
      acceptingSteers: true,
    }, (task) => this.options.runTurn({
      attachments,
      signal: task.controller.signal,
      skillIds: userMessage.skillIds ?? [],
      skillReferences: userMessage.skillReferences,
      text,
      turnModel,
      thinkingOptions: turnThinkingOptions(input),
      thread,
      threadId,
      turnId,
      options: {
        userMessage,
        publishUserMessage: false,
        taskKind: 'regular',
      },
    }));
    return { turnId, done: run.done };
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

function turnThinkingOptions(input: { thinking?: boolean; thinkingEffort?: string }): RuntimeTurnThinkingOptions {
  const thinking = input.thinking === true;
  const reasoningEffort = typeof input.thinkingEffort === 'string' && input.thinkingEffort.trim() ? input.thinkingEffort.trim() : undefined;
  return {
    thinking,
    ...(thinking && reasoningEffort ? { reasoningEffort } : {}),
  };
}
