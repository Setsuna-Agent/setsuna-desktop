import {
  mailboxMessageId,
  normalizeRuntimeSkillReferences,
  threadMessageTranscriptId,
  type RuntimeMailboxDelivery,
  type RuntimeMessage,
  type RuntimeQueuedTurnInput,
  type RuntimeThread,
  type SendTurnResponse,
  type SteerTurnInput,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { escapeSkillAttribute, neutralizeMailboxTags } from '../context/prompt-utils.js';
import { acceptsThreadMessages } from '../context/runtime-thread-messaging.js';
import type { RuntimeModelInputGuard } from '../core/runtime-model-input-guard.js';
import type { RuntimeMailboxExecutionOptions } from '../core/runtime-turn-run-factory.js';
import type { RuntimeQueuedSteer } from './turn-input-queue.js';
import { RuntimeTurnTaskRegistry, runtimeTaskSupportsSteering, type RuntimeTurnTask } from './turn-task-registry.js';

export type DeliverMailboxInput = {
  content: string;
  deliveryMode?: RuntimeMailboxDelivery['deliveryMode'];
  expectedTurnId?: string;
  fromAgentId?: string;
  fromThreadId?: string;
  id?: string;
  signal?: AbortSignal;
  threadMessage?: RuntimeMailboxDelivery['threadMessage'];
  toAgentId?: string;
  triggerTurn?: boolean;
};

export type DeliverMailboxResponse = {
  accepted: true;
  duplicate?: boolean;
  queued?: boolean;
  turnId: string | null;
};

type RuntimeTurnInputCoordinatorOptions = {
  clock: Clock;
  ids: IdGenerator;
  inputGuard: Pick<RuntimeModelInputGuard, 'assertThreadAttachmentsSupported'>;
  claimAttachments(threadId: string, attachments: NonNullable<RuntimeMessage['attachments']>): Promise<NonNullable<RuntimeMessage['attachments']>>;
  normalizeAttachments(value: unknown): NonNullable<RuntimeMessage['attachments']>;
  threadStore: ThreadStore;
  turnTasks: RuntimeTurnTaskRegistry;
  mutateThread<T>(threadId: string, operation: () => Promise<T>): Promise<T>;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
  createMailboxTriggeredRun(threadId: string, thread: RuntimeThread, turnId: string, content: string, execution: RuntimeMailboxExecutionOptions, beforeRun: () => Promise<void>): Promise<{ done: Promise<void> }>;
  publishMessage(
    threadId: string,
    turnId: string,
    message: RuntimeMessage,
    options?: { queuedInputId?: string },
  ): Promise<void>;
};

/** 管理活动轮次的 steer 与邮箱队列及其持久化边界。 */
export class RuntimeTurnInputCoordinator {
  private readonly threadMessageWrites = new Map<string, Promise<unknown>>();
  private readonly deferredWakes = new WeakSet<RuntimeTurnTask>();

  constructor(private readonly options: RuntimeTurnInputCoordinatorOptions) {}

  async steer(threadId: string, input: SteerTurnInput): Promise<SendTurnResponse> {
    return this.writeSteer(threadId, input);
  }

  async steerQueuedInput(
    threadId: string,
    activeTurnId: string,
    input: RuntimeQueuedTurnInput,
  ): Promise<SendTurnResponse> {
    return this.writeSteer(threadId, {
      attachments: input.attachments,
      clientId: input.clientId,
      expectedTurnId: activeTurnId,
      input: input.input,
      skillIds: input.skillIds,
      skillReferences: input.skillReferences,
      thinking: input.thinking,
      thinkingEffort: input.thinkingEffort,
    }, input.id);
  }

  private async writeSteer(
    threadId: string,
    input: SteerTurnInput,
    queuedInputId?: string,
  ): Promise<SendTurnResponse> {
    const text = input.input.trim();
    const attachments = this.options.normalizeAttachments(input.attachments);
    if (!text && !attachments.length) throw new Error('input must not be empty');
    const active = this.options.turnTasks.activeForThread(threadId);
    if (!active || active.controller.signal.aborted) throw new Error('no active turn to steer');
    if (!runtimeTaskSupportsSteering(active.taskKind)) throw new Error(`cannot steer a ${active.taskKind} turn`);
    if (active.turnId !== input.expectedTurnId) {
      throw new Error(`expected active turn id \`${input.expectedTurnId}\` but found \`${active.turnId}\``);
    }
    if (!active.acceptingSteers) throw new Error('active turn is finishing and can no longer be steered');
    active.inputQueue.beginWrite();
    try {
      const thread = await this.options.threadStore.getThread(threadId);
      if (!thread) throw new Error(`Thread not found: ${threadId}`);
      await this.options.inputGuard.assertThreadAttachmentsSupported(attachments, thread);
      if (active.controller.signal.aborted) throw new Error('no active turn to steer');
      const claimedAttachments = await this.options.claimAttachments(threadId, attachments);
      const skillIds = [...new Set((input.skillIds ?? []).map((skillId) => skillId.trim()).filter(Boolean))];
      const skillReferences = normalizeRuntimeSkillReferences({
        content: text,
        references: input.skillReferences,
        skillIds,
      });
      const message: RuntimeMessage = {
        id: this.options.ids.id('msg'),
        clientId: input.clientId,
        turnId: active.turnId,
        role: 'user',
        content: text,
        skillIds: skillIds.length ? skillIds : undefined,
        skillReferences: skillReferences.length ? skillReferences : undefined,
        attachments: claimedAttachments,
        createdAt: this.options.clock.now().toISOString(),
        status: 'complete',
      };
      await this.options.publishMessage(threadId, active.turnId, message, { queuedInputId });
      active.inputQueue.enqueueSteer({
        message,
        skillIds,
        ...(typeof input.thinking === 'boolean' ? { thinking: input.thinking } : {}),
        ...(input.thinking === true && input.thinkingEffort?.trim() ? { thinkingEffort: input.thinkingEffort.trim() } : {}),
      });
      return { accepted: true, turnId: active.turnId };
    } finally {
      active.inputQueue.settleWrite();
    }
  }

  async deliverMailbox(threadId: string, input: DeliverMailboxInput, execution: RuntimeMailboxExecutionOptions = {}): Promise<DeliverMailboxResponse> {
    const content = input.content.trim();
    if (!content) throw new Error('mailbox content must not be empty');
    if (input.threadMessage) {
      const delivery: RuntimeMailboxDelivery = {
        id: input.id ?? this.options.ids.id('mailbox'), content, threadMessage: input.threadMessage,
        triggerTurn: true, deliveryMode: 'trigger_turn',
      };
      return this.serializeThreadMessage(threadId, () => this.deliverThreadMessage(threadId, delivery, input.signal));
    }
    const active = this.options.turnTasks.activeForThread(threadId);
    if (input.expectedTurnId && (!active || active.turnId !== input.expectedTurnId)) {
      throw new Error(`expected active turn id \`${input.expectedTurnId}\` but found \`${active?.turnId ?? 'none'}\``);
    }
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const triggerTurn = input.triggerTurn === true || input.deliveryMode === 'trigger_turn';
    const delivery: RuntimeMailboxDelivery = {
      id: input.id?.trim() || this.options.ids.id('mailbox'),
      content,
      deliveryMode: input.deliveryMode ?? (triggerTurn ? 'trigger_turn' : 'queue_only'),
      fromAgentId: input.fromAgentId?.trim() || undefined,
      fromThreadId: input.fromThreadId?.trim() || undefined,
      toAgentId: input.toAgentId?.trim() || undefined,
      triggerTurn: triggerTurn || undefined,
    };

    if (active && !active.controller.signal.aborted && !turnTaskCanReceiveMailbox(active) && input.expectedTurnId) {
      throw new Error(`active ${active.taskKind} turn cannot receive mailbox input`);
    }
    if (active && !active.controller.signal.aborted && turnTaskCanReceiveMailbox(active)) {
      await this.deliverToActiveTask(active, delivery);
      return { accepted: true, turnId: active.turnId };
    }

    if (triggerTurn && !active) {
      const turnId = this.options.ids.id('turn');
      const run = await this.options.createMailboxTriggeredRun(threadId, thread, turnId, content, execution,
        () => this.recordMailboxDelivery(threadId, delivery, turnId));
      void run.done.catch(() => undefined);
      return { accepted: true, turnId };
    }

    await this.recordMailboxDelivery(threadId, delivery);
    return { accepted: true, queued: true, turnId: null };
  }

  private recordMailboxDelivery(threadId: string, delivery: RuntimeMailboxDelivery, turnId?: string): Promise<void> {
    return this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'), threadId, turnId, type: 'mailbox.delivered',
      createdAt: this.options.clock.now().toISOString(), payload: delivery,
    });
  }

  private async deliverToActiveTask(task: RuntimeTurnTask, delivery: RuntimeMailboxDelivery): Promise<void> {
    task.inputQueue.beginWrite();
    try {
      if (task.controller.signal.aborted) throw new Error('no active turn to deliver mailbox input');
      await this.recordMailboxDelivery(task.threadId, delivery, task.turnId);
      task.inputQueue.enqueueMailbox(delivery);
    } finally {
      task.inputQueue.settleWrite();
    }
  }

  private async deliverThreadMessage(threadId: string, delivery: RuntimeMailboxDelivery, signal?: AbortSignal): Promise<DeliverMailboxResponse> {
    signal?.throwIfAborted();
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread || !acceptsThreadMessages(thread)) throw new Error('The receiving conversation is unavailable.');
    signal?.throwIfAborted();
    const previous = thread.mailboxDeliveries?.find((entry) => entry.id === delivery.id);
    if (previous) return { accepted: true, duplicate: true, turnId: previous.turnId ?? null };

    const active = this.options.turnTasks.activeForThread(threadId);
    if (active && turnTaskCanConsumeThreadMessages(active) && turnTaskCanReceiveMailbox(active)) {
      await this.deliverToActiveTask(active, delivery);
      return { accepted: true, turnId: active.turnId };
    }
    // The delivery is durable independently of model availability or a race to start the next turn.
    await this.recordMailboxDelivery(threadId, delivery);
    const turnId = await this.wakeThreadMessageTurn(threadId);
    return { accepted: true, turnId, ...(turnId ? {} : { queued: true }) };
  }

  private async wakeThreadMessageTurn(threadId: string): Promise<string | null> {
    try {
      const thread = await this.options.threadStore.getThread(threadId);
      if (!thread || !acceptsThreadMessages(thread)) return null;
      const pending = pendingMailboxDeliveries(thread).find((entry) => entry.threadMessage);
      if (!pending || thread.queuedTurnInputs?.length) return null;
      const task = this.options.turnTasks.registeredForThread(threadId);
      if (task) {
        this.deferThreadMessageWake(task);
        return null;
      }
      const turnId = this.options.ids.id('turn');
      await this.options.createMailboxTriggeredRun(threadId, thread, turnId, pending.content,
        { threadMessageTurn: true }, async () => undefined);
      return turnId;
    } catch {
      // Another turn may have claimed the slot during model resolution. The mailbox remains queued.
      const task = this.options.turnTasks.registeredForThread(threadId);
      if (task) this.deferThreadMessageWake(task);
      return null;
    }
  }

  private deferThreadMessageWake(task: RuntimeTurnTask): void {
    if (!task.done || this.deferredWakes.has(task)) return;
    this.deferredWakes.add(task);
    const { threadId } = task;
    void task.done.then(() => {
      if (task.controller.signal.aborted) return;
      return this.options.mutateThread(threadId, () => this.serializeThreadMessage(threadId, () => this.wakeThreadMessageTurn(threadId)));
    }).catch(() => undefined);
  }

  private serializeThreadMessage<T>(threadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.threadMessageWrites.get(threadId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.threadMessageWrites.set(threadId, next);
    return next.finally(() => {
      if (this.threadMessageWrites.get(threadId) === next) this.threadMessageWrites.delete(threadId);
    });
  }

  async drainSteers(threadId: string, turnId: string): Promise<RuntimeQueuedSteer[]> {
    await this.waitForPendingWrites(threadId, turnId);
    const active = this.activeTask(threadId, turnId);
    return active?.inputQueue.takeSteers() ?? [];
  }

  async drainMailboxMessages(threadId: string, turnId: string): Promise<RuntimeMessage[]> {
    await this.waitForPendingWrites(threadId, turnId);
    const active = this.activeTask(threadId, turnId);
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread || !active) return [];
    const consumeThreadMessages = turnTaskCanConsumeThreadMessages(active) && acceptsThreadMessages(thread);
    const messages: RuntimeMessage[] = [];
    for (const delivery of pendingMailboxDeliveries(thread)) {
      if (delivery.threadMessage && !consumeThreadMessages) continue;
      active.controller.signal.throwIfAborted();
      const message = this.mailboxMessageForModel(turnId, delivery);
      // The persisted model message is the consumption receipt and survives a process restart.
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'), threadId, turnId, type: 'message.created',
        createdAt: message.createdAt, payload: { message },
      });
      messages.push(message);
    }
    // Only remove notifications whose durable deliveries were included in this snapshot.
    active.inputQueue.takeMailbox((thread.mailboxDeliveries ?? []).map((delivery) => delivery.id));
    return messages;
  }

  private activeTask(threadId: string, turnId: string): RuntimeTurnTask | null {
    const active = this.options.turnTasks.activeForThread(threadId);
    if (!active || active.turnId !== turnId || active.controller.signal.aborted) return null;
    return active;
  }

  private async waitForPendingWrites(threadId: string, turnId: string): Promise<void> {
    const active = this.activeTask(threadId, turnId);
    if (!active) return;
    await active.inputQueue.waitForWrites();
    if (this.activeTask(threadId, turnId) !== active || active.controller.signal.aborted) return;
  }

  private mailboxMessageForModel(turnId: string, input: RuntimeMailboxDelivery): RuntimeMessage {
    const fromAttribute = input.fromAgentId ? ` from_agent_id="${escapeSkillAttribute(input.fromAgentId)}"` : '';
    const fromThreadId = input.threadMessage?.from.id ?? input.fromThreadId;
    const fromThreadAttribute = fromThreadId ? ` from_thread_id="${escapeSkillAttribute(fromThreadId)}"` : '';
    const toAttribute = input.toAgentId ? ` to_agent_id="${escapeSkillAttribute(input.toAgentId)}"` : '';
    const modeAttribute = input.deliveryMode ? ` delivery_mode="${escapeSkillAttribute(input.deliveryMode)}"` : '';
    const triggerAttribute = input.triggerTurn ? ' trigger_turn="true"' : '';
    const threadMessage = input.threadMessage;
    const kindAttribute = threadMessage ? ' kind="conversation"' : '';
    const replyAttribute = threadMessage?.replyTo ? ` reply_to="${escapeSkillAttribute(threadMessage.replyTo)}"` : '';
    return {
      id: mailboxMessageId(input.id),
      turnId,
      role: 'user',
      promptSource: input.fromAgentId || fromThreadId ? 'collaboration' : undefined,
      ...(threadMessage ? { threadMessage } : {}),
      content: `<mailbox_message id="${escapeSkillAttribute(input.id)}"${fromAttribute}${fromThreadAttribute}${toAttribute}${modeAttribute}${triggerAttribute}${kindAttribute}${replyAttribute}>\n${neutralizeMailboxTags(input.content)}\n</mailbox_message>`,
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'model',
    };
  }
}

function pendingMailboxDeliveries(thread: RuntimeThread) {
  if (!thread.mailboxDeliveries?.length) return [];
  const messageIds = new Set(thread.messages.map((message) => message.id));
  return thread.mailboxDeliveries.filter((delivery) => (
    !delivery.consumed && !messageIds.has(mailboxMessageId(delivery.id))
    // A cleared or deleted transcript entry must not wake the conversation again.
    && (!delivery.threadMessage || messageIds.has(threadMessageTranscriptId(delivery.id)))
  ));
}

function turnTaskCanConsumeThreadMessages(task: RuntimeTurnTask): boolean {
  return task.taskKind === 'regular' || task.taskKind === 'goal';
}

function turnTaskCanReceiveMailbox(task: RuntimeTurnTask): boolean {
  return (task.taskKind === 'regular' || task.taskKind === 'goal' || task.taskKind === 'subagent')
    && task.acceptingSteers && !task.controller.signal.aborted;
}
