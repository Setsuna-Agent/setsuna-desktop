import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { bindTestCollaborationFeature, childThreadIdFromCollaborationToolMessages, MultiAgentConfigStore } from '../../support/agent-loop/collaboration.js';
import { mkDataDir, waitForTestState, waitForTurnCompleted } from '../../support/agent-loop/shared.js';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('collaboration lifecycle through AgentLoop and SQLite', () => {
  it('delivers a completed child before the next tool step without an explicit wait or a premature final answer', async () => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const parent = await store.createThread({ title: 'Parent continues working' });
    const finishChild = gate();
    const requests: ModelRequest[] = [];
    const runTool = vi.fn(async () => ({ content: 'Independent parent evidence' }));
    const loop = new AgentLoop({
      threadStore: store, ids, clock: systemClock, eventBus: new InMemoryEventBus(), configStore: new MultiAgentConfigStore(),
      toolHost: { listTools: async () => [{ name: 'read_file', description: 'Read evidence', inputSchema: { type: 'object' } }], runTool },
      modelClient: { async *stream(request): AsyncGenerator<ModelStreamEvent> {
        if (request.messages.some((message) => message.inputKind === 'subagent_task')) {
          await finishChild.promise;
          yield { type: 'text_delta', text: 'Completed child evidence' };
          yield { type: 'done', finishReason: 'stop' };
          return;
        }
        requests.push(request);
        const childId = childThreadIdFromCollaborationToolMessages(request.messages);
        if (!childId) {
          yield { type: 'tool_calls', toolCalls: [{ id: 'spawn', name: 'spawn_agent', arguments: '{"prompt":"Inspect independent evidence"}' }] };
        } else if (!request.messages.some((message) => message.toolCallId === 'parent_read')) {
          finishChild.release();
          await waitForTestState(() => store.getThread(childId), (saved) => saved?.turns?.at(-1)?.status === 'completed', () => 'Child did not complete');
          yield { type: 'tool_calls', toolCalls: [{ id: 'parent_read', name: 'read_file', arguments: '{"file_path":"README.md"}' }] };
        } else {
          const results = request.messages.filter((message) => message.id.startsWith('collaboration_result_'));
          expect(results).toHaveLength(1);
          expect(results[0]).toMatchObject({ promptSource: 'collaboration', content: expect.stringContaining('Completed child evidence') });
          yield { type: 'text_delta', text: 'Combined parent and child evidence' };
          yield { type: 'done', finishReason: 'stop' };
          return;
        }
        yield { type: 'done', finishReason: 'tool_calls' };
      } },
    });
    bindTestCollaborationFeature(loop, store);
    try {
      await loop.sendTurn(parent.id, { input: 'Investigate in parallel and continue your own work' });
      expect(requests).toHaveLength(3);
      expect(runTool).toHaveBeenCalledTimes(1);
      const saved = await store.getThread(parent.id);
      expect(saved?.messages.at(-1)?.content).toBe('Combined parent and child evidence');
      expect(saved?.messages.filter((message) => message.id.startsWith('collaboration_result_'))).toHaveLength(1);
      const events = await store.listEvents(parent.id, 0);
      expect(events.filter((event) => event.type === 'tool.completed').map((event) => event.payload.toolName)).toEqual(['spawn_agent', 'read_file']);
    } finally { finishChild.release(); await loop.shutdown(); await store.close(); }
  });

  for (const input of ['steer', 'child-report', 'cancel'] as const) {
    it.each(['automatic', 'explicit'] as const)(`handles ${input} during %s child waiting`, async (waitMode) => {
      const ids = new RandomIdGenerator();
      const store = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const parent = await store.createThread({ title: 'Parent' });
      const report = gate();
      const finish = gate();
      const inputObserved = gate();
      const requests: ModelRequest[] = [];
      const model = {
        async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
          requests.push(request);
          if (request.messages.some((message) => message.inputKind === 'subagent_task')) {
            if (input === 'child-report' && !request.messages.some((message) => message.toolCallId === 'report')) {
              await report.promise;
              yield { type: 'tool_calls', toolCalls: [{ id: 'report', name: 'send_input', arguments: JSON.stringify({ thread_id: parent.id, content: 'Intermediate evidence' }) }] };
              yield { type: 'done', finishReason: 'tool_calls' };
              return;
            }
            await finish.promise;
            yield { type: 'text_delta', text: 'Final child evidence' };
          } else {
            const childId = childThreadIdFromCollaborationToolMessages(request.messages);
            if (!childId) {
              yield { type: 'tool_calls', toolCalls: [{ id: 'spawn', name: 'spawn_agent', arguments: '{"prompt":"Inspect evidence"}' }] };
              yield { type: 'done', finishReason: 'tool_calls' };
              return;
            }
            if (request.messages.some((message) => message.content === 'Changed direction' || message.content.includes('Intermediate evidence'))) inputObserved.release();
            if (waitMode === 'explicit' && !request.messages.some((message) => message.toolName === 'wait')) {
              yield { type: 'text_delta', text: 'Parent waiting' };
              yield { type: 'tool_calls', toolCalls: [{ id: 'wait', name: 'wait', arguments: JSON.stringify({ thread_id: childId }) }] };
              yield { type: 'done', finishReason: 'tool_calls' };
              return;
            }
            yield { type: 'text_delta', text: request.messages.some((message) => message.content.includes('<collaboration_results>')) ? 'Integrated evidence' : 'Parent waiting' };
          }
          yield { type: 'done', finishReason: 'stop' };
        },
      };
      const loop = new AgentLoop({ threadStore: store, ids, clock: systemClock, eventBus: new InMemoryEventBus(), modelClient: model, configStore: new MultiAgentConfigStore() });
      bindTestCollaborationFeature(loop, store);
      try {
        const started = await loop.startTurn(parent.id, { input: 'Investigate with a child' });
        await waitForTestState(() => store.getThread(parent.id), (saved) => Boolean(saved?.messages.some((message) => message.content === 'Parent waiting' && message.phase === 'commentary')), () => 'Parent never reached the join');
        const [child] = await store.listThreads({ parentThreadId: parent.id });
        expect(loop.activeTurnId(child!.id)).toBeTruthy();
        if (input === 'cancel') {
          await loop.cancelTurn(parent.id, started.turnId!);
          expect(loop.activeTurnId(parent.id)).toBeNull();
          expect(loop.activeTurnId(child!.id)).toBeNull();
          expect((await store.getThread(child!.id))?.turns?.at(-1)?.status).toBe('cancelled');
        } else {
          if (input === 'steer') await loop.steerTurn(parent.id, { expectedTurnId: started.turnId!, input: 'Changed direction' });
          else report.release();
          await inputObserved.promise;
          // The parent processed new input before the child finished.
          expect(loop.activeTurnId(child!.id)).toBeTruthy();
          finish.release();
          await waitForTurnCompleted(store, parent.id, started.turnId!);
          const saved = await store.getThread(parent.id);
          expect(saved?.messages.at(-1)?.content).toBe('Integrated evidence');
          expect(saved?.messages.filter((message) => message.id.startsWith('collaboration_result_'))).toHaveLength(1);
          if (input === 'child-report') expect(saved?.messages.find((message) => message.id.startsWith('mailbox_'))).toMatchObject({ visibility: 'model', promptSource: 'collaboration' });
        }
        const childRequests = requests.filter((request) => request.messages.some((message) => message.inputKind === 'subagent_task'));
        expect(childRequests.every((request) => request.tools?.every((tool) => tool.name === 'send_input'))).toBe(true);
      } finally { report.release(); finish.release(); await loop.shutdown(); }
    });
  }

  it('recovers queued mailbox input after reopening SQLite and does not redeliver it on another restart', async () => {
    const dataDir = await mkDataDir();
    const ids = new RandomIdGenerator();
    let store = createTestThreadStore(dataDir, systemClock, ids);
    const parent = await store.createThread({ title: 'Recover mailbox' });
    const requests: ModelRequest[] = [];
    const model = { async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
      requests.push(request); yield { type: 'text_delta', text: 'Handled' }; yield { type: 'done', finishReason: 'stop' };
    } };
    const createLoop = () => new AgentLoop({ threadStore: store, ids, clock: systemClock, eventBus: new InMemoryEventBus(), modelClient: model });
    let loop = createLoop();
    await loop.deliverMailboxInput(parent.id, { id: 'durable', content: 'Keep this report', fromAgentId: 'child', deliveryMode: 'queue_only' });
    await loop.shutdown(); await store.close();
    for (let restart = 0; restart < 2; restart += 1) {
      store = createTestThreadStore(dataDir, systemClock, ids);
      loop = createLoop();
      try {
        await loop.sendTurn(parent.id, { input: 'Continue' });
        expect(requests.at(-1)?.messages.filter((message) => message.id === 'mailbox_durable')).toHaveLength(1);
        expect((await store.getThread(parent.id))?.messages.filter((message) => message.id === 'mailbox_durable')).toHaveLength(1);
      } finally { await loop.shutdown(); await store.close(); }
    }
  });
});
