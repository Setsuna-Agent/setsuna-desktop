import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { AssistantDirectory } from '../../src/runtime/directory.js';
import { AssistantsStateStore } from '../../src/runtime/state-store.js';
import { fixture } from './fixture.js';

describe('助理固定聊天记录', () => {
  it('重复打开及重启后仍返回同一条本地记录，不拆分用户上下文', async () => {
    const f = await fixture();
    const opened = await Promise.all([
      f.directory.openConversation(f.assistant.id),
      f.directory.openConversation(f.assistant.id),
    ]);
    expect(opened).toEqual([f.conversation, f.conversation]);

    const restored = new AssistantsStateStore(f.host.dataDir);
    await restored.load();
    try {
      const directory = new AssistantDirectory(f.host, restored, { connectorStatuses: () => [], assistantChanged: () => undefined });
      expect(await directory.openConversation(f.assistant.id)).toEqual(f.conversation);
      const snapshot = await directory.snapshot();
      expect(snapshot.conversations.map((item) => item.threadId)).toEqual([f.conversation.threadId]);
      expect(f.host.createConversation).toHaveBeenCalledTimes(1);
    } finally { await restored.dispose(); }
  });
});

it('旧桌面与 QQ 记录只保留一个入口，繁忙时推迟导入；重试和重启不会重新拆分上下文', async () => {
  const f = await fixture();
  const legacyIds: string[] = [];
  await f.store.mutate(async ({ state }) => {
    state.conversations[0]!.source = 'local';
    for (const source of ['local', 'qq-c2c', 'qq-group'] as const) {
      const threadId = await f.host.createConversation({ title: 'Setsuna' });
      legacyIds.push(threadId);
      state.conversations.push({ assistantId: f.assistant.id, threadId, source, createdAt: f.host.now().toISOString() });
    }
  });
  const task = await f.tasks.dispatch(f.assistant, { threadId: legacyIds[1]! }, { projectId: 'project', title: '先前的任务', instructions: '继续项目工作' });
  const merge = vi.mocked(f.host.mergeConversationHistory).mockResolvedValueOnce(false);
  await f.directory.reconcileConversations();
  expect(f.directory.hasPendingConversationHistory()).toBe(true);
  expect((await f.directory.snapshot()).conversations).toEqual([expect.objectContaining({ threadId: f.conversation.threadId, source: 'shared' })]);
  expect(f.tasks.tasks(f.assistant.id).find((item) => item.id === task.id)?.origin.threadId).toBe(f.conversation.threadId);
  expect(f.threads.has(legacyIds[0]!)).toBe(true);
  await f.directory.reconcileConversations();
  const imports = merge.mock.calls.length;
  await f.directory.reconcileConversations();
  expect(merge).toHaveBeenCalledTimes(imports);
  expect(f.directory.hasPendingConversationHistory()).toBe(false);
  expect(legacyIds.every((id) => f.threads.get(id)?.archived)).toBe(true);
  const restored = new AssistantsStateStore(f.host.dataDir);
  await restored.load();
  try {
    const directory = new AssistantDirectory(f.host, restored, { connectorStatuses: () => [], assistantChanged() {} });
    expect(await directory.openConversation(f.assistant.id)).toEqual(f.conversation);
    expect((await directory.snapshot()).conversations).toHaveLength(1);
    expect(restored.current.conversations.filter((item) => item.mergedInto === f.conversation.threadId)).toHaveLength(3);
    expect(f.host.createConversation).toHaveBeenCalledTimes(4);
  } finally { await restored.dispose(); }
});

it('按助理身份读取独立密钥，清除后立即失效，明文不进入快照或持久状态', async () => {
  const f = await fixture();
  const other = await f.directory.create({ name: '另一个助理', personality: '', projectIds: [] });
  await f.directory.setQqSecret(f.assistant.id, 'first-private-secret');
  await f.directory.setQqSecret(other.id, 'second-private-secret');
  expect(await f.directory.revealQqSecret(f.assistant.id)).toEqual({ secret: 'first-private-secret' });
  expect(await f.directory.revealQqSecret(other.id)).toEqual({ secret: 'second-private-secret' });
  const snapshot = JSON.stringify(await f.directory.snapshot());
  const persisted = await readFile(f.file, 'utf8');
  for (const secret of ['first-private-secret', 'second-private-secret']) {
    expect(snapshot).not.toContain(secret);
    expect(persisted).not.toContain(secret);
  }
  await f.directory.setQqSecret(f.assistant.id, null);
  expect(await f.directory.revealQqSecret(f.assistant.id)).toEqual({ secret: null });
  expect(await f.directory.revealQqSecret(other.id)).toEqual({ secret: 'second-private-secret' });
  const readSecret = vi.spyOn(f.host.secrets, 'get');
  await expect(f.directory.revealQqSecret('missing')).rejects.toMatchObject({ code: 'ASSISTANT_NOT_FOUND' });
  expect(readSecret).not.toHaveBeenCalled();
});
