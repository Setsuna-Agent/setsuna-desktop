import { describe, expect, it, vi } from 'vitest';
import { AssistantsRuntime } from '../../src/runtime/service.js';
import { fixture } from './fixture.js';
import { deferred } from '../support/deferred.js';

describe('助理后台生命周期', () => {
  it('恢复被阻塞时仍已提供助理身份与工具；关闭后迟到恢复不会重连 QQ', async () => {
    const f = await fixture();
    await f.directory.update(f.assistant.id, { ...f.assistant, qq: { appId: '123', enabled: true } });
    await f.directory.setQqSecret(f.assistant.id, 'test-secret');
    const entered = deferred<void>();
    const release = deferred<void>();
    await f.store.mutate(async ({ state }) => {
      const threadId = await f.host.createConversation({ title: '旧 QQ 记录' });
      state.conversations.push({ assistantId: f.assistant.id, threadId, source: 'qq-c2c', createdAt: f.host.now().toISOString() });
    });
    f.host.mergeConversationHistory = async () => { entered.resolve(); await release.promise; return true; };
    const connect = vi.spyOn(f.host, 'openWebSocket');
    const runtime = new AssistantsRuntime(f.host, f.errors);
    await runtime.initialize();
    runtime.start();
    try {
      await entered.promise;
      expect(runtime.isAssistantThread(f.conversation.threadId)).toBe(true);
      expect(runtime.listTools().length).toBeGreaterThan(0);
    } finally {
      const closing = runtime.dispose();
      release.resolve();
      await closing;
    }
    expect(connect).not.toHaveBeenCalled();
    expect(f.host.fetch).not.toHaveBeenCalled();
  });

  it('旧记录导入失败只影响后台归并，助理身份与工具仍然可用', async () => {
    const f = await fixture();
    await f.store.mutate(async ({ state }) => {
      const threadId = await f.host.createConversation({ title: '旧私聊' });
      state.conversations.push({ assistantId: f.assistant.id, threadId, source: 'qq-c2c', createdAt: f.host.now().toISOString() });
    });
    vi.mocked(f.host.mergeConversationHistory).mockRejectedValue(new Error('历史暂不可读'));
    const runtime = new AssistantsRuntime(f.host, f.errors);
    await runtime.initialize();
    runtime.start();
    try {
      await vi.waitFor(() => expect(f.errors).toHaveBeenCalledWith(expect.objectContaining({ message: '历史暂不可读' })));
      expect(runtime.isAssistantThread(f.conversation.threadId)).toBe(true);
      expect(runtime.systemPrompt(f.conversation.threadId)).toBeTruthy();
    } finally { await runtime.dispose(); }
  });
});
