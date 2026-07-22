import type {
  RuntimeMailboxDelivery,
  RuntimeMessage,
  RuntimeThread,
  SendTurnResponse,
  SteerTurnInput,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { escapeSkillAttribute, neutralizeMailboxTags } from '../context/prompt-utils.js';
import type { RuntimeModelInputGuard } from '../core/runtime-model-input-guard.js';
import type { RuntimeQueuedSteer } from './turn-input-queue.js';
import { RuntimeTurnTaskRegistry, type RuntimeTurnTask } from './turn-task-registry.js';

export type DeliverMailboxInput = {
  content: string;
  deliveryMode?: RuntimeMailboxDelivery['deliveryMode'];
  expectedTurnId?: string;
  fromAgentId?: string;
  fromThreadId?: string;
  id?: string;
  toAgentId?: string;
  triggerTurn?: boolean;
};

export type DeliverMailboxResponse = {
  accepted: true;
  queued?: boolean;
  turnId: string | null;
};

type RuntimeTurnInputCoordinatorOptions = {
  clock: Clock;
  ids: IdGenerator;
  inputGuard: Pick<RuntimeModelInputGuard, 'assertAttachmentsSupported'>;
  claimAttachments(threadId: string, attachments: NonNullable<RuntimeMessage['attachments']>): Promise<NonNullable<RuntimeMessage['attachments']>>;
  normalizeAttachments(value: unknown): NonNullable<RuntimeMessage['attachments']>;
  threadStore: ThreadStore;
  turnTasks: RuntimeTurnTaskRegistry;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
  createMailboxTriggeredRun(threadId: string, thread: RuntimeThread, turnId: string, content: string): { done: Promise<void> };
  publishMessage(threadId: string, turnId: string, message: RuntimeMessage): Promise<void>;
};

/** 管理活动轮次的 steer 与邮箱队列及其持久化边界。 */
export class RuntimeTurnInputCoordinator {
  private readonly idleMailboxByThread = new Map<string, RuntimeMailboxDelivery[]>();

  constructor(private readonly options: RuntimeTurnInputCoordinatorOptions) {}

  clear(): void {
    this.idleMailboxByThread.clear();
  }

  async steer(threadId: string, input: SteerTurnInput): Promise<SendTurnResponse> {
    const text = input.input.trim();
    const attachments = this.options.normalizeAttachments(input.attachments);
    if (!text && !attachments.length) throw new Error('input must not be empty');
    await this.options.inputGuard.assertAttachmentsSupported(attachments);

    const active = this.options.turnTasks.activeForThread(threadId);
    if (!active || active.controller.signal.aborted) throw new Error('no active turn to steer');
    if (!turnTaskAcceptsInteractiveInput(active)) throw new Error(`cannot steer a ${active.taskKind} turn`);
    if (active.turnId !== input.expectedTurnId) {
      throw new Error(`expected active turn id \`${input.expectedTurnId}\` but found \`${active.turnId}\``);
    }
    if (!active.acceptingSteers) throw new Error('active turn is finishing and can no longer be steered');
    active.inputQueue.beginWrite();
    try {
      const thread = await this.options.threadStore.getThread(threadId);
      if (!thread) throw new Error(`Thread not found: ${threadId}`);
      if (active.controller.signal.aborted) throw new Error('no active turn to steer');
      const claimedAttachments = await this.options.claimAttachments(threadId, attachments);
      const message: RuntimeMessage = {
        id: this.options.ids.id('msg'),
        clientId: input.clientId,
        turnId: active.turnId,
        role: 'user',
        content: text,
        attachments: claimedAttachments,
        createdAt: this.options.clock.now().toISOString(),
        status: 'complete',
      };
      await this.options.publishMessage(threadId, active.turnId, message);
      active.inputQueue.enqueueSteer({
        message,
        skillIds: [...new Set((input.skillIds ?? []).map((skillId) => skillId.trim()).filter(Boolean))],
        ...(typeof input.thinking === 'boolean' ? { thinking: input.thinking } : {}),
        ...(input.thinking === true && input.thinkingEffort?.trim() ? { thinkingEffort: input.thinkingEffort.trim() } : {}),
      });
      return { accepted: true, turnId: active.turnId };
    } finally {
      active.inputQueue.settleWrite();
    }
  }

  async deliverMailbox(threadId: string, input: DeliverMailboxInput): Promise<DeliverMailboxResponse> {
    const content = input.content.trim();
    if (!content) throw new Error('mailbox content must not be empty');
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
      active.inputQueue.beginWrite();
      try {
        if (active.controller.signal.aborted) throw new Error('no active turn to deliver mailbox input');
        await this.options.appendEvent(threadId, {
          id: this.options.ids.id('event'),
          threadId,
          turnId: active.turnId,
          type: 'mailbox.delivered',
          createdAt: this.options.clock.now().toISOString(),
          payload: delivery,
        });
        active.inputQueue.enqueueMailbox(delivery);
        return { accepted: true, turnId: active.turnId };
      } finally {
        active.inputQueue.settleWrite();
      }
    }

    if (triggerTurn && !active) {
      const turnId = this.options.ids.id('turn');
      this.queueIdleMailbox(threadId, delivery);
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'mailbox.delivered',
        createdAt: this.options.clock.now().toISOString(),
        payload: delivery,
      });
      const run = this.options.createMailboxTriggeredRun(threadId, thread, turnId, content);
      void run.done.catch(() => undefined);
      return { accepted: true, turnId };
    }

    this.queueIdleMailbox(threadId, delivery);
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      type: 'mailbox.delivered',
      createdAt: this.options.clock.now().toISOString(),
      payload: delivery,
    });
    return { accepted: true, queued: true, turnId: null };
  }

  async drainSteers(threadId: string, turnId: string): Promise<RuntimeQueuedSteer[]> {
    await this.waitForPendingWrites(threadId, turnId);
    const active = this.activeTask(threadId, turnId);
    return active?.inputQueue.takeSteers() ?? [];
  }

  async drainMailboxMessages(threadId: string, turnId: string): Promise<RuntimeMessage[]> {
    await this.waitForPendingWrites(threadId, turnId);
    const pendingIdle = this.takeIdleMailbox(threadId);
    const active = this.activeTask(threadId, turnId);
    return [
      ...pendingIdle,
      ...(active?.inputQueue.takeMailbox() ?? []),
    ].map((delivery) => this.mailboxMessageForModel(turnId, delivery));
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

  private queueIdleMailbox(threadId: string, input: RuntimeMailboxDelivery): void {
    const pending = this.idleMailboxByThread.get(threadId) ?? [];
    pending.push(input);
    this.idleMailboxByThread.set(threadId, pending);
  }

  private takeIdleMailbox(threadId: string): RuntimeMailboxDelivery[] {
    const pending = this.idleMailboxByThread.get(threadId);
    if (!pending?.length) return [];
    this.idleMailboxByThread.delete(threadId);
    return pending;
  }

  private mailboxMessageForModel(turnId: string, input: RuntimeMailboxDelivery): RuntimeMessage {
    const fromAttribute = input.fromAgentId ? ` from_agent_id="${escapeSkillAttribute(input.fromAgentId)}"` : '';
    const fromThreadAttribute = input.fromThreadId ? ` from_thread_id="${escapeSkillAttribute(input.fromThreadId)}"` : '';
    const toAttribute = input.toAgentId ? ` to_agent_id="${escapeSkillAttribute(input.toAgentId)}"` : '';
    const modeAttribute = input.deliveryMode ? ` delivery_mode="${escapeSkillAttribute(input.deliveryMode)}"` : '';
    const triggerAttribute = input.triggerTurn ? ' trigger_turn="true"' : '';
    return {
      id: `mailbox_${input.id}`,
      turnId,
      role: 'user',
      content: `<mailbox_message id="${escapeSkillAttribute(input.id)}"${fromAttribute}${fromThreadAttribute}${toAttribute}${modeAttribute}${triggerAttribute}>\n${neutralizeMailboxTags(input.content)}\n</mailbox_message>`,
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'model',
    };
  }
}

function turnTaskCanReceiveMailbox(task: RuntimeTurnTask): boolean {
  return turnTaskAcceptsInteractiveInput(task) && task.acceptingSteers && !task.controller.signal.aborted;
}

function turnTaskAcceptsInteractiveInput(task: RuntimeTurnTask): boolean {
  return task.taskKind === 'regular' || task.taskKind === 'goal';
}
