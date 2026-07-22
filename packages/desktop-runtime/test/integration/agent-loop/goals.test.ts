import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import {
  GoalSteerModelClient,
  PersistentGoalModelClient,
} from '../../support/agent-loop/goals.js';
import {
  CancellableModelClient,
  CapturingToolHost,
  mkDataDir,
  waitForModelAbort,
  waitForModelRequestCount,
  waitForTestState
} from '../../support/agent-loop/shared.js';

describe('agent loop persistent goals', () => {
  it('continues a persistent goal across idle turns until the model marks it complete', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Persistent goal', projectId: 'project_1' });
      const modelClient = new PersistentGoalModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost: new CapturingToolHost(),
      });
  
      await loop.setThreadGoal(thread.id, { objective: 'Inspect the project and finish the requested change', status: 'active' });
      const completedGoal = await waitForTestState(
        async () => (await threadStore.getThread(thread.id))?.goal,
        // update_goal 会在最终助手片段稳定前发布终止状态；还需等待该片段的用量完成计入。
        (goal) => goal?.status === 'complete' && goal.tokensUsed === 15,
        (goal) => `Timed out waiting for goal completion; goal=${JSON.stringify(goal ?? null)}`,
      );
      await waitForModelRequestCount(modelClient, 4);
      await waitForTestState(
        () => loop.activeTurnId(thread.id),
        (turnId) => turnId === null,
        (turnId) => `Timed out waiting for final goal turn; activeTurnId=${String(turnId)}`,
      );
      const saved = await threadStore.getThread(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);
      const goalTurns = events.filter((event) => event.type === 'turn.started' && event.payload.taskKind === 'goal');
  
      expect(goalTurns).toHaveLength(2);
      expect(modelClient.requests).toHaveLength(4);
      expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(expect.arrayContaining(['get_goal', 'create_goal', 'update_goal']));
      expect(modelClient.requests[0].messages).toContainEqual(expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('Inspect the project and finish the requested change'),
      }));
      expect(modelClient.requests[0].messages).toContainEqual(expect.objectContaining({
        role: 'user',
        content: 'Continue the active goal.',
      }));
      expect(saved?.messages.some((message) => message.role === 'user')).toBe(false);
      expect(saved?.messages.filter((message) => message.role === 'assistant').map((message) => message.content)).toEqual(expect.arrayContaining([
        'First goal chunk complete.',
        'Goal verified complete.',
      ]));
      expect(completedGoal).toMatchObject({ status: 'complete' });
      expect(saved?.goal).toMatchObject({ status: 'complete', tokensUsed: 15 });
      expect(loop.activeTurnId(thread.id)).toBeNull();
    });
  
  it('pauses a persistent goal when its active turn is cancelled', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Cancelled goal' });
      const modelClient = new CancellableModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });
  
      await loop.setThreadGoal(thread.id, { objective: 'Keep working until cancelled', status: 'active' });
      await modelClient.waitUntilAbortListenerReady();
      const activeTurnId = loop.activeTurnId(thread.id);
      expect(activeTurnId).toEqual(expect.any(String));
      await loop.cancelTurn(thread.id, activeTurnId!);
      await waitForModelAbort(modelClient);
      const pausedGoal = await waitForTestState(
        async () => (await threadStore.getThread(thread.id))?.goal,
        (goal) => goal?.status === 'paused',
        (goal) => `Timed out waiting for paused goal; goal=${JSON.stringify(goal ?? null)}`,
      );
  
      expect(pausedGoal).toMatchObject({ status: 'paused' });
      expect(modelClient.requests).toHaveLength(1);
    });
  
  it('accepts visible user guidance during an active goal turn and samples it next', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Guided goal' });
      const modelClient = new GoalSteerModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });
  
      await loop.setThreadGoal(thread.id, { objective: 'Finish with user guidance', status: 'active' });
      await waitForModelRequestCount(modelClient, 1);
      const goalTurnId = loop.activeTurnId(thread.id);
      expect(goalTurnId).toEqual(expect.any(String));
  
      await expect(loop.steerTurn(thread.id, {
        clientId: 'client-goal-steer',
        expectedTurnId: goalTurnId!,
        input: 'Use the more detailed approach.',
      })).resolves.toEqual({ accepted: true, turnId: goalTurnId });
      expect((await threadStore.getThread(thread.id))?.messages.find((message) => message.clientId === 'client-goal-steer')).toMatchObject({
        role: 'user',
        content: 'Use the more detailed approach.',
        turnId: goalTurnId,
      });
  
      modelClient.releaseFirstResponse();
      await waitForTestState(
        async () => ({ goal: (await threadStore.getThread(thread.id))?.goal, activeTurnId: loop.activeTurnId(thread.id) }),
        (state) => state.goal?.status === 'complete' && state.activeTurnId === null,
        (state) => `Timed out waiting for guided goal completion; state=${JSON.stringify(state)}`,
      );
  
      expect(modelClient.requests).toHaveLength(3);
      expect(modelClient.requests[1].messages.find((message) => message.clientId === 'client-goal-steer')).toMatchObject({
        role: 'user',
        content: 'Use the more detailed approach.',
      });
      expect((await threadStore.getThread(thread.id))?.messages.at(-1)?.content).toBe('Goal completed with the guidance.');
    });
});
