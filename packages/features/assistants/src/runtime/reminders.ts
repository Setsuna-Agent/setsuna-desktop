import { nextAutomationRun } from '@setsuna-desktop/feature-automation/contracts';
import {
  assistantReminderDraftCodec, type Assistant, type AssistantReminder, type AssistantReminderDraft, type AssistantsRuntimeHost, type AssistantsState,
} from '../contracts/index.js';
import type { AssistantDirectory } from './directory.js';
import { failure } from './directory.js';
import type { AssistantDeliveryOutbox, AssistantTurnRoute } from './deliveries.js';
import { samePeer } from './deliveries.js';
import type { AssistantsStateStore } from './state-store.js';

const TICK_MS = 5_000;

/** Calendar calculation is shared with Automation; execution stays in the assistant's own chat. */
export class AssistantReminders {
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private ticking: Promise<void> | null = null;

  constructor(
    private readonly host: AssistantsRuntimeHost,
    private readonly store: AssistantsStateStore,
    private readonly directory: AssistantDirectory,
    private readonly outbox: AssistantDeliveryOutbox,
    private readonly onError: (error: unknown) => void,
  ) {}

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => { void this.tick().catch(this.onError); }, TICK_MS);
    this.timer.unref?.();
    void this.tick().catch(this.onError);
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  visible(assistantId: string, route?: AssistantTurnRoute): AssistantReminder[] {
    return this.store.current.reminders.filter((item) => item.assistantId === assistantId && (!route
      || (item.peer && samePeer(item.peer, route.peer) && (route.peer.kind !== 'group' || item.initiator === route.initiator))));
  }

  latestDelivery(id: string) {
    for (let index = this.store.current.deliveries.length - 1; index >= 0; index -= 1) {
      const delivery = this.store.current.deliveries[index]!;
      if (delivery.reminderId === id) return { status: delivery.status, ...(delivery.error && delivery.status !== 'sent' ? { error: delivery.error } : {}) };
    }
    return undefined;
  }

  isScheduledTurn(threadId: string, turnId?: string): boolean {
    return Boolean(turnId && this.store.current.reminders.some((item) => item.lastRun?.threadId === threadId && item.lastRun.turnId === turnId));
  }

  async create(assistant: Assistant, input: AssistantReminderDraft, route?: AssistantTurnRoute): Promise<AssistantReminder> {
    const draft = assistantReminderDraftCodec.parse(input);
    return this.store.mutate(({ state }) => {
      const owner = this.requireAssistant(state.assistants, assistant.id);
      if (route) this.requireRecipient(state, assistant.id, route.peer);
      const existing = this.visible(assistant.id, route).find((item) => item.status === 'active'
        && item.instructions === draft.instructions && JSON.stringify(item.schedule) === JSON.stringify(draft.schedule)
        && Boolean(item.peer) === Boolean(route) && (!route || item.qqAppId === owner.qq?.appId));
      if (existing) return structuredClone(existing);
      const now = this.host.now();
      const reminder: AssistantReminder = {
        ...draft, id: this.host.id('assistant_reminder'), assistantId: assistant.id,
        ...(route ? { peer: route.peer, qqAppId: owner.qq!.appId,
          ...(route.initiator ? { initiator: route.initiator } : {}) } : {}),
        status: 'active', nextRunAt: this.future(draft, now), createdAt: now.toISOString(), updatedAt: now.toISOString(),
      };
      state.reminders.push(reminder);
      return structuredClone(reminder);
    });
  }

  async change(assistantId: string, id: string, mode: 'update' | 'pause' | 'resume' | 'delete', input: Record<string, unknown>, route?: AssistantTurnRoute): Promise<AssistantReminder | null> {
    return this.store.mutate(({ state }) => {
      this.requireAssistant(state.assistants, assistantId);
      if (!this.visible(assistantId, route).some((item) => item.id === id)) throw failure('ASSISTANT_NOT_FOUND', '提醒不存在。');
      const reminder = state.reminders.find((item) => item.id === id)!;
      if (mode === 'delete' || mode === 'pause') {
        cancelReminderDeliveries(state, id);
        if (reminder.lastRun && !reminder.lastRun.turnId) delete reminder.lastRun;
      }
      if (mode === 'delete') { state.reminders = state.reminders.filter((item) => item.id !== id); return null; }
      const now = this.host.now();
      if (mode === 'update') {
        const draft = assistantReminderDraftCodec.parse({ ...reminder, ...input });
        const changed = JSON.stringify(draft.schedule) !== JSON.stringify(reminder.schedule);
        // A busy chat has not accepted this intent yet. Editing its time/content replaces that pending occurrence.
        if ((changed || draft.instructions !== reminder.instructions) && reminder.lastRun && !reminder.lastRun.turnId) delete reminder.lastRun;
        Object.assign(reminder, draft);
        if (changed) {
          reminder.nextRunAt = reminder.status === 'paused' ? null : this.future(draft, now);
          if (reminder.status === 'completed') reminder.status = 'active';
        }
      } else {
        if (mode === 'resume' && reminder.peer) this.requireRecipient(state, assistantId, reminder.peer, reminder.qqAppId);
        if (reminder.lastRun && !reminder.lastRun.turnId) delete reminder.lastRun;
        reminder.nextRunAt = mode === 'pause' ? null : this.future(reminder, now);
        reminder.status = mode === 'pause' ? 'paused' : 'active';
      }
      reminder.updatedAt = now.toISOString();
      return structuredClone(reminder);
    });
  }

  /** No writes or history reads when there are no due reminders. Overlapping ticks share work. */
  tick(): Promise<void> {
    if (this.stopped || this.store.isMaintenancePaused()) return Promise.resolve();
    if (this.ticking) return this.ticking;
    const now = this.host.now().getTime();
    const due = this.store.current.reminders.filter((item) => item.status === 'active'
      && ((item.lastRun && !item.lastRun.turnId) || (item.nextRunAt && Date.parse(item.nextRunAt) <= now))).map((item) => item.id);
    if (!due.length) return Promise.resolve();
    this.ticking = this.dispatchDue(due).finally(() => { this.ticking = null; });
    return this.ticking;
  }

  private async dispatchDue(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (this.stopped || this.store.isMaintenancePaused()) return;
      await this.store.mutate(async (transaction) => {
        const { state } = transaction;
        const reminder = state.reminders.find((item) => item.id === id);
        if (this.stopped || !reminder || reminder.status !== 'active') return;
        // A queued edit may have moved the time since tick() selected these IDs.
        if ((!reminder.lastRun || reminder.lastRun.turnId) && (!reminder.nextRunAt || Date.parse(reminder.nextRunAt) > this.host.now().getTime())) return;
        const assistant = state.assistants.find((item) => item.id === reminder.assistantId);
        const allowed = !reminder.peer || (assistant?.qq?.enabled && assistant.qq.appId === reminder.qqAppId && state.peers.some((item) => item.assistantId === reminder.assistantId
          && item.status === 'allowed' && samePeer(item, reminder.peer!)));
        if (!assistant || !allowed) {
          reminder.status = 'paused'; reminder.nextRunAt = null;
          if (reminder.lastRun && !reminder.lastRun.turnId) delete reminder.lastRun;
          return;
        }
        if (reminder.lastRun?.turnId && (await this.host.turnOutcome(reminder.lastRun.threadId, reminder.lastRun.turnId)).status === 'running') return;
        const run = reminder.lastRun && !reminder.lastRun.turnId ? reminder.lastRun : {
          id: this.host.id('reminder_run'), threadId: await this.directory.ensureConversation(state, assistant),
          scheduledFor: reminder.nextRunAt!, instructions: reminder.instructions,
        };
        reminder.lastRun = run;
        // Reserve the receipt and its immutable prompt before Core can start the turn.
        await transaction.commit();
        if (this.stopped) return;
        const { turnId } = await this.host.deliverMailbox(run.threadId, {
          id: run.id,
          thinkingEffort: assistant.thinkingEffort ?? '',
          content: `定时提醒「${reminder.title}」已到执行时间（${run.scheduledFor}）。这是已保存提醒的本次触发，请根据下面的要求生成这一次消息，不要重新创建定时任务。\n\n${run.instructions}`,
        });
        if (this.stopped || !turnId) return;
        run.turnId = turnId;
        if (reminder.peer) this.outbox.expectReply(state, {
          assistantId: reminder.assistantId, reminderId: reminder.id, peer: reminder.peer,
          threadId: run.threadId, turnId, ...(reminder.initiator ? { initiator: reminder.initiator } : {}),
        });
        reminder.nextRunAt = nextAutomationRun(reminder.schedule, this.host.now(), run.scheduledFor);
        if (!reminder.nextRunAt) reminder.status = 'completed';
        reminder.updatedAt = this.host.now().toISOString();
      }).catch(this.onError);
    }
    if (!this.stopped) await this.outbox.recover();
  }

  private future(draft: AssistantReminderDraft, now: Date): string {
    const next = nextAutomationRun(draft.schedule, now);
    if (!next) throw failure('INVALID_INPUT', '请选择未来的提醒时间。');
    return next;
  }

  private requireAssistant(assistants: readonly Assistant[], id: string): Assistant {
    const assistant = assistants.find((item) => item.id === id);
    if (!assistant) throw failure('ASSISTANT_NOT_FOUND', '助理不存在。');
    return assistant;
  }

  private requireRecipient(state: AssistantsState, assistantId: string, peer: NonNullable<AssistantReminder['peer']>, appId?: string): void {
    if (appId && state.assistants.find((item) => item.id === assistantId)?.qq?.appId !== appId) {
      throw failure('INVALID_INPUT', 'QQ 机器人已更换，请从新的 QQ 会话重新创建提醒。');
    }
    if (!state.assistants.find((item) => item.id === assistantId)?.qq?.enabled
      || !state.peers.some((item) => item.assistantId === assistantId && item.status === 'allowed' && samePeer(item, peer))) {
      throw failure('INVALID_INPUT', '这个 QQ 来源尚未授权或 QQ 连接已停用。');
    }
  }
}

/** Cancelling a reminder also withdraws replies that have not yet been sent to QQ. */
export function cancelReminderDeliveries(state: AssistantsState, id: string): void {
  for (const delivery of state.deliveries.filter((item) => item.reminderId === id && (item.status === 'waiting' || item.status === 'ready'))) {
    Object.assign(delivery, { status: 'failed', error: '提醒已取消或暂停。' });
  }
}
