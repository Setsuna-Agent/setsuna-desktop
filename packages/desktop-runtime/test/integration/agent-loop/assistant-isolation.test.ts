import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRequest, ModelStreamEvent, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { AssistantToolHost } from '../../../src/adapters/tool/assistant-tool-host.js';
import { CompositeToolHost } from '../../../src/adapters/tool/composite-tool-host.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { createTestThreadStore, closeTestThreadStores } from '../../support/thread-store.js';
import { CapturingToolHost, SingleToolCallModelClient } from '../../support/agent-loop/shared.js';

const directories: string[] = [];
afterEach(async () => { await closeTestThreadStores(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function storeFixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'assistant-isolation-'));
  directories.push(dataDir);
  const ids = new RandomIdGenerator();
  const threadStore = createTestThreadStore(dataDir, systemClock, ids);
  const thread = await threadStore.createThread({ title: '助理会话', featureId: 'assistants', memoryMode: 'disabled' });
  return { ids, threadStore, thread };
}

class AssistantScopeHost extends CapturingToolHost {
  exclusiveToolScope() { return new Set(['assistant_list_projects']); }
  override async listTools(): Promise<RuntimeToolDefinition[]> {
    return ['assistant_list_projects', 'run_shell_command'].map((name) => ({ name, description: name, inputSchema: { type: 'object' } }));
  }
}

