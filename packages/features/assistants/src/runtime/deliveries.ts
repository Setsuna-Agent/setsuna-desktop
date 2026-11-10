import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type {
  AssistantDelivery, AssistantPeerRef, AssistantsRuntimeHost, AssistantsState, AssistantTurnOutcome,
} from '../contracts/index.js';
import { passiveReply, splitReply } from './qq/qq-messages.js';
import { QqApiError } from './qq/qq-api.js';
import type { AssistantsStateStore } from './state-store.js';
import { clip } from './task-reports.js';

/** Sends one text message to a QQ peer; replyTo makes it a passive reply to an inbound message. */
export type AssistantReplySender = {
  send(peer: AssistantPeerRef, message: { content: string; replyTo?: { messageId: string; seq: number } }): Promise<void>;
};

export type AssistantTurnRoute = { peer: AssistantPeerRef; messageId?: string; initiator?: string };

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000] as const;
const SETTLED_DELIVERY_LIMIT = 200;
const INBOX_LIMIT = 500;

export function samePeer(left: AssistantPeerRef, right: AssistantPeerRef): boolean {
  return left.kind === right.kind && left.openid === right.openid;
}

/** Text sent back to QQ when an assistant turn ends; undefined means there is nothing to say. */
export function replyContent(outcome: AssistantTurnOutcome): string | undefined {
  if (outcome.finalAnswer?.trim()) return clip(outcome.finalAnswer, 64_000);
  if (outcome.status === 'failed') return `抱歉，这次处理失败了：${outcome.error ?? '未知错误'}`;
  if (outcome.status === 'interrupted' || outcome.status === 'missing') return '处理被中断了，请重新发送。';
  return undefined;
}

export function pruneInbox(state: AssistantsState): void {
  if (state.inbox.length > INBOX_LIMIT) state.inbox = state.inbox.slice(-INBOX_LIMIT);
}

/**
 * Durable outbox for QQ replies. A delivery waits for its assistant turn, captures the visible answer
 * once, and is then retried on its own: a failed send never re-runs the turn that produced it.
 */
