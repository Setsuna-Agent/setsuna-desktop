import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  NonCooperativeCancellationModelClient,
  NonWaitingCancellationToolHost,
  waitForModelRequest,
} from '../../support/agent-loop/cancellation.js';
import {
  CancellableModelClient,
  mkDataDir,
  SingleToolCallModelClient,
  waitForModelAbort,
  waitForTurnCancelled
} from '../../support/agent-loop/shared.js';

describe('agent loop turn cancellation', () => {
  it('cancels active turns without publishing runtime errors', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Cancel loop' });
      const modelClient = new CancellableModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });
  
      const started = await loop.startTurn(thread.id, { input: 'keep going until cancelled' });
      await waitForModelRequest(modelClient);
      await modelClient.waitUntilAbortListenerReady();
  
      await expect(loop.cancelTurn(thread.id, started.turnId)).resolves.toBe(true);
      const events = await waitForTurnCancelled(threadStore, thread.id);
      const saved = await threadStore.getThread(thread.id);
      const markerIndex = events.findIndex((event) => event.type === 'message.created'
        && event.turnId === started.turnId
        && event.payload.message.role === 'user'
        && event.payload.message.visibility === 'model'
        && event.payload.message.content.includes('<turn_aborted>'));
      const cancelledIndex = events.findIndex((event) => event.type === 'turn.cancelled' && event.turnId === started.turnId);
  
      await waitForModelAbort(modelClient);
      expect(modelClient.aborted).toBe(true);
      expect(events.some((event) => event.type === 'turn.cancelled' && event.turnId === started.turnId)).toBe(true);
      expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
      expect(markerIndex).toBeGreaterThanOrEqual(0);
      expect(cancelledIndex).toBeGreaterThan(markerIndex);
      expect(saved?.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          turnId: started.turnId,
          role: 'user',
          visibility: 'model',
          content: expect.stringContaining('<turn_aborted>'),
        }),
      ]));
      expect(saved?.messages.at(-1)?.status).toBe('complete');
    });
  
  it('publishes cancellation immediately when a model stream ignores abort', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Non-cooperative cancel' });
      const modelClient = new NonCooperativeCancellationModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });
  
      const started = await loop.startTurn(thread.id, { input: 'start and hang' });
      await waitForModelRequest(modelClient);
      await modelClient.waitUntilAbortListenerReady();
  
      await expect(loop.cancelTurn(thread.id, started.turnId)).resolves.toBe(true);
  
      const events = await threadStore.listEvents(thread.id, 0);
      const saved = await threadStore.getThread(thread.id);
      await waitForModelAbort(modelClient);
      expect(modelClient.aborted).toBe(true);
      expect(events.filter((event) => event.type === 'turn.cancelled' && event.turnId === started.turnId)).toHaveLength(1);
      expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
      expect(saved?.activeTurnId).toBeNull();
      expect(saved?.messages.find((message) => message.role === 'assistant' && message.turnId === started.turnId)?.status).toBe('complete');
    });
  
  it('does not wait for tool runtimes that opt out of cancellation waiting', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Non waiting tool cancel', projectId: 'project_1' });
      const toolHost = new NonWaitingCancellationToolHost();
      const loop = new AgentLoop({
        threadStore,
        modelClient: new SingleToolCallModelClient({ id: 'call_background', name: 'background_tool', arguments: '{}' }),
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost,
      });
  
      const running = loop.sendTurn(thread.id, { input: 'start background tool' });
      await toolHost.started;
      const turnId = loop.activeTurnId(thread.id);
  
      expect(turnId).toBeTruthy();
      await expect(loop.cancelTurn(thread.id, turnId!)).resolves.toBe(true);
      await expect(running).resolves.toBeUndefined();
      expect(loop.activeTurnId(thread.id)).toBeNull();
      toolHost.release();
      await toolHost.done;
  
      const events = await threadStore.listEvents(thread.id, 0);
      expect(events.some((event) => event.type === 'tool.started' && event.payload.toolName === 'background_tool')).toBe(true);
      expect(events.some((event) => event.type === 'turn.cancelled' && event.turnId === turnId)).toBe(true);
      expect(events.some((event) => event.type === 'runtime.error')).toBe(false);
    });
});
