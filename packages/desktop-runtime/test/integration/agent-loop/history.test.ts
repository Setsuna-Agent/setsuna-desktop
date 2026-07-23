import {
  applyRuntimeEventToThread,
  type RuntimeEvent,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
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
  MemoryCapturingModelClient,
  mkDataDir,
  waitForTurnCompleted
} from '../../support/agent-loop/shared.js';

describe('agent loop stream history and regeneration', () => {
  it('continues a real N-1 fixture with repeated Chat IDs and a split compacted tool transaction', async () => {
      const dataDir = await mkDataDir();
      const fixtureSnapshotUrl = new URL('../../fixtures/history/n-1-protocol-history-thread.json', import.meta.url);
      const fixtureEventsUrl = new URL('../../fixtures/history/n-1-protocol-history-thread.jsonl', import.meta.url);
      const fixtureSnapshot = JSON.parse(await readFile(fixtureSnapshotUrl, 'utf8')) as RuntimeThread;
      const fixtureEvents = (await readFile(fixtureEventsUrl, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as RuntimeEvent);
      let replayedFixture: RuntimeThread = {
        id: fixtureSnapshot.id,
        title: fixtureSnapshot.title,
        createdAt: fixtureSnapshot.createdAt,
        updatedAt: fixtureSnapshot.createdAt,
        archived: false,
        memoryMode: 'enabled',
        messageCount: 0,
        lastMessagePreview: '',
        messages: [],
        lastSeq: 0,
      };
      for (const event of fixtureEvents) {
        replayedFixture = applyRuntimeEventToThread(replayedFixture, event);
      }
      expect(JSON.parse(JSON.stringify(replayedFixture))).toEqual(fixtureSnapshot);

      await mkdir(path.join(dataDir, 'threads'), { recursive: true });
      await Promise.all([
        copyFile(fixtureSnapshotUrl, path.join(dataDir, 'threads', 'thread_n1_protocol_history.json')),
        copyFile(fixtureEventsUrl, path.join(dataDir, 'threads', 'thread_n1_protocol_history.jsonl')),
      ]);

      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(dataDir, systemClock, ids);
      const legacy = await threadStore.getThread('thread_n1_protocol_history');
      expect(await threadStore.listEvents('thread_n1_protocol_history')).toHaveLength(10);
      expect(legacy?.messages.every((message) => message.providerMetadata === undefined)).toBe(true);

      const modelClient = new MemoryCapturingModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.sendTurn('thread_n1_protocol_history', { input: 'Continue from the old thread.' });

      const requestMessages = modelClient.requests[0]?.messages ?? [];
      const firstAssistant = requestMessages.find((message) => message.id === 'n1_assistant_1');
      const firstTool = requestMessages.find((message) => message.id === 'n1_tool_1');
      const secondAssistant = requestMessages.find((message) => message.id === 'n1_assistant_2');
      const secondTool = requestMessages.find((message) => message.id === 'n1_tool_2');
      const secondWireId = secondAssistant?.toolCalls?.[0]?.id;
      expect(firstAssistant?.toolCalls?.[0]?.id).toBe('call_0');
      expect(firstTool?.toolCallId).toBe('call_0');
      expect(secondWireId).toMatch(/^call_setsuna_[a-f0-9]{24}$/);
      expect(secondTool?.toolCallId).toBe(secondWireId);
      expect(requestMessages.find((message) => message.id === 'n1_split_tool'))
        .toBeUndefined();

      const events = await threadStore.listEvents('thread_n1_protocol_history');
      expect(events).toContainEqual(expect.objectContaining({
        type: 'model.verification',
        payload: {
          verification: {
            warnings: ['legacy_orphan_tool_result_omitted'],
          },
        },
      }));

      // Compatibility normalization is lazy and model-facing; opening/continuing does not rewrite
      // the N-1 semantic snapshot or invent provider metadata.
      const saved = await threadStore.getThread('thread_n1_protocol_history');
      expect(saved?.messages.find((message) => message.id === 'n1_assistant_2')?.toolCalls?.[0]?.id)
        .toBe('call_0');
      expect(saved?.messages.find((message) => message.id === 'n1_split_tool')?.visibility)
        .toBe('model');
      expect(saved?.messages
        .filter((message) => message.id.startsWith('n1_'))
        .every((message) => message.providerMetadata === undefined)).toBe(true);
    });

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
      expect(saved?.messages[1]?.providerMetadata?.openAiResponses).toMatchObject({
        responseId: 'resp_2',
        items: [expect.objectContaining({ id: 'native_answer_2', phase: 'final_answer' })],
      });
      expect(saved?.messages[1]?.providerMetadata?.semanticFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(JSON.stringify(saved?.messages)).not.toContain('resp_1');
      expect(modelClient.requests[1].messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
        'edited prompt',
      ]);
      expect(events.some((event) => event.type === 'message.updated')).toBe(true);
      expect(events.some((event) => event.type === 'messages.truncated')).toBe(true);
      expect(events.filter((event) => event.type === 'message.created' && event.payload.message.role === 'user')).toHaveLength(1);
    });
});
