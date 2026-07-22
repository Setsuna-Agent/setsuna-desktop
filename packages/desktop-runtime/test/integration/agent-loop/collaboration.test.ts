import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  CollaborationJoinModelClient,
  CollaborationToolModelClient,
  MultiAgentConfigStore
} from '../../support/agent-loop/collaboration.js';
import {
  mkDataDir,
  waitForTestState,
  waitForTurnCompleted
} from '../../support/agent-loop/shared.js';

describe('agent loop collaboration tools', () => {
  it('runs built-in collaboration tools across spawned child threads', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const parent = await threadStore.createThread({ title: 'Parent collaboration loop', projectId: 'project_1' });
      const modelClient = new CollaborationToolModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        configStore: new MultiAgentConfigStore(),
      });
  
      await loop.sendTurn(parent.id, { input: 'coordinate child agent work' });
  
      const children = await threadStore.listThreads({ includeArchived: true, parentThreadId: parent.id });
      const child = children[0] ? await threadStore.getThread(children[0].id) : null;
      const parentEvents = await threadStore.listEvents(parent.id, 0);
      const childEvents = child ? await threadStore.listEvents(child.id, 0) : [];
  
      expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual([
        'spawn_agent',
        'send_input',
        'resume_agent',
        'wait',
        'close_agent',
      ]);
      expect(child).toMatchObject({ parentThreadId: parent.id, projectId: 'project_1' });
      expect(parentEvents.filter((event) => event.type === 'item.completed').map((event) => event.payload.item.kind)).toEqual(expect.arrayContaining([
        'collab_tool_call',
      ]));
      expect(parentEvents.filter((event) => event.type === 'tool.completed').map((event) => event.payload.toolName)).toEqual([
        'spawn_agent',
        'send_input',
        'resume_agent',
        'wait',
        'close_agent',
      ]);
      expect(childEvents.filter((event) => event.type === 'mailbox.delivered').map((event) => event.payload.deliveryMode)).toEqual([
        'queue_only',
        'trigger_turn',
      ]);
      expect(child?.messages.some((message) => message.role === 'assistant' && message.content.includes('Child resumed with mailbox.'))).toBe(true);
      const waitResultMessage = modelClient.requests
        .flatMap((request) => request.messages)
        .find((message) => message.role === 'tool' && message.toolName === 'wait');
      expect(waitResultMessage?.content).toContain('Child resumed with mailbox.');
      expect((await threadStore.getThread(parent.id))?.messages.at(-1)?.content).toBe('Parent completed collaboration.');
    });
  
  it('keeps the parent turn active until spawned child research is collected', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const parent = await threadStore.createThread({ title: 'Parent waits for research' });
      const modelClient = new CollaborationJoinModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        configStore: new MultiAgentConfigStore(),
      });
  
      const started = await loop.startTurn(parent.id, { input: 'research this with a child' });
      await modelClient.childStarted;
      await waitForTestState(
        () => modelClient.parentRequests.length,
        (count) => count >= 2,
        (count) => `Timed out waiting for premature parent answer; requests=${count}`,
      );
      const waitingThread = await waitForTestState(
        () => threadStore.getThread(parent.id),
        (thread) => Boolean(thread?.messages.some((message) => message.content.includes('主任务会继续等待'))),
        (thread) => `Timed out waiting for the persisted collaboration wait note; messages=${thread?.messages.length ?? 0}`,
      );
      const waitingEvents = await threadStore.listEvents(parent.id, 0);
  
      expect(loop.activeTurnId(parent.id)).toBe(started.turnId);
      expect(waitingEvents.some((event) => event.type === 'turn.completed' && event.turnId === started.turnId)).toBe(false);
      expect(waitingThread?.messages.some((message) => message.content.includes('主任务会继续等待'))).toBe(true);
  
      modelClient.finishChild();
      await waitForTurnCompleted(threadStore, parent.id, started.turnId);
      const completed = await threadStore.getThread(parent.id);
  
      expect(modelClient.parentRequests).toHaveLength(3);
      expect(modelClient.parentRequests[2].messages.some((message) => message.content.includes('<collaboration_results>') && message.content.includes('Detailed child research.'))).toBe(true);
      expect(completed?.messages.at(-1)?.content).toBe('Parent incorporated the child research.');
    });
});
