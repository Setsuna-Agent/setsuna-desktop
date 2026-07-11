import type {
  ModelRequest,
  RuntimeMessage,
  RuntimePlanDecision,
  RuntimeTaskKind,
  RuntimeThread,
  RuntimeThreadGoal,
  SendTurnInput,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { RuntimeEventWriter } from './runtime-event-writer.js';
import type { RuntimeModelInputGuard } from './runtime-model-input-guard.js';
import { RuntimeTurnTaskRegistry } from './turn-task-registry.js';

export type RuntimeTurnThinkingOptions = Pick<ModelRequest, 'thinking' | 'reasoningEffort'>;

export type RuntimeReviewTurnInput = {
  displayText: string;
  prompt: string;
};

export type RuntimeTurnExecutionOptions = {
  clientId?: string;
  includeUserMessageInModel?: boolean;
  modelInput?: string;
  planDecision?: RuntimePlanDecision;
  planOnly?: boolean;
  publishUserMessage?: boolean;
  review?: { displayText: string };
  runtimeContextMessages?: RuntimeMessage[];
  taskKind?: RuntimeTaskKind;
  userMessage?: RuntimeMessage;
};

export type RuntimeTurnExecutionInput = {
  attachments: NonNullable<RuntimeMessage['attachments']>;
  options?: RuntimeTurnExecutionOptions;
  signal: AbortSignal;
  skillIds: string[];
  text: string;
  thinkingOptions?: RuntimeTurnThinkingOptions;
  thread: RuntimeThread;
  threadId: string;
  turnId: string;
};

type RuntimeTurnRunFactoryOptions = {
  clock: Clock;
  eventWriter: Pick<RuntimeEventWriter, 'flushThread'>;
  ids: IdGenerator;
  inputGuard: Pick<RuntimeModelInputGuard, 'assertAttachmentsSupported'>;
  normalizeAttachments(value: unknown): NonNullable<RuntimeMessage['attachments']>;
  publishStoredEventsSince(threadId: string, sinceSeq: number): Promise<void>;
  runTurn(input: RuntimeTurnExecutionInput): Promise<void>;
  threadStore: ThreadStore;
  turnTasks: RuntimeTurnTaskRegistry;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
};

/** Factory for the supported turn entry points; execution remains in AgentLoop. */
export class RuntimeTurnRunFactory {
  constructor(private readonly options: RuntimeTurnRunFactoryOptions) {}

  async createRegular(threadId: string, input: SendTurnInput): Promise<{ turnId: string; done: Promise<void> }> {
    const text = input.input.trim();
    const attachments = this.options.normalizeAttachments(input.attachments);
    const planDecision = input.planDecision;
    if (!text && !attachments.length && !planDecision) throw new Error('Turn input is required.');
    await this.options.inputGuard.assertAttachmentsSupported(attachments);
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);

    const thread = await this.requireThread(threadId);
    const threadForRun = await this.applyPendingPlanDecision(threadId, thread, planDecisionForTurnInput(input));
    const turnId = this.options.ids.id('turn');
    // A decision-only turn uses a model-only execution prompt; dismissed decisions short-circuit in AgentLoop.
    const planDecisionOnly = Boolean(planDecision) && !text && !attachments.length;
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'regular',
      acceptingSteers: true,
    }, (task) => this.options.runTurn({
      attachments,
      signal: task.controller.signal,
      skillIds: input.skillIds ?? [],
      text,
      thinkingOptions: turnThinkingOptions(input),
      thread: threadForRun,
      threadId,
      turnId,
      options: {
        clientId: input.clientId,
        planOnly: input.collaborationMode === 'plan',
        taskKind: 'regular',
        planDecision: planDecisionOnly ? planDecision : undefined,
        ...(planDecisionOnly && planDecision === 'accepted'
          ? { publishUserMessage: false, includeUserMessageInModel: true, modelInput: PLAN_ACCEPT_EXECUTION_PROMPT }
          : {}),
      },
    }));
    return { turnId, done: run.done };
  }

  createMailboxTriggered(threadId: string, thread: RuntimeThread, turnId: string, content: string): { turnId: string; done: Promise<void> } {
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
      thread,
      threadId,
      turnId,
      options: {
        modelInput: prompt,
        review: { displayText },
        taskKind: 'review',
        userMessage: {
          id: turnId,
          turnId,
          role: 'user',
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
    runtimeContextMessages: RuntimeMessage[],
  ): Promise<{ turnId: string; done: Promise<void> }> {
    const thread = await this.requireThread(threadId);
    const turnId = this.options.ids.id('turn_goal');
    const run = this.options.turnTasks.run({
      turnId,
      threadId,
      taskKind: 'goal',
      acceptingSteers: true,
    }, (task) => this.options.runTurn({
      attachments: [],
      signal: task.controller.signal,
      skillIds: [],
      text: `Continue goal: ${goal.objective}`,
      thread,
      threadId,
      turnId,
      options: {
        publishUserMessage: false,
        runtimeContextMessages,
        taskKind: 'goal',
      },
    }));
    return { turnId, done: run.done };
  }

  async createRegenerate(
    threadId: string,
    messageId: string,
    input: { content?: string; skillIds?: string[]; thinking?: boolean; thinkingEffort?: string },
  ): Promise<{ turnId: string; done: Promise<void> }> {
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);
    await this.options.eventWriter.flushThread(threadId);
    const originalThread = await this.requireThread(threadId);
    const originalMessage = originalThread.messages.find((message) => message.id === messageId);
    if (!originalMessage) throw new Error(`Message not found: ${messageId}`);
    if (originalMessage.role !== 'user') throw new Error('Only user messages can be regenerated.');

    const text = typeof input.content === 'string' ? input.content.trim() : originalMessage.content.trim();
    if (!text) throw new Error('Message content is required.');
    await this.options.inputGuard.assertAttachmentsSupported(this.options.normalizeAttachments(originalMessage.attachments));
    if (text !== originalMessage.content) {
      await this.options.threadStore.updateMessage(threadId, messageId, { content: text });
    }
    await this.options.threadStore.truncateMessagesAfter(threadId, messageId, false);
    await this.options.publishStoredEventsSince(threadId, originalThread.lastSeq);

    const thread = await this.requireThread(threadId);
    const userMessage = thread.messages.find((message) => message.id === messageId);
    if (!userMessage || userMessage.role !== 'user') throw new Error(`User message not found after regeneration setup: ${messageId}`);
    const attachments = this.options.normalizeAttachments(userMessage.attachments);
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
      text,
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

  private async applyPendingPlanDecision(threadId: string, thread: RuntimeThread, decision: RuntimePlanDecision): Promise<RuntimeThread> {
    const planMessage = [...thread.messages].reverse().find((message) =>
      message.role === 'assistant'
      && message.planMode?.mode === 'plan'
      && message.planMode.status === 'awaiting_confirmation'
    );
    if (!planMessage) return thread;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId: planMessage.turnId,
      type: 'message.plan_mode_updated',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        messageId: planMessage.id,
        content: planMessage.content,
        planMode: { mode: 'plan', status: decision },
      },
    });
    return (await this.options.threadStore.getThread(threadId)) ?? thread;
  }

  private async requireThread(threadId: string): Promise<RuntimeThread> {
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread;
  }
}

const PLAN_ACCEPT_EXECUTION_PROMPT = '请按照上述已确认的计划开始执行。';

function planDecisionForTurnInput(input: SendTurnInput): RuntimePlanDecision {
  if (input.planDecision) return input.planDecision;
  return input.collaborationMode === 'plan' ? 'dismissed' : 'accepted';
}

function turnThinkingOptions(input: { thinking?: boolean; thinkingEffort?: string }): RuntimeTurnThinkingOptions {
  const thinking = input.thinking === true;
  const reasoningEffort = typeof input.thinkingEffort === 'string' && input.thinkingEffort.trim() ? input.thinkingEffort.trim() : undefined;
  return {
    thinking,
    ...(thinking && reasoningEffort ? { reasoningEffort } : {}),
  };
}
