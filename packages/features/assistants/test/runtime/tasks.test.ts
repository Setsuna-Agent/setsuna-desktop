import { readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AssistantsStateStore } from '../../src/runtime/state-store.js';
import { AssistantTaskCoordinator } from '../../src/runtime/tasks.js';
import { completed, fixture } from './fixture.js';
import { deferred } from '../support/deferred.js';

const request = { projectId: 'project', title: '实现需求', instructions: '修改项目中的实现并验证' };

describe('持久项目任务', () => {
  it('执行前保存关联与提交标识，同目录串行，worktree 可独立执行', async () => {
    const f = await fixture();
    const configured = await f.directory.update(f.assistant.id, { ...f.assistant,
      modelSelection: { providerId: 'provider', modelId: 'model' }, thinkingEffort: 'high',
    });
    const start = vi.mocked(f.host.startTurn);
    start.mockImplementation(async (threadId, input) => {
      const disk = JSON.parse(await readFile(f.file, 'utf8'));
      expect(disk.tasks).toContainEqual(expect.objectContaining({ workThreadId: threadId, clientId: input.clientId, status: 'queued' }));
      const turnId = f.host.id('turn');
      f.outcomes.set(turnId, { status: 'running' });
      return { turnId };
    });
    const origin = { threadId: f.conversation.threadId };
    const first = await f.tasks.dispatch(configured, origin, request);
    const waiting = await f.tasks.dispatch(configured, origin, request);
    const parallel = await f.tasks.dispatch(configured, origin, { ...request, parallel: true });
    expect([first.status, waiting.status, parallel.status]).toEqual(['running', 'pending', 'running']);
    expect(start).toHaveBeenCalledTimes(2);
    await f.directory.update(configured.id, { ...configured, thinkingEffort: undefined });
    f.outcomes.set(first.turnId!, { status: 'completed', finalAnswer: '已完成并通过验证' });
    f.emit(completed(first.workThreadId, first.turnId!));
    await f.store.settled();
    expect(f.tasks.tasks(f.assistant.id).find((task) => task.id === waiting.id)?.status).toBe('running');
    expect(start).toHaveBeenCalledTimes(3);
    for (const [, input] of start.mock.calls) expect(input).toMatchObject({
      modelSelection: configured.modelSelection, thinkingEffort: 'high',
    });
    expect(f.errors).not.toHaveBeenCalled();
  });

  it('恢复提交后、回执前的崩溃窗口，按 clientId 找回执行而不重新运行', async () => {
    const f = await fixture();
    const configured = await f.directory.update(f.assistant.id, { ...f.assistant,
      modelSelection: { providerId: 'provider', modelId: 'model' }, thinkingEffort: 'high',
    });
    let crashSnapshot = '';
    vi.mocked(f.host.startTurn).mockImplementation(async () => {
      crashSnapshot = await readFile(f.file, 'utf8');
      return { turnId: 'accepted_turn' };
    });
    const task = await f.tasks.dispatch(configured, { threadId: f.conversation.threadId }, request);
    f.tasks.dispose();
    await f.store.settled();
    await writeFile(f.file, crashSnapshot);
    const restored = new AssistantsStateStore(f.host.dataDir);
    await restored.load();
    vi.mocked(f.host.locateInput).mockResolvedValue({ state: 'started', turnId: 'accepted_turn' });
    f.outcomes.set('accepted_turn', { status: 'completed', finalAnswer: '崩溃前已经执行完毕' });
    const recovered = new AssistantTaskCoordinator(f.host, restored, f.access, f.outbox, f.errors);
    try {
      await recovered.recover();
      expect(recovered.tasks(f.assistant.id)).toContainEqual(expect.objectContaining({ id: task.id, status: 'completed', result: '崩溃前已经执行完毕' }));
      expect(f.host.startTurn).toHaveBeenCalledTimes(1);
      expect(recovered.tasks(f.assistant.id)[0]?.execution).toEqual({ modelSelection: configured.modelSelection, thinkingEffort: 'high' });
      expect(JSON.parse(await readFile(f.file, 'utf8')).tasks[0].status).toBe('completed');
    } finally { recovered.dispose(); await restored.dispose(); }
  });

  it('提交失败返回失败状态，且授权撤销会阻断后续控制、读取和结果汇报', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = await fixture();
    vi.mocked(f.host.startTurn).mockRejectedValueOnce(new Error('执行提交失败'));
    const failed = await f.tasks.dispatch(f.assistant, { threadId: f.conversation.threadId }, request);
    expect(failed).toMatchObject({ status: 'failed', error: '执行提交失败' });
    const task = await f.tasks.dispatch(f.assistant, { threadId: f.conversation.threadId }, request);
    await f.directory.update(f.assistant.id, { ...f.assistant, projectIds: [] });
    await expect(f.tasks.followup(f.assistant, task.id, '继续')).rejects.toThrow('authorized');
    await expect(f.tasks.cancel(f.assistant, task.id)).rejects.toThrow('authorized');
    await expect(f.tasks.answer(f.assistant, task.id, 'request', { decision: 'approve' })).rejects.toThrow('authorized');
    await expect(f.tools.run('assistant_list_tasks', { task_id: task.id }, { threadId: f.conversation.threadId })).rejects.toThrow('current assistant');
    expect(f.host.readThreadMessages).not.toHaveBeenCalled();
    expect(f.host.steerTurn).not.toHaveBeenCalled();
    f.outcomes.set(task.turnId!, { status: 'completed', finalAnswer: '不应再回传的内容' });
    f.emit(completed(task.workThreadId, task.turnId!));
    await f.store.settled();
    await vi.advanceTimersByTimeAsync(1500);
    await f.store.settled();
    expect(f.host.deliverMailbox).not.toHaveBeenCalled();
  });

  it('不同入口能操作同一助理任务，另一个助理不能查询或控制它', async () => {
    const f = await fixture();
    const task = await f.tasks.dispatch(f.assistant, { threadId: f.conversation.threadId }, request);
    const threadId = await f.store.mutate(async ({ state }) => {
      const now = f.host.now().toISOString();
      const peer = { assistantId: f.assistant.id, kind: 'c2c' as const, openid: 'other_user', status: 'allowed' as const, firstSeenAt: now, lastSeenAt: now };
      state.peers.push(peer);
      return f.directory.ensureConversation(state, f.assistant);
    });
    expect(threadId).toBe(f.conversation.threadId);
    const shared = await f.tools.run('assistant_list_tasks', { task_id: task.id }, { threadId });
    expect(JSON.parse(shared.content).task).toMatchObject({ task_id: task.id });
    const other = await f.directory.create({ name: '另一位助理', personality: '', projectIds: ['project'] });
    const otherConversation = await f.directory.openConversation(other.id);
    const context = { threadId: otherConversation.threadId };
    const listed = await f.tools.run('assistant_list_tasks', {}, context);
    expect(JSON.parse(listed.content)).toMatchObject({ active: [], recent: [] });
    for (const name of ['assistant_list_tasks', 'assistant_cancel_task', 'assistant_followup_task', 'assistant_answer_request']) {
      await expect(f.tools.run(name, { task_id: task.id, message: '取消', request_id: 'approval', decision: 'approve' }, context)).rejects.toThrow('current assistant');
    }
    expect(f.host.readThreadMessages).toHaveBeenCalledTimes(1);
    expect(f.host.cancelTurn).not.toHaveBeenCalled();
    expect(f.host.answerApproval).not.toHaveBeenCalled();
  });

  it('完成报告延迟合并、忙时保留债务，重试同一回执且只回到发起会话', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = await fixture();
    const configured = await f.directory.update(f.assistant.id, { ...f.assistant,
      modelSelection: { providerId: 'provider', modelId: 'model' }, thinkingEffort: 'high',
    });
    const task = await f.tasks.dispatch(configured, { threadId: f.conversation.threadId }, request);
    const delivered = deferred<void>();
    vi.mocked(f.host.deliverMailbox).mockResolvedValueOnce({ turnId: null }).mockImplementationOnce(async () => {
      delivered.resolve();
      return { turnId: 'report_turn' };
    });
    f.outcomes.set(task.turnId!, { status: 'completed', finalAnswer: '结果报告' });
    f.emit(completed(task.workThreadId, task.turnId!));
    await f.store.settled();
    await vi.advanceTimersByTimeAsync(1500);
    await f.store.settled();
    expect(f.tasks.tasks(f.assistant.id)[0]?.reported?.status).toBe('running');
    await vi.advanceTimersByTimeAsync(30000);
    await delivered.promise;
    await f.store.settled();
    expect(f.tasks.tasks(f.assistant.id)[0]?.reported?.status).toBe('completed');
    const calls = vi.mocked(f.host.deliverMailbox).mock.calls;
    expect(calls[0]?.[0]).toBe(f.conversation.threadId);
    expect(calls[0]?.[1].id).toBe(calls[1]?.[1].id);
    expect(calls.map(([, input]) => input.thinkingEffort)).toEqual(['high', 'high']);
    expect(f.host.startTurn).toHaveBeenCalledTimes(1);
  });
});
