import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { ImageCapabilityConfigStore } from '../../support/agent-loop/attachments.js';
import {
  EditedGoalModelClient,
  GoalSteerModelClient,
  NoProgressGoalModelClient,
  PersistentGoalModelClient,
  RegularTurnCreatesPersistentGoalModelClient,
  ReplacingGoalModelClient,
} from '../../support/agent-loop/goals.js';
import {
  CancellableModelClient,
  CapturingToolHost,
  mkDataDir,
  stepSnapshotSkillRegistry,
  waitForModelAbort,
  waitForModelRequestCount,
  waitForTestState
} from '../../support/agent-loop/shared.js';

describe('agent loop persistent goals', () => {
  it('edits a durable goal without replacing its identity, counters, or execution context', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Editable goal' });
      const modelClient = new CancellableModelClient();
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'thread.goal_updated',
        createdAt: systemClock.now().toISOString(),
        payload: {
          goal: {
            version: 1,
            id: 'goal_editable',
            threadId: thread.id,
            objective: 'Original objective',
            status: 'paused',
            tokenBudget: null,
            tokensUsed: 91,
            timeUsedSeconds: 73,
            createdAt: 1,
            updatedAt: 2,
            execution: { skillIds: ['skill_goal'], thinking: true, thinkingEffort: 'high' },
          },
        },
      });
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      const edited = await loop.setThreadGoal(thread.id, { objective: 'Updated objective' });

      expect(edited).toMatchObject({
        id: 'goal_editable',
        objective: 'Updated objective',
        status: 'paused',
        tokensUsed: 91,
        timeUsedSeconds: 73,
        createdAt: 1,
        execution: { skillIds: ['skill_goal'], thinking: true, thinkingEffort: 'high' },
      });
      expect(modelClient.requests).toEqual([]);
      expect((await threadStore.getThread(thread.id))?.goal).toMatchObject(edited);
    });

  it('does not let an in-flight turn complete a goal after the user edits its objective', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Edited active goal' });
      const modelClient = new EditedGoalModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      const original = await loop.setThreadGoal(thread.id, {
        objective: 'Complete the original objective',
        status: 'active',
      });
      await waitForModelRequestCount(modelClient, 1);
      const edited = await loop.setThreadGoal(thread.id, {
        objective: 'Complete the edited objective',
      });
      modelClient.releaseStaleCompletion();

      const completed = await waitForTestState(
        async () => ({
          activeTurnId: loop.activeTurnId(thread.id),
          goal: (await threadStore.getThread(thread.id))?.goal,
        }),
        (state) => state.activeTurnId === null && state.goal?.status === 'complete',
        (state) => `Timed out waiting for edited Goal; state=${JSON.stringify(state)}`,
      );
      const events = await threadStore.listEvents(thread.id, 0);

      expect(edited.id).toBe(original.id);
      expect(completed.goal).toMatchObject({
        id: original.id,
        objective: 'Complete the edited objective',
        status: 'complete',
      });
      expect(events).toContainEqual(expect.objectContaining({
        type: 'tool.completed',
        payload: expect.objectContaining({
          toolCallId: 'goal_stale_complete',
          status: 'error',
          content: expect.stringContaining('earlier goal revision'),
        }),
      }));
      expect(modelClient.requests[2].messages).toContainEqual(expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('Complete the edited objective'),
      }));
    });

  it('pauses an active restored goal instead of silently continuing after restart', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Restored goal' });
      const modelClient = new CancellableModelClient();
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        type: 'thread.goal_updated',
        createdAt: systemClock.now().toISOString(),
        payload: {
          goal: {
            version: 1,
            id: 'goal_restored',
            threadId: thread.id,
            objective: 'Resume only when the user asks',
            status: 'active',
            tokenBudget: null,
            tokensUsed: 12,
            timeUsedSeconds: 8,
            createdAt: 1,
            updatedAt: 2,
          },
        },
      });
      const staleTurnId = 'turn_restored_goal';
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        turnId: staleTurnId,
        type: 'turn.started',
        createdAt: '2026-08-10T00:00:00.000Z',
        payload: { input: 'Continue the active goal.', taskKind: 'goal' },
      });
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        turnId: staleTurnId,
        type: 'token.count',
        createdAt: '2026-08-10T00:00:01.000Z',
        payload: { usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      });
      await threadStore.appendEvent(thread.id, {
        id: ids.id('event'),
        threadId: thread.id,
        turnId: staleTurnId,
        type: 'turn.cancelled',
        createdAt: '2026-08-10T00:00:02.000Z',
        payload: { reason: 'Turn cancelled because the desktop runtime restarted.', taskKind: 'goal' },
      });
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.reconcileRestoredGoals();
      await loop.reconcileRestoredGoals();
      const restored = await threadStore.getThread(thread.id);

      expect(restored?.goal).toMatchObject({
        id: 'goal_restored',
        status: 'paused',
        tokensUsed: 17,
        timeUsedSeconds: 10,
        stopReason: { code: 'runtimeReloaded' },
      });
      expect(restored?.messages).toContainEqual(expect.objectContaining({
        role: 'developer',
        visibility: 'transcript',
        goalMode: expect.objectContaining({ kind: 'paused' }),
      }));
      expect(modelClient.requests).toEqual([]);
    });

  it('continues a persistent goal across idle turns until the model marks it complete', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
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
      const completionMarkers = saved?.messages.filter((message) => message.goalMode?.kind === 'complete') ?? [];
      const completionMarkerEvent = events.find((event) => (
        event.type === 'message.created'
        && event.payload.message.goalMode?.kind === 'complete'
      ));
      const finalUsageEvents = events
        .filter((event) => event.type === 'token.count' && event.turnId === completionMarkers[0]?.turnId)
      const finalUsageSeq = Math.max(...finalUsageEvents.map((event) => event.seq));
  
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
      expect(completionMarkers).toHaveLength(1);
      expect(completionMarkers[0]).toMatchObject({
        turnId: expect.stringMatching(/^turn_/u),
        goalMode: { kind: 'complete', goal: { status: 'complete', tokensUsed: 15 } },
      });
      expect(finalUsageEvents).not.toHaveLength(0);
      expect(completionMarkerEvent?.seq).toBeGreaterThan(finalUsageSeq);
      expect(loop.activeTurnId(thread.id)).toBeNull();
    });

  it('blocks autonomous continuation after three turns without new progress evidence', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'No-progress goal' });
      const modelClient = new NoProgressGoalModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.setThreadGoal(thread.id, { objective: 'Find verifiable progress', status: 'active' });
      const blocked = await waitForTestState(
        async () => (await threadStore.getThread(thread.id))?.goal,
        (goal) => goal?.status === 'blocked',
        (goal) => `Timed out waiting for no-progress guard; goal=${JSON.stringify(goal ?? null)}`,
      );

      expect(blocked).toMatchObject({
        status: 'blocked',
        stopReason: { code: 'noProgress' },
        safety: { automaticTurns: 3, consecutiveNoProgressTurns: 3 },
      });
      expect(modelClient.requests).toHaveLength(3);
      expect((await threadStore.getThread(thread.id))?.messages).toContainEqual(expect.objectContaining({
        goalMode: expect.objectContaining({ kind: 'blocked' }),
      }));
    });

  it('binds an in-flight Goal turn to a replacement created by the model', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Replace active goal' });
      const modelClient = new ReplacingGoalModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      const initialGoal = await loop.setThreadGoal(thread.id, {
        objective: 'Explicitly replace this with the requested new goal',
        status: 'active',
      });
      const completed = await waitForTestState(
        async () => ({
          activeTurnId: loop.activeTurnId(thread.id),
          goal: (await threadStore.getThread(thread.id))?.goal,
        }),
        (state) => state.activeTurnId === null && state.goal?.status === 'complete',
        (state) => `Timed out waiting for replacement Goal; state=${JSON.stringify(state)}`,
      );

      expect(completed.goal).toMatchObject({
        objective: 'Replacement objective',
        status: 'complete',
      });
      expect(completed.goal?.id).not.toBe(initialGoal.id);
      expect(modelClient.requests).toHaveLength(3);
    });

  it('accounts a regular turn after create_goal binds it to the new Goal', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Create Goal from regular turn' });
      const modelClient = new ReplacingGoalModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.sendTurn(thread.id, {
        input: 'Explicitly create a persistent Goal for the replacement objective.',
      });
      const completed = await waitForTestState(
        async () => (await threadStore.getThread(thread.id))?.goal,
        (goal) => goal?.status === 'complete' && goal.tokensUsed === 6,
        (goal) => `Timed out waiting for regular Goal accounting; goal=${JSON.stringify(goal ?? null)}`,
      );

      expect(completed).toMatchObject({
        objective: 'Replacement objective',
        status: 'complete',
        tokensUsed: 6,
      });
      expect(modelClient.requests).toHaveLength(3);
      expect(modelClient.requests[0].tools?.map((tool) => tool.name)).toEqual(['create_goal']);
      expect(modelClient.requests[1].tools?.map((tool) => tool.name)).toEqual([
        'create_goal',
        'get_goal',
        'update_goal',
      ]);
      expect(modelClient.requests[2].tools?.map((tool) => tool.name)).toEqual(['create_goal']);
    });

  it('retains regular-turn Skills, attachments, and thinking for Goal continuations', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Goal execution inheritance' });
      const modelClient = new RegularTurnCreatesPersistentGoalModelClient();
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        configStore: new ImageCapabilityConfigStore(true),
        ids,
        skillRegistry: stepSnapshotSkillRegistry(),
      });
      const input = 'Step Skill create a persistent Goal with this image.';

      await loop.sendTurn(thread.id, {
        attachments: [inlineAttachment('attachment_regular_goal', 'goal.png')],
        input,
        skillIds: ['skill_step'],
        skillReferences: [{ skillId: 'skill_step', start: 0, end: 'Step Skill'.length }],
        thinking: true,
        thinkingEffort: 'high',
      });
      const completed = await waitForTestState(
        () => threadStore.getThread(thread.id),
        (snapshot) => snapshot?.goal?.status === 'complete' && snapshot.goal.tokensUsed === 5,
        (snapshot) => `Timed out waiting for inherited Goal execution; snapshot=${JSON.stringify(snapshot)}`,
      );

      expect(completed?.goal).toMatchObject({
        objective: 'Persistent objective from regular turn',
        status: 'complete',
        execution: {
          attachments: [expect.objectContaining({ id: 'attachment_regular_goal' })],
          sourceMessageId: expect.any(String),
          skillIds: ['skill_step'],
          skillReferences: [{ skillId: 'skill_step', start: 0, end: 'Step Skill'.length }],
          thinking: true,
          thinkingEffort: 'high',
        },
      });
      expect(modelClient.requests).toHaveLength(4);
      expect(modelClient.requests[2]).toMatchObject({ thinking: true, reasoningEffort: 'high' });
      expect(modelClient.requests[2]?.stepSnapshot?.messageIds).toContain('skill_skill_step');
      expect(modelClient.requests[2]?.messages.filter((message) => (
        message.attachments?.some((attachment) => attachment.id === 'attachment_regular_goal')
      ))).toHaveLength(1);
    });
  
  it('pauses a persistent goal when its active turn is cancelled', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
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

  it('does not resurrect a cleared Goal when its cancelled turn settles late', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Cleared goal' });
      const modelClient = new CancellableModelClient({
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
      });
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.setThreadGoal(thread.id, { objective: 'Clear this safely', status: 'active' });
      await modelClient.waitUntilAbortListenerReady();
      await waitForTestState(
        () => threadStore.listEvents(thread.id, 0),
        (events) => events.some((event) => event.type === 'token.count'),
        (events) => `Timed out waiting for pre-clear usage; events=${JSON.stringify(events)}`,
      );
      await loop.clearThreadGoal(thread.id);
      await waitForModelAbort(modelClient);
      const cleared = await waitForTestState(
        () => threadStore.getThread(thread.id),
        (snapshot) => snapshot?.goal === undefined && loop.activeTurnId(thread.id) === null,
        (snapshot) => `Timed out waiting for cleared Goal; snapshot=${JSON.stringify(snapshot)}`,
      );
      const events = await threadStore.listEvents(thread.id, 0);
      const clearedEvent = events.find((event) => event.type === 'thread.goal_cleared');

      expect(cleared?.goal).toBeUndefined();
      expect(cleared?.messages).toContainEqual(expect.objectContaining({
        goalMode: expect.objectContaining({ kind: 'cleared' }),
      }));
      expect(clearedEvent).toMatchObject({
        payload: {
          cleared: true,
          lifecycleMessage: expect.objectContaining({
            goalMode: expect.objectContaining({
              kind: 'cleared',
              goal: expect.objectContaining({ tokensUsed: 5 }),
            }),
          }),
        },
      });
      if (clearedEvent?.type === 'thread.goal_cleared') {
        expect(clearedEvent.payload.lifecycleMessage).not.toHaveProperty('turnId');
      }
      expect(events.filter((event) => (
        event.type === 'message.created'
        && event.payload.message.goalMode?.kind === 'cleared'
      ))).toHaveLength(0);
    });

  it('accounts an already-cancelled registered Goal turn before clearing it', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Cancelled then cleared goal' });
      let releaseProvider: () => void = () => undefined;
      const settleAfterAbort = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      const modelClient = new CancellableModelClient({
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
      }, settleAfterAbort);
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.setThreadGoal(thread.id, { objective: 'Cancel and clear safely', status: 'active' });
      await modelClient.waitUntilAbortListenerReady();
      await waitForTestState(
        () => threadStore.listEvents(thread.id, 0),
        (events) => events.some((event) => event.type === 'token.count'),
        (events) => `Timed out waiting for pre-cancel usage; events=${JSON.stringify(events)}`,
      );
      const turnId = loop.activeTurnId(thread.id);
      expect(turnId).toEqual(expect.any(String));
      await loop.cancelTurn(thread.id, turnId!);
      await waitForModelAbort(modelClient);
      expect(loop.activeTurnId(thread.id)).toBeNull();

      await loop.clearThreadGoal(thread.id);
      const clearedEvent = (await threadStore.listEvents(thread.id, 0))
        .find((event) => event.type === 'thread.goal_cleared');

      expect(clearedEvent).toMatchObject({
        payload: {
          lifecycleMessage: expect.objectContaining({
            goalMode: expect.objectContaining({
              kind: 'cleared',
              goal: expect.objectContaining({ tokensUsed: 5 }),
            }),
          }),
        },
      });
      releaseProvider();
      await loop.shutdown();
    });

  it('does not resurrect a Goal cleared while settlement is reading its turn events', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Settlement race goal' });
      const modelClient = new GoalSteerModelClient();
      const originalListEvents = threadStore.listEvents.bind(threadStore);
      let blockedTurnId: string | null = null;
      let releaseLookup: () => void = () => undefined;
      let notifyLookupStarted: () => void = () => undefined;
      const lookupReleased = new Promise<void>((resolve) => {
        releaseLookup = resolve;
      });
      const lookupStarted = new Promise<void>((resolve) => {
        notifyLookupStarted = resolve;
      });
      threadStore.listEvents = async (threadId, sinceSeq) => {
        const events = await originalListEvents(threadId, sinceSeq);
        if (
          blockedTurnId
          && events.some((event) => (
            event.turnId === blockedTurnId
            && (event.type === 'turn.completed' || event.type === 'turn.cancelled')
          ))
        ) {
          blockedTurnId = null;
          notifyLookupStarted();
          await lookupReleased;
        }
        return events;
      };
      const loop = new AgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.setThreadGoal(thread.id, { objective: 'Clear during settlement', status: 'active' });
      await waitForModelRequestCount(modelClient, 1);
      blockedTurnId = loop.activeTurnId(thread.id);
      expect(blockedTurnId).toEqual(expect.any(String));
      modelClient.releaseFirstResponse();
      await lookupStarted;

      await loop.clearThreadGoal(thread.id);
      expect((await threadStore.getThread(thread.id))?.goal).toBeUndefined();
      releaseLookup();

      const settled = await waitForTestState(
        async () => ({
          activeTurnId: loop.activeTurnId(thread.id),
          goal: (await threadStore.getThread(thread.id))?.goal,
        }),
        (state) => state.activeTurnId === null,
        (state) => `Timed out waiting for Goal settlement race; state=${JSON.stringify(state)}`,
      );
      expect(settled.goal).toBeUndefined();
    });
  
  it('accepts visible user guidance during an active goal turn and samples it next', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
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
      const messages = (await threadStore.getThread(thread.id))?.messages ?? [];
      expect(messages.filter((message) => message.role === 'assistant').at(-1)?.content)
        .toBe('Goal completed with the guidance.');
    });
});

function inlineAttachment(id: string, name: string) {
  return {
    id,
    name,
    type: 'image/png',
    size: 1,
    url: 'data:image/png;base64,AA==',
  };
}
