import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantPeerRef } from '../../src/contracts/index.js';
import { AssistantDeliveryOutbox, type AssistantReplySender } from '../../src/runtime/deliveries.js';
import { AssistantDirectory } from '../../src/runtime/directory.js';
import { AssistantReminders } from '../../src/runtime/reminders.js';
import { AssistantsStateStore } from '../../src/runtime/state-store.js';
import { AssistantSidebarEntries } from '../../src/runtime/sidebar-entries.js';
import { completed, fixture } from './fixture.js';
import { deferred } from '../support/deferred.js';

const daily = { title: '早安', instructions: '给我发一句早安', schedule: { kind: 'daily' as const, time: '09:00', timeZone: 'Asia/Shanghai' } };

async function qqRoute(f: Awaited<ReturnType<typeof fixture>>, peer: AssistantPeerRef = { kind: 'c2c', openid: 'user_a' }, initiator?: string) {
  await f.directory.update(f.assistant.id, { ...f.assistant, qq: { appId: '123', enabled: true } });
  const turnId = f.host.id('inbound');
  await f.store.mutate(({ state }) => {
    const at = f.host.now().toISOString();
    if (!state.peers.some((item) => item.openid === peer.openid && item.kind === peer.kind)) {
      state.peers.push({ ...peer, assistantId: f.assistant.id, status: 'allowed', firstSeenAt: at, lastSeenAt: at });
    }
    // The original reply is already sent; its durable receipt still identifies the requesting QQ source.
    f.outbox.expectReply(state, { assistantId: f.assistant.id, peer, initiator, threadId: f.conversation.threadId, turnId, replyToMessageId: 'old_message' }).status = 'sent';
  });
  return { threadId: f.conversation.threadId, turnId };
}