export class AssistantDeliveryOutbox {
  private readonly senders = new Map<string, AssistantReplySender>();
  private watched = new Set<string>();
  private flushing = false;
  private flushAgain = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly host: AssistantsRuntimeHost,
    private readonly store: AssistantsStateStore,
    private readonly onError: (error: unknown) => void,
  ) {
    store.onCommit((state) => {
      this.watched = new Set(state.deliveries.flatMap((item) => item.status === 'waiting' && item.threadId ? [item.threadId] : []));
    });
  }

  setSender(assistantId: string, sender: AssistantReplySender | null): void {
    if (sender) this.senders.set(assistantId, sender);
    else this.senders.delete(assistantId);
    if (sender) void this.flush();
  }

  /** Registers a reply for an assistant turn (or a ready notice). Must run inside a state mutation. */
  expectReply(state: AssistantsState, input: Pick<AssistantDelivery, 'assistantId' | 'peer'>
    & Partial<Pick<AssistantDelivery, 'threadId' | 'turnId' | 'clientId' | 'replyToMessageId' | 'initiator' | 'content' | 'projectIds' | 'reminderId'>>): AssistantDelivery {
    const existing = input.turnId && state.deliveries.find((item) => item.threadId === input.threadId
      && item.turnId === input.turnId && samePeer(item.peer, input.peer));
    if (existing) return existing;
    const now = this.host.now().toISOString();
    const delivery: AssistantDelivery = {
      ...input, id: this.host.id('assistant_reply'), status: input.content ? 'ready' : 'waiting',
      sentChunks: 0, attempts: 0, createdAt: now, updatedAt: now,
    };
    state.deliveries.push(delivery);
    const settled = state.deliveries.filter((item) => item.status === 'sent' || item.status === 'failed');
    if (settled.length > SETTLED_DELIVERY_LIMIT) {
      const dropped = new Set(settled.slice(0, settled.length - SETTLED_DELIVERY_LIMIT));
      state.deliveries = state.deliveries.filter((item) => !dropped.has(item));
    }
    return delivery;
  }

  /** QQ route of the inbound message that started an assistant turn, used to attribute dispatched tasks. */
  routeForTurn(threadId: string, turnId: string | undefined): AssistantTurnRoute | undefined {
    const delivery = this.store.current.deliveries.find((item) => item.threadId === threadId && turnId && item.turnId === turnId);
    return delivery ? { peer: delivery.peer, messageId: delivery.replyToMessageId, initiator: delivery.initiator } : undefined;
  }

  handleEvent(event: StoredThreadEvent): void {
    if (!this.watched.has(event.threadId)) return;
    const relevant = (event.type === 'message.created' && event.payload.message.role === 'user' && event.payload.message.clientId)
      || ((event.type === 'turn.completed' || event.type === 'turn.cancelled' || event.type === 'runtime.error') && event.turnId);
    if (!relevant) return;
    void this.store.mutate(async ({ state }) => {
      for (const delivery of state.deliveries.filter((item) => item.status === 'waiting' && item.threadId === event.threadId)) {
        if (event.type === 'message.created') {
          const message = event.payload.message;
          if (!delivery.turnId && delivery.clientId === message.clientId && message.turnId) delivery.turnId = message.turnId;
        } else if (delivery.turnId === event.turnId) {
          await this.settle(delivery);
        }
      }
    }).then(() => this.flush()).catch(this.onError);
  }

  /** Resolves deliveries whose turns finished while the runtime was down, then resends owed replies. */
  async recover(): Promise<void> {
    await this.store.mutate(async ({ state }) => {
      for (const delivery of state.deliveries.filter((item) => item.status === 'waiting')) {
        if (!delivery.threadId) continue;
        if (!delivery.turnId && delivery.clientId) {
          const location = await this.host.locateInput(delivery.threadId, { clientId: delivery.clientId });
          if (location.state === 'queued') continue;
          if (location.state === 'started') delivery.turnId = location.turnId;
        }
        if (delivery.turnId) await this.settle(delivery);
        else this.ready(delivery, replyContent({ status: 'missing' }));
      }
    });
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) { this.flushAgain = true; return; }
    this.flushing = true;
    try {
      do {
        this.flushAgain = false;
        await this.sendDue();
      } while (this.flushAgain && !this.disposed);
    } catch (error) {
      this.onError(error);
    } finally {
      this.flushing = false;
      this.scheduleRetry();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.senders.clear();
  }

  private async settle(delivery: AssistantDelivery): Promise<void> {
    const outcome = await this.host.turnOutcome(delivery.threadId!, delivery.turnId!);
    if (outcome.status !== 'running') this.ready(delivery, replyContent(outcome));
  }

  private ready(delivery: AssistantDelivery, content: string | undefined): void {
    delivery.updatedAt = this.host.now().toISOString();
    if (content) Object.assign(delivery, { status: 'ready', content });
    else delivery.status = 'sent';
  }

  private async sendDue(): Promise<void> {
    const now = this.host.now().getTime();
    const due = this.store.current.deliveries.filter((item) => item.status === 'ready' && this.senders.has(item.assistantId)
      && (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now));
    for (const { id } of due) {
      if (this.disposed) return;
      await this.send(id);
    }
  }

  /** Sends remaining chunks in order; progress is persisted per chunk so a retry never duplicates text. */
  private async send(deliveryId: string): Promise<void> {
    for (;;) {
      const delivery = this.store.current.deliveries.find((item) => item.id === deliveryId);
      const sender = delivery && this.senders.get(delivery.assistantId);
      if (!delivery || !sender || delivery.status !== 'ready' || !delivery.content) return;
      const assistant = this.store.current.assistants.find((item) => item.id === delivery.assistantId);
      const peer = this.store.current.peers.find((item) => item.assistantId === delivery.assistantId && samePeer(item, delivery.peer));
      const reminder = delivery.reminderId ? this.store.current.reminders.find((item) => item.id === delivery.reminderId) : undefined;
      if (!assistant || !peer || (delivery.threadId && peer.status !== 'allowed')
        || (delivery.reminderId && (!reminder || reminder.assistantId !== delivery.assistantId || reminder.status === 'paused' || !assistant.qq?.enabled || reminder.qqAppId !== assistant.qq.appId
          || !reminder.peer || !samePeer(reminder.peer, delivery.peer)))
        || delivery.projectIds?.some((projectId) => !assistant.projectIds.includes(projectId))) {
        await this.store.mutate(({ state }) => {
          const current = state.deliveries.find((item) => item.id === deliveryId);
          if (current) Object.assign(current, { status: 'failed', error: '回报授权已被撤销。' });
        });
        return;
      }
      const chunks = splitReply(delivery.content);
      const index = delivery.sentChunks;
      const inbox = delivery.replyToMessageId && !delivery.activeOnly
        ? this.store.current.inbox.find((item) => item.assistantId === delivery.assistantId && item.messageId === delivery.replyToMessageId)
        : undefined;
      const replyTo = passiveReply(inbox, this.host.now());
      try {
        if (index < chunks.length) await sender.send(delivery.peer, { content: chunks[index]!, ...(replyTo ? { replyTo } : {}) });
      } catch (error) {
        await this.recordFailure(deliveryId, error, Boolean(replyTo));
        return;
      }
      await this.store.mutate(({ state }) => {
        const current = state.deliveries.find((item) => item.id === deliveryId);
        if (!current) return;
        current.sentChunks = index + 1;
        current.updatedAt = this.host.now().toISOString();
        if (current.sentChunks >= chunks.length) Object.assign(current, { status: 'sent', attempts: 0 });
        const entry = replyTo && state.inbox.find((item) => item.assistantId === current.assistantId && item.messageId === replyTo.messageId);
        if (entry) entry.repliesUsed = replyTo!.seq;
      });
    }
  }

  private recordFailure(deliveryId: string, error: unknown, passive: boolean): Promise<void> {
    return this.store.mutate(({ state }) => {
      const delivery = state.deliveries.find((item) => item.id === deliveryId);
      if (!delivery) return;
      const now = this.host.now();
      delivery.attempts += 1;
      delivery.error = (error instanceof Error ? error.message : String(error)).slice(0, 4_000);
      delivery.updatedAt = now.toISOString();
      // An expired or exhausted msg_id fails every time; later attempts go out as active messages.
      const rateLimited = error instanceof QqApiError && (error.code === 40034100 || error.status === 429);
      if (passive && !rateLimited && !(error instanceof QqApiError && error.status >= 500)) delivery.activeOnly = true;
      const retryDelay = RETRY_DELAYS_MS[delivery.attempts - 1];
      const delay = retryDelay === undefined ? undefined : rateLimited ? Math.max(60_000, retryDelay) : retryDelay;
      if (delay === undefined) delivery.status = 'failed';
      else delivery.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.disposed) return;
    const next = this.store.current.deliveries
      .filter((item) => item.status === 'ready' && item.nextAttemptAt && this.senders.has(item.assistantId))
      .map((item) => Date.parse(item.nextAttemptAt!))
      .sort((left, right) => left - right)[0];
    if (next === undefined) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flush(); }, Math.max(0, next - this.host.now().getTime()));
    this.retryTimer.unref?.();
  }
}
