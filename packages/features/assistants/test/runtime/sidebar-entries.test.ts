import { describe, expect, it } from 'vitest';
import type { AssistantSidebarTarget } from '../../src/contracts/index.js';
import { AssistantSidebarEntries } from '../../src/runtime/sidebar-entries.js';
import { AssistantsStateStore } from '../../src/runtime/state-store.js';
import { completed, fixture } from './fixture.js';

const request = { projectId: 'project', title: '项目任务', instructions: '处理项目中的工作' };

describe('助理任务侧栏记录', () => {
  it('重命名和置顶持久化，且不改变共享项目对话标题', async () => {
    const f = await fixture();
    const sidebar = new AssistantSidebarEntries(f.store);
    const task = await f.tasks.dispatch(f.assistant, { threadId: f.conversation.threadId }, request);
    const target: AssistantSidebarTarget = { assistantId: f.assistant.id, kind: 'task', entryId: task.id };
    await sidebar.update({ ...target, title: '新的任务名', pinned: true });
    expect(f.threads.get(task.workThreadId)?.title).toBe(request.title);
    const restored = new AssistantsStateStore(f.host.dataDir);
    await restored.load();
    try { expect(restored.current.tasks[0]).toMatchObject({ title: '新的任务名', pinned: true }); }
    finally { await restored.dispose(); }
    await sidebar.update({ ...target, pinned: false });
    const unpinned = new AssistantsStateStore(f.host.dataDir);
    await unpinned.load();
    try { expect(unpinned.current.tasks[0]?.pinned).toBeUndefined(); }
    finally { await unpinned.dispose(); }
  });

  it('删除已结束任务保留共享项目对话和正在执行的任务，拒绝删除进行中的记录及跨助理修改', async () => {
    const f = await fixture();
    const sidebar = new AssistantSidebarEntries(f.store);
    const origin = { threadId: f.conversation.threadId };
    const first = await f.tasks.dispatch(f.assistant, origin, request);
    f.outcomes.set(first.turnId!, { status: 'completed' });
    f.emit(completed(first.workThreadId, first.turnId!));
    await f.store.settled();
    const second = await f.tasks.dispatch(f.assistant, origin, { ...request, threadId: first.workThreadId });
    const target: AssistantSidebarTarget = { assistantId: f.assistant.id, kind: 'task', entryId: first.id };
    const other = await f.directory.create({ name: '另一个助理', personality: '', projectIds: [] });
    await expect(sidebar.update({ ...target, assistantId: other.id, title: '不应修改' })).rejects.toMatchObject({ code: 'ASSISTANT_NOT_FOUND' });
    await expect(sidebar.delete({ ...target, assistantId: other.id })).rejects.toMatchObject({ code: 'ASSISTANT_NOT_FOUND' });
    await sidebar.delete(target);
    await sidebar.delete(target);
    expect(f.store.current.tasks).toEqual([expect.objectContaining({ id: second.id, workThreadId: first.workThreadId, status: 'running' })]);
    expect(f.threads.has(first.workThreadId)).toBe(true);
    expect(f.host.deleteThread).not.toHaveBeenCalled();
    await expect(sidebar.delete({ ...target, entryId: second.id })).rejects.toMatchObject({ code: 'ASSISTANT_BUSY' });
    expect(f.store.current.tasks[0]?.id).toBe(second.id);
  });
});