describe('助理定时消息', () => {
  it('QQ 请求持久保存日历与来源，到点续接同一聊天；发送失败只重发消息，重复请求不创建第二份提醒', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = await fixture();
    const context = await qqRoute(f);
    const create = () => f.tools.run('assistant_manage_reminder', { mode: 'create', ...daily }, context);
    const result = JSON.parse((await create()).content).reminder;
    await create();
    expect(JSON.parse(await readFile(f.file, 'utf8')).reminders).toEqual([expect.objectContaining({
      id: result.reminder_id, nextRunAt: '2026-10-01T01:00:00.000Z', peer: { kind: 'c2c', openid: 'user_a' }, schedule: daily.schedule,
    })]);
    vi.mocked(f.host.deliverMailbox).mockImplementation(async () => {
      const turnId = f.host.id('reminder_turn');
      f.outcomes.set(turnId, { status: 'completed', finalAnswer: '早上好！' });
      return { turnId };
    });
    const send = vi.fn<AssistantReplySender['send']>().mockRejectedValueOnce(new Error('网络断开')).mockResolvedValue(undefined);
    f.outbox.setSender(f.assistant.id, { send });
    f.advance(3_599_999);
    await f.reminders.tick();
    expect(f.host.deliverMailbox).not.toHaveBeenCalled();
    f.advance(1);
    await f.reminders.tick();
    await vi.waitFor(() => expect(f.store.current.deliveries.at(-1)?.attempts).toBe(1));
    expect(f.host.deliverMailbox).toHaveBeenCalledTimes(1);
    expect(vi.mocked(f.host.deliverMailbox).mock.calls[0]?.[0]).toBe(f.conversation.threadId);
    expect(send.mock.calls[0]).toEqual([{ kind: 'c2c', openid: 'user_a' }, { content: '早上好！' }]);
    const listed = JSON.parse((await f.tools.run('assistant_manage_reminder', { mode: 'list' }, context)).content);
    expect(listed.reminders[0].last_delivery).toMatchObject({ status: 'ready', error: '网络断开' });
    f.advance(5_000);
    await f.outbox.flush();
    await vi.waitFor(() => expect(f.store.current.deliveries.at(-1)?.status).toBe('sent'));
    await f.reminders.tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(f.host.deliverMailbox).toHaveBeenCalledTimes(1);
    expect(f.store.current.reminders[0]?.nextRunAt).toBe('2026-10-02T01:00:00.000Z');
    await expect(f.tools.run('assistant_manage_reminder', { mode: 'create', ...daily }, {
      threadId: context.threadId, turnId: f.store.current.reminders[0]!.lastRun!.turnId,
    })).rejects.toThrow('定时触发');
    expect(f.host.createConversation).toHaveBeenCalledTimes(1);
  });

  it('恢复 Core 接收后、本地回执写入前的崩溃窗口，沿用同一个执行标识；错过多天只合并执行一次', async () => {
    const f = await fixture();
    const context = await qqRoute(f);
    await f.tools.run('assistant_manage_reminder', { mode: 'create', ...daily }, context);
    const receipts = new Map<string, string>();
    let executions = 0;
    vi.mocked(f.host.deliverMailbox).mockImplementation(async (_thread, input) => {
      const reserved = JSON.parse(await readFile(f.file, 'utf8')).reminders[0].lastRun;
      expect(reserved).toMatchObject({ id: input.id, instructions: daily.instructions });
      if (!receipts.has(input.id)) {
        executions += 1;
        receipts.set(input.id, 'accepted_turn');
        f.outcomes.set('accepted_turn', { status: 'completed', finalAnswer: '已执行' });
        throw new Error('回执返回前进程退出');
      }
      return { turnId: receipts.get(input.id)! };
    });
    f.advance(3_600_000);
    await f.reminders.tick();
    expect(f.store.current.reminders[0]?.lastRun?.turnId).toBeUndefined();
    f.reminders.dispose();
    f.outbox.dispose();
    await f.store.dispose();
    const store = new AssistantsStateStore(f.host.dataDir);
    await store.load();
    const directory = new AssistantDirectory(f.host, store, { connectorStatuses: () => [], assistantChanged: () => undefined });
    const outbox = new AssistantDeliveryOutbox(f.host, store, f.errors);
    const reminders = new AssistantReminders(f.host, store, directory, outbox, f.errors);
    f.advance(3 * 86_400_000);
    try {
      await reminders.tick();
      await reminders.tick();
      expect(executions).toBe(1);
      expect(store.current.reminders[0]).toMatchObject({ nextRunAt: '2026-10-05T01:00:00.000Z', lastRun: { turnId: 'accepted_turn' } });
      expect(store.current.deliveries.filter((item) => item.reminderId)).toEqual([expect.objectContaining({ status: 'ready', turnId: 'accepted_turn', content: '已执行' })]);
      const calls = vi.mocked(f.host.deliverMailbox).mock.calls;
      expect(calls[1]?.[1]).toEqual(calls[0]?.[1]);
    } finally { reminders.dispose(); outbox.dispose(); await store.dispose(); }
  });

  it('QQ 来源和群内发起者各自管理提醒；撤销授权阻止到点执行，桌面仍可取消', async () => {
    const f = await fixture();
    const group = { kind: 'group' as const, openid: 'group_a' };
    const owner = await qqRoute(f, group, 'member_a');
    const sameGroup = await qqRoute(f, group, 'member_b');
    const otherPeer = await qqRoute(f, { kind: 'c2c', openid: 'user_b' });
    const created = JSON.parse((await f.tools.run('assistant_manage_reminder', { mode: 'create', ...daily }, owner)).content).reminder;
    for (const context of [sameGroup, otherPeer]) {
      expect(JSON.parse((await f.tools.run('assistant_manage_reminder', { mode: 'list' }, context)).content).reminders).toEqual([]);
      await expect(f.tools.run('assistant_manage_reminder', { mode: 'delete', reminder_id: created.reminder_id }, context)).rejects.toThrow('提醒不存在');
    }
    const other = await f.directory.create({ name: '另一位助理', personality: '', projectIds: [] });
    const otherChat = await f.directory.openConversation(other.id);
    await expect(f.tools.run('assistant_manage_reminder', { mode: 'resume', reminder_id: created.reminder_id }, otherChat)).rejects.toThrow('提醒不存在');
    await f.directory.updatePeer(f.assistant.id, { ...group, status: 'removed' });
    f.advance(3_600_000);
    await f.reminders.tick();
    expect(f.host.deliverMailbox).not.toHaveBeenCalled();
    expect(f.store.current.reminders[0]?.status).toBe('paused');
    await f.tools.run('assistant_manage_reminder', { mode: 'delete', reminder_id: created.reminder_id }, { threadId: f.conversation.threadId });
    expect(JSON.parse(await readFile(f.file, 'utf8')).reminders).toEqual([]);
    const saved = await f.reminders.create(f.assistant, daily, f.outbox.routeForTurn(otherPeer.threadId, otherPeer.turnId));
    await f.directory.update(f.assistant.id, { ...f.assistant, qq: { appId: '456', enabled: true } });
    f.advance(86_400_000);
    await f.reminders.tick();
    expect(f.store.current.reminders[0]?.status).toBe('paused');
    expect(f.host.deliverMailbox).not.toHaveBeenCalled();
    await expect(f.reminders.change(f.assistant.id, saved.id, 'resume', {})).rejects.toThrow('QQ 机器人已更换');
  });

  it('暂停后即使旧轮次完成也不发送，恢复从未来时间开始；面板删除同时撤销尚未发送的消息', async () => {
    const f = await fixture();
    const context = await qqRoute(f);
    const reminder = await f.reminders.create(f.assistant, daily, f.outbox.routeForTurn(context.threadId, context.turnId));
    vi.mocked(f.host.deliverMailbox).mockImplementation(async () => {
      const turnId = f.host.id('reminder_turn');
      f.outcomes.set(turnId, { status: 'running' });
      return { turnId };
    });
    f.advance(3_600_000);
    await f.reminders.tick();
    const oldTurn = f.store.current.reminders[0]!.lastRun!.turnId!;
    await f.reminders.change(f.assistant.id, reminder.id, 'pause', {});
    const send = vi.fn<AssistantReplySender['send']>().mockResolvedValue(undefined);
    f.outbox.setSender(f.assistant.id, { send });
    f.outcomes.set(oldTurn, { status: 'completed', finalAnswer: '不要发送的旧消息' });
    f.emit(completed(context.threadId, oldTurn));
    await f.store.settled();
    await f.outbox.recover();
    expect(send).not.toHaveBeenCalled();
    f.advance(2 * 86_400_000);
    await f.reminders.change(f.assistant.id, reminder.id, 'resume', {});
    expect(f.store.current.reminders[0]?.nextRunAt).toBe('2026-10-04T01:00:00.000Z');
    f.advance(86_400_000);
    await f.reminders.tick();
    const latest = f.store.current.reminders[0]!.lastRun!.turnId!;
    const sidebar = new AssistantSidebarEntries(f.store);
    const target = { assistantId: f.assistant.id, kind: 'reminder' as const, entryId: reminder.id };
    await sidebar.update({ ...target, title: '新的提醒名', pinned: true });
    expect(JSON.parse(await readFile(f.file, 'utf8')).reminders[0]).toMatchObject({ title: '新的提醒名', pinned: true });
    await sidebar.delete(target);
    f.outcomes.set(latest, { status: 'completed', finalAnswer: '已经取消的提醒' });
    f.emit(completed(context.threadId, latest));
    await f.store.settled();
    await f.outbox.recover();
    await f.reminders.tick();
    expect(send).not.toHaveBeenCalled();
    expect(f.store.current.reminders).toEqual([]);
    expect(f.host.deleteThread).not.toHaveBeenCalled();
  });

  it('维护暂停阻止调度；关闭已进入的提交后，迟到结果不再登记或发送 QQ 消息', async () => {
    const f = await fixture();
    const context = await qqRoute(f);
    await f.reminders.create(f.assistant, daily, f.outbox.routeForTurn(context.threadId, context.turnId));
    f.advance(3_600_000);
    f.store.setMaintenancePaused(true);
    await f.reminders.tick();
    expect(f.host.deliverMailbox).not.toHaveBeenCalled();
    f.store.setMaintenancePaused(false);
    const entered = deferred<void>();
    const release = deferred<void>();
    vi.mocked(f.host.deliverMailbox).mockImplementation(async () => { entered.resolve(); await release.promise; return { turnId: 'late_turn' }; });
    const running = f.reminders.tick();
    try {
      await entered.promise;
      f.reminders.dispose();
    } finally { release.resolve(); await running; }
    await f.reminders.tick();
    expect(f.store.current.deliveries.filter((item) => item.reminderId)).toEqual([]);
    expect(f.host.deliverMailbox).toHaveBeenCalledTimes(1);
    expect(f.store.current.reminders[0]?.lastRun?.turnId).toBeUndefined();
  });

  it('繁忙时保留一次性提醒；修改待执行时间及排队中的到期检查不会提前触发旧计划', async () => {
    const f = await fixture();
    const once = (delay: number) => ({ kind: 'once' as const, at: new Date(f.host.now().getTime() + delay).toISOString() });
    const reminder = await f.reminders.create(f.assistant, { ...daily, schedule: once(1_000) });
    vi.mocked(f.host.deliverMailbox).mockResolvedValueOnce({ turnId: null }).mockImplementation(async () => {
      f.outcomes.set('one_shot', { status: 'completed', finalAnswer: '提醒内容' });
      return { turnId: 'one_shot' };
    });
    f.advance(1_000);
    await f.reminders.tick();
    expect(f.store.current.reminders[0]).toMatchObject({ status: 'active', lastRun: { scheduledFor: reminder.nextRunAt } });
    await f.reminders.change(f.assistant.id, reminder.id, 'update', { schedule: once(60_000) });
    await f.reminders.tick();
    expect(f.host.deliverMailbox).toHaveBeenCalledTimes(1);
    f.advance(60_000);
    const entered = deferred<void>();
    const release = deferred<void>();
    const barrier = f.store.mutate(async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const edit = f.reminders.change(f.assistant.id, reminder.id, 'update', { schedule: once(60_000) });
    const tick = f.reminders.tick();
    release.resolve();
    await Promise.all([barrier, edit, tick]);
    expect(f.host.deliverMailbox).toHaveBeenCalledTimes(1);
    f.advance(60_000);
    await f.reminders.tick();
    await f.reminders.tick();
    expect(f.host.deliverMailbox).toHaveBeenCalledTimes(2);
    expect(f.store.current.reminders[0]).toMatchObject({ status: 'completed', nextRunAt: null, lastRun: { turnId: 'one_shot' } });
  });
});
