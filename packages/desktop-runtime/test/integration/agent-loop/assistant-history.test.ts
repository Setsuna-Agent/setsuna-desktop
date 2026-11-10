import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRequest, ModelStreamEvent, RuntimeMessage } from '@setsuna-desktop/contracts';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { mergeAssistantConversationHistory } from '../../../src/composition/assistants-history.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { RuntimeEventWriter } from '../../../src/loop/lifecycle/runtime-event-writer.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { closeTestThreadStores, createTestThreadStore } from '../../support/thread-store.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); vi.restoreAllMocks(); });

describe('助理历史归并', () => {
  it('保留现有上下文、原始历史和压缩记忆，重复导入不会复制消息，模型可以继续使用两端记录', async () => {
    const f = await fixture();
    expect(await f.merge()).toBe(true);
    expect(await f.merge()).toBe(true);
    const shared = (await f.threadStore.getThread(f.destination.id))!;
    expect(shared.messages.map((item) => item.id)).toEqual(['desktop', 'archived-question', 'old-memory', 'qq-reply']);
    expect(shared.messages.find((item) => item.id === 'desktop')?.visibility).toBeUndefined();
    expect(shared.messages.find((item) => item.id === 'archived-question')?.visibility).toBe('transcript');
    expect(shared.messages.find((item) => item.id === 'old-memory')?.visibility).toBe('model');
    expect((await f.threadStore.getThread(f.source.id))?.archived).toBe(true);
    expect((await f.threadStore.getThread(f.source.id))?.messages).toEqual(f.originals);
    await f.loop.sendTurn(f.destination.id, { input: '接着之前聊' });
    const content = f.requests[0]!.messages.map((item) => item.content).join('\n');
    expect(content).toContain('桌面已经确定周五出发');
    expect(content).toContain('QQ 记住了用户喜欢靠窗座位');
  });

  it('有运行中的交流时不迁移、不取消；结束后才归并', async () => {
    const f = await fixture(true);
    const running = f.loop.sendTurn(f.destination.id, { input: '当前交流' });
    await f.modelEntered.promise;
    try {
      expect(await f.merge()).toBe(false);
      expect(f.loop.activeTurnId(f.destination.id)).toBeTruthy();
      expect((await f.threadStore.getThread(f.source.id))?.archived).toBe(false);
      expect((await f.threadStore.getThread(f.destination.id))?.messages.some((item) => item.id === 'old-memory')).toBe(false);
    } finally { f.releaseModel.resolve(); await running; }
    expect(await f.merge()).toBe(true);
    expect((await f.threadStore.getThread(f.destination.id))?.messages.some((item) => item.id === 'old-memory')).toBe(true);
  });

  it('导入期间拒绝插入新轮次或删除，部分写入失败保留原记录，重试只补剩余消息并释放锁', async () => {
    const f = await fixture();
    const entered = deferred();
    const release = deferred();
    f.host.attachmentStore.retainForThread.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    const append = f.threadStore.appendEvent.bind(f.threadStore);
    const writer = vi.spyOn(f.threadStore, 'appendEvent').mockImplementationOnce(append).mockRejectedValueOnce(new Error('模拟中途失败'));
    const importing = f.merge();
    const failed = expect(importing).rejects.toThrow('模拟中途失败');
    await entered.promise;
    try {
      await expect(f.loop.startTurn(f.destination.id, { input: '不能穿过导入锁' })).rejects.toThrow('busy');
      await expect(f.loop.startTurn(f.source.id, { input: '不能继续旧记录' })).rejects.toThrow('busy');
      await expect(f.loop.withThreadDeletionBarrier(f.source.id, async () => undefined, { onlyIfIdle: true })).rejects.toThrow('busy');
      expect(f.loop.prepareDataMigration()).toMatchObject({ ready: false, pendingMutations: 1 });
    } finally { release.resolve(); await failed; writer.mockRestore(); }
    expect((await f.threadStore.getThread(f.source.id))?.archived).toBe(false);
    expect((await f.threadStore.getThread(f.destination.id))?.messages.map((item) => item.id)).toEqual(['desktop', 'archived-question']);
    expect(await f.merge()).toBe(true);
    expect((await f.threadStore.getThread(f.destination.id))?.messages.map((item) => item.id)).toEqual(['desktop', 'archived-question', 'old-memory', 'qq-reply']);
    await f.loop.sendTurn(f.destination.id, { input: '继续聊' });
    expect(f.requests).toHaveLength(1);
  });
});

async function fixture(blockModel = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'setsuna-assistant-history-'));
  const ids = new RandomIdGenerator();
  const threadStore = createTestThreadStore(root, systemClock, ids);
  const eventBus = new InMemoryEventBus();
  const eventWriter = new RuntimeEventWriter(threadStore, eventBus);
  const requests: ModelRequest[] = [];
  const modelEntered = deferred();
  const releaseModel = deferred();
  const modelClient: ModelClient = { async *stream(request): AsyncGenerator<ModelStreamEvent> {
    requests.push(request);
    if (blockModel) { modelEntered.resolve(); await releaseModel.promise; }
    yield { type: 'text_delta', text: '知道了，接着聊' };
    yield { type: 'done', finishReason: 'stop' };
  } };
  const loop = new AgentLoop({ threadStore, eventBus, eventWriter, ids, clock: systemClock, modelClient });
  cleanup.push(async () => { releaseModel.resolve(); await loop.shutdown(); await closeTestThreadStores(); await rm(root, { recursive: true, force: true }); });
  const source = await threadStore.createThread({ title: '旧 QQ 聊天', featureId: 'assistants', memoryMode: 'disabled' });
  const destination = await threadStore.createThread({ title: '助理共享聊天', featureId: 'assistants', memoryMode: 'disabled' });
  const at = new Date().toISOString();
  const originals: RuntimeMessage[] = [
    { id: 'archived-question', role: 'user', content: 'QQ 中早期的一条提问', visibility: 'transcript', createdAt: at },
    { id: 'old-memory', role: 'user', content: 'QQ 记住了用户喜欢靠窗座位', visibility: 'model', createdAt: at,
      contextCompaction: { compactedMessageCount: 1, compactedTokens: 100, keptRecentMessageCount: 1, maxContextTokensK: 32, originalMessageCount: 2, originalTokens: 140 } },
    { id: 'qq-reply', role: 'assistant', content: '之前 QQ 的回答', createdAt: at },
  ];
  for (const message of originals) await threadStore.appendEvent(source.id, { id: ids.id('event'), threadId: source.id, type: 'message.created', payload: { message }, createdAt: at });
  await threadStore.appendEvent(destination.id, { id: ids.id('event'), threadId: destination.id, type: 'message.created',
    payload: { message: { id: 'desktop', role: 'user', content: '桌面已经确定周五出发', createdAt: at } }, createdAt: at });
  const host = {
    agentLoop: loop, threadStore, eventBus, eventWriter,
    attachmentStore: { retainForThread: vi.fn(async () => undefined) },
    generatedImageStore: { create: vi.fn(), clone: vi.fn(), delete: vi.fn(), recover: vi.fn() },
    toolResultStore: { save: vi.fn(), read: vi.fn(), retainForThread: vi.fn(), releaseThread: vi.fn(), recover: vi.fn() },
  };
  return { host, loop, threadStore, source, destination, originals, requests, modelEntered, releaseModel,
    merge: () => mergeAssistantConversationHistory(host, source.id, destination.id) };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