describe('助理 Core 安全边界', () => {
  it('助理 Feature 尚未加载或已被卸载时，持久会话仍不能获得普通桌面工具', async () => {
    const f = await storeFixture();
    const desktop = new CapturingToolHost();
    const model = new SingleToolCallModelClient({ id: 'unavailable_feature_call', name: 'workspace_read_file', arguments: '{"path":"secret.txt"}' });
    const loop = new AgentLoop({ threadStore: f.threadStore, ids: f.ids, clock: systemClock, eventBus: new InMemoryEventBus(), modelClient: model,
      toolHost: new CompositeToolHost([new AssistantToolHost(), desktop]) });
    await loop.sendTurn(f.thread.id, { input: '读取项目' });
    expect(model.requests[0]?.tools?.some((tool) => tool.name === 'workspace_read_file')).toBe(false);
    expect(desktop.calls).toEqual([]);
  });

  it.each(['run_shell_command', 'create_goal', 'spawn_agent', 'tickets__lookup_ticket'])('即使模型伪造 %s 调用，也不执行独占目录外的工具', async (name) => {
    const f = await storeFixture();
    const host = new AssistantScopeHost();
    const model = new SingleToolCallModelClient({ id: 'forged_call', name, arguments: '{}' });
    const notification = vi.fn();
    const loop = new AgentLoop({ threadStore: f.threadStore, ids: f.ids, clock: systemClock, eventBus: new InMemoryEventBus(), modelClient: model, toolHost: host,
      appServerNotificationBus: { publish: notification, subscribe: () => () => undefined } });
    loop.registerAppServerDynamicTools(f.thread.id, [{ name: 'tickets__lookup_ticket', namespace: 'tickets', toolName: 'lookup_ticket', description: 'lookup', inputSchema: { type: 'object' } }], 'connection');
    await loop.sendTurn(f.thread.id, { input: '查询授权项目' });
    const advertised = model.requests[0]?.tools?.map((tool) => tool.name);
    expect(advertised).toContain('assistant_list_projects');
    expect(advertised).not.toContain(name);
    expect(host.calls).toEqual([]);
    expect(notification.mock.calls.filter(([item]) => item.method === 'item/tool/call')).toEqual([]);
    const events = await f.threadStore.listEvents(f.thread.id);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool.completed', payload: expect.objectContaining({ toolName: name, status: 'error' }) }));
  });

  it('报告等待当前交流结束，单独启动一轮，并用持久回执避免重复唤醒', async () => {
    const f = await storeFixture();
    let notifyEntered!: () => void;
    let releaseModel!: () => void;
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve; });
    const release = new Promise<void>((resolve) => { releaseModel = resolve; });
    const requests: ModelRequest[] = [];
    const model: ModelClient = { async *stream(request): AsyncGenerator<ModelStreamEvent> {
      requests.push(request);
      if (requests.length === 1) { notifyEntered(); await release; }
      yield { type: 'text_delta', text: '收到' };
      yield { type: 'done', finishReason: 'stop' };
    } };
    const loop = new AgentLoop({ threadStore: f.threadStore, ids: f.ids, clock: systemClock, eventBus: new InMemoryEventBus(), modelClient: model, toolHost: new AssistantScopeHost() });
    const running = loop.sendTurn(f.thread.id, { input: '另一条交流' });
    await entered;
    const report = { id: 'durable_report', content: '任务已经完成', triggerTurn: true, deliveryMode: 'trigger_turn' as const };
    try {
      expect(await loop.deliverIdleMailboxInput(f.thread.id, report)).toBeNull();
      expect((await f.threadStore.listEvents(f.thread.id)).some((event) => event.type === 'mailbox.delivered')).toBe(false);
    } finally { releaseModel(); await running; }
    const delivered = await loop.deliverIdleMailboxInput(f.thread.id, report);
    expect(delivered?.turnId).toBeTruthy();
    const replay = await loop.deliverIdleMailboxInput(f.thread.id, report);
    expect(replay?.turnId).toBe(delivered?.turnId);
    await vi.waitFor(() => expect(loop.activeTurnId(f.thread.id)).toBeNull());
    expect(requests).toHaveLength(2);
    expect((await f.threadStore.listEvents(f.thread.id)).filter((event) => event.type === 'mailbox.delivered')).toHaveLength(1);
  });

  it('空闲检查后用户轮次先启动时不留下成功回执，报告重试只执行一次', async () => {
    const f = await storeFixture();
    let releaseRead!: () => void;
    const continueRead = new Promise<void>((resolve) => { releaseRead = resolve; });
    const getThread = f.threadStore.getThread.bind(f.threadStore);
    const listEvents = f.threadStore.listEvents.bind(f.threadStore);
    let idleCheckReached = false;
    const events = vi.spyOn(f.threadStore, 'listEvents').mockImplementation(async (...args) => {
      const result = await listEvents(...args);
      idleCheckReached = true;
      return result;
    });
    let heldRead = false;
    const read = vi.spyOn(f.threadStore, 'getThread').mockImplementation(async (id) => {
      if (id === f.thread.id && idleCheckReached && !heldRead) { heldRead = true; await continueRead; }
      return getThread(id);
    });
    let releaseModel!: () => void;
    const continueModel = new Promise<void>((resolve) => { releaseModel = resolve; });
    const requests: ModelRequest[] = [];
    const model: ModelClient = { async *stream(request): AsyncGenerator<ModelStreamEvent> {
      requests.push(request);
      if (requests.length === 1) await continueModel;
      yield { type: 'text_delta', text: '收到' };
      yield { type: 'done', finishReason: 'stop' };
    } };
    const loop = new AgentLoop({ threadStore: f.threadStore, ids: f.ids, clock: systemClock, eventBus: new InMemoryEventBus(), modelClient: model, toolHost: new AssistantScopeHost() });
    const report = { id: 'racing_report', content: '任务已经完成', triggerTurn: true, deliveryMode: 'trigger_turn' as const };
    const delivery = loop.deliverIdleMailboxInput(f.thread.id, report);
    const outcome = delivery.then(() => null, (error: unknown) => error);
    let running: Promise<void> | undefined;
    try {
      await vi.waitFor(() => expect(heldRead).toBe(true));
      running = loop.sendTurn(f.thread.id, { input: '刚发送的另一条交流' });
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      releaseRead();
      expect(await outcome).toBeInstanceOf(Error);
      expect((await f.threadStore.listEvents(f.thread.id)).some((event) => event.type === 'mailbox.delivered')).toBe(false);
    } finally {
      releaseRead(); releaseModel();
      await running;
      read.mockRestore();
      events.mockRestore();
    }
    const delivered = await loop.deliverIdleMailboxInput(f.thread.id, report);
    expect(delivered?.turnId).toBeTruthy();
    expect((await loop.deliverIdleMailboxInput(f.thread.id, report))?.turnId).toBe(delivered?.turnId);
    await vi.waitFor(() => expect(loop.activeTurnId(f.thread.id)).toBeNull());
    expect(requests).toHaveLength(2);
    expect((await f.threadStore.listEvents(f.thread.id)).filter((event) => event.type === 'mailbox.delivered')).toHaveLength(1);
  });
});
