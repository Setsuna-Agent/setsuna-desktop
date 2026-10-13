import { expect, it } from 'vitest';
import { threadMentionText, type ModelRequest, type RuntimeMessage } from '@setsuna-desktop/contracts';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { MemoryCapturingModelClient, mkDataDir, TestConfigStore } from '../../support/agent-loop/shared.js';
import { createRuntimeFactory } from '../../../src/runtime/runtime-factory.js';
import type { ModelClient } from '../../../src/ports/model-client.js';

it('resolves a persisted conversation reference in the real sampling pipeline and handles deletion on a follow-up turn', async () => {
  const ids = new RandomIdGenerator();
  const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
  const source = await threadStore.createThread({ title: 'Source conversation' });
  const target = await threadStore.createThread({ title: 'Target conversation' });
  await threadStore.appendEvent(source.id, {
    id: ids.id('event'), threadId: source.id, type: 'message.created', createdAt: systemClock.now().toISOString(),
    payload: { message: { id: ids.id('message'), role: 'user', content: 'Use the nightly dataset for the comparison.', createdAt: systemClock.now().toISOString() } },
  });
  const modelClient = new MemoryCapturingModelClient();
  const loop = new AgentLoop({ threadStore, modelClient, eventBus: new InMemoryEventBus(), clock: systemClock, ids });
  const input = `Summarize ${threadMentionText(source)}`;
  await loop.sendTurn(target.id, { input });
  const context = modelClient.requests[0].messages.find((message) => message.id === 'desktop_thread_references');
  expect(context).toMatchObject({ role: 'user', visibility: 'model' });
  expect(context?.content).toContain('Use the nightly dataset for the comparison.');
  const saved = await threadStore.getThread(target.id);
  expect(saved?.messages.find((message) => message.role === 'user')?.content).toBe(input);
  expect(saved?.messages.some((message) => message.id === 'desktop_thread_references')).toBe(false);

  await threadStore.deleteThread(source.id);
  await loop.sendTurn(target.id, { input: 'What else did that conversation say?' });
  const next = modelClient.requests.at(-1)!.messages.find((message) => message.id === 'desktop_thread_references');
  expect(next?.content).toContain('"unavailable":true');
  expect(next?.content).not.toContain('nightly dataset');
});

it('reads persisted history through the built-in host without plugins or HTTP and records native tool events', async () => {
  const runtime = createRuntimeFactory({ dataDir: await mkDataDir() });
  const ids = new RandomIdGenerator();
  try {
    const source = await runtime.threadStore.createThread({ title: 'Source conversation' });
    const target = await runtime.threadStore.createThread({ title: 'Read another conversation' });
    for (const message of [
      { role: 'user', content: 'Earlier requirement' },
      { role: 'user', content: 'INTERNAL_SECRET', visibility: 'model' },
      { role: 'assistant', content: 'Latest answer' },
    ] satisfies Partial<RuntimeMessage>[]) {
      await runtime.threadStore.appendEvent(source.id, {
        id: ids.id('event'), threadId: source.id, type: 'message.created', createdAt: systemClock.now().toISOString(),
        payload: { message: { id: ids.id('message'), createdAt: systemClock.now().toISOString(), ...message } },
      });
    }
    const requests: ModelRequest[] = [];
    const modelClient: ModelClient = { stream: async function* (request) {
      requests.push(request);
      if (requests.length <= 2) {
        const previous = request.messages.filter((message) => message.role === 'tool').at(-1);
        const before = previous ? JSON.parse(previous.content).next_before : undefined;
        yield { type: 'tool_calls', toolCalls: [{ id: `read_${requests.length}`, name: 'read_thread',
          arguments: JSON.stringify({ thread_id: source.id, limit: 2, before }) }] };
        yield { type: 'done', finishReason: 'tool_calls' };
      } else {
        yield { type: 'text_delta', text: 'History read.' };
        yield { type: 'done', finishReason: 'stop' };
      }
    } };
    const configStore = new TestConfigStore({ ...await new TestConfigStore().getConfig(), features: { plugins: false } });
    const loop = new AgentLoop({ threadStore: runtime.threadStore, modelClient, toolHost: runtime.toolHost,
      eventBus: new InMemoryEventBus(), configStore, clock: systemClock, ids });
    await loop.sendTurn(target.id, { input: `Read ${threadMentionText(source)}` });

    const toolNames = requests[0].tools?.map((tool) => tool.name);
    expect(toolNames).toContain('read_thread');
    expect(toolNames).not.toContain('read_runtime_api');
    const results = requests.at(-1)!.messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content));
    expect(results).toMatchObject([
      { next_before: 1, messages: [{ content: 'Latest answer' }] },
      { next_before: null, messages: [{ content: 'Earlier requirement' }] },
    ]);
    expect(JSON.stringify(requests)).not.toContain('INTERNAL_SECRET');
    const saved = await runtime.threadStore.getThread(target.id);
    const runs = saved!.messages.flatMap((message) => message.toolRuns ?? []);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.name === 'read_thread' && run.status === 'success' && !run.plugin)).toBe(true);
    const events = (await runtime.threadStore.listEvents(target.id)).filter((event) => event.type === 'tool.started' || event.type === 'tool.completed');
    expect(events.map((event) => event.type)).toEqual(['tool.started', 'tool.completed', 'tool.started', 'tool.completed']);
    expect(events.every((event) => !('plugin' in event.payload) || !event.payload.plugin)).toBe(true);
    expect((await runtime.threadStore.listMessages(source.id)).messages.map((message) => message.content))
      .toEqual(['Earlier requirement', 'INTERNAL_SECRET', 'Latest answer']);
  } finally {
    await runtime.extensionManager.shutdown();
    await runtime.networkProxyFetch.close();
    await runtime.nativeBridge.close();
    await runtime.threadStore.close();
  }
});
