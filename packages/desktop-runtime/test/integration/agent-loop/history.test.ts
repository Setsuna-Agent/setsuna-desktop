import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  ItemBasedModelClient,
  NativeItemToolCallModelClient,
  RegenerateModelClient,
} from '../../support/agent-loop/history.js';
import {
  CapturingToolHost,
  CapturingUsageStore,
  mkDataDir,
  waitForTurnCompleted
} from '../../support/agent-loop/shared.js';

describe('agent loop stream history and regeneration', () => {
  it('keeps assistant history populated when the model streams item-based content', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Item stream loop' });
      const modelClient = new ItemBasedModelClient();
      const usageStore = new CapturingUsageStore();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        usageStore,
      });
  
      await loop.sendTurn(thread.id, { input: 'stream using response items' });
      const events = await threadStore.listEvents(thread.id, 0);
      const saved = await threadStore.getThread(thread.id);
      const assistant = saved?.messages.find((message) => message.role === 'assistant');
  
      expect(assistant?.content).toBe('<think>Need context.</think>Hello from item stream.');
      expect(events).toContainEqual(expect.objectContaining({
        type: 'item.started',
        payload: { item: { id: 'agent_item_1', kind: 'agent_message', status: 'in_progress' } },
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'plan.delta',
        payload: { itemId: 'plan_item_1', delta: '1. Inspect state.' },
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'reasoning.summary_delta',
        payload: { itemId: 'reasoning_item_1', delta: 'Need context.', summaryIndex: 0 },
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'reasoning.summary_part_added',
        payload: { itemId: 'reasoning_item_1', summaryIndex: 0 },
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'token.count',
        payload: { usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 }, modelContextWindow: 128000 },
      }));
      expect(saved?.turns?.[0]).toMatchObject({
        id: expect.any(String),
        status: 'completed',
        diff: 'diff --git a/README.md b/README.md\n+Hello',
        items: [
          { id: 'plan_item_1', kind: 'plan', content: '1. Inspect state.' },
          { id: 'reasoning_item_1', kind: 'reasoning', status: 'completed', content: 'Need context.' },
          { id: 'agent_item_1', kind: 'agent_message', status: 'completed', content: 'Hello from item stream.' },
        ],
      });
      expect(saved?.turns?.[0]?.tokenCounts).toEqual(expect.arrayContaining([
        expect.objectContaining({
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          modelContextWindow: 128000,
        }),
      ]));
      expect(usageStore.records).toMatchObject([{
        threadId: thread.id,
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      }]);
    });
  
  it('executes tool calls surfaced as native stream items', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Native item tool loop', projectId: 'project_1' });
      const modelClient = new NativeItemToolCallModelClient();
      const toolHost = new CapturingToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      await loop.sendTurn(thread.id, { input: 'read README via native item' });
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(toolHost.calls).toEqual([{ name: 'workspace_read_file', input: { path: 'README.md' }, projectId: 'project_1' }]);
      expect(modelClient.requests).toHaveLength(2);
      expect(modelClient.requests[1].messages.some((message) => message.role === 'tool' && message.content.includes('file contents'))).toBe(true);
      expect(saved?.messages.at(-1)?.content).toBe('Native item tool result handled.');
      expect(events).toContainEqual(expect.objectContaining({
        type: 'item.started',
        payload: {
          item: {
            id: 'call_native_1',
            kind: 'tool_call',
            status: 'in_progress',
            toolCall: { id: 'call_native_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
          },
        },
      }));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'item.completed',
        payload: {
          item: {
            id: 'call_native_1',
            kind: 'tool_call',
            status: 'completed',
            toolCall: { id: 'call_native_1', name: 'workspace_read_file', arguments: '{"path":"README.md"}' },
          },
        },
      }));
    });
  
  it('edits a user message, truncates following replies, and regenerates without duplicating the user turn', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Regenerate loop' });
      const modelClient = new RegenerateModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });
  
      await loop.sendTurn(thread.id, { input: 'original prompt' });
      const firstSaved = await threadStore.getThread(thread.id);
      const userMessageId = firstSaved?.messages.find((message) => message.role === 'user')?.id;
      if (!userMessageId) throw new Error('Expected a user message to regenerate.');
  
      const regenerated = await loop.regenerateFromMessage(thread.id, userMessageId, { content: 'edited prompt' });
      await waitForTurnCompleted(threadStore, thread.id, regenerated.turnId);
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
  
      expect(saved?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
      expect(saved?.messages[0]).toMatchObject({ id: userMessageId, content: 'edited prompt' });
      expect(saved?.messages[1]?.content).toBe('answer 2');
      expect(modelClient.requests[1].messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
        'edited prompt',
      ]);
      expect(events.some((event) => event.type === 'message.updated')).toBe(true);
      expect(events.some((event) => event.type === 'messages.truncated')).toBe(true);
      expect(events.filter((event) => event.type === 'message.created' && event.payload.message.role === 'user')).toHaveLength(1);
    });
});
