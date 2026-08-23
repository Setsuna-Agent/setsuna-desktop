import { describe, expect, it } from 'vitest';
import { createFeatureEvent, isFeatureEventEnvelope } from '@setsuna-desktop/feature-core/events';
import {
  goalStateReplacedEvent,
  type Goal,
} from '@setsuna-desktop/feature-goal/contracts';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { systemClock } from '../../../src/ports/clock.js';
import { ImageCapabilityConfigStore } from '../../support/agent-loop/attachments.js';
import { createGoalEnabledAgentLoop } from '../../support/agent-loop/goal-feature.js';
import {
  EditedGoalModelClient,
  FailingGoalCompletionModelClient,
  GoalSteerModelClient,
  NoProgressGoalModelClient,
  PersistentGoalModelClient,
  RegularTurnCreatesCancellableGoalModelClient,
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
      await threadStore.appendEvent(thread.id, goalStateEvent(ids, thread.id, {
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
      }));
      const loop = createGoalEnabledAgentLoop({
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
      expect(await loop.getThreadGoal(thread.id)).toMatchObject(edited);
    });

  it('does not let an in-flight turn complete a goal after the user edits its objective', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Edited active goal' });
      const modelClient = new EditedGoalModelClient();
      const loop = createGoalEnabledAgentLoop({
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
          goal: await loop.getThreadGoal(thread.id),
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

  it('continues a persistent goal across idle turns until the model marks it complete', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Persistent goal', projectId: 'project_1' });
      const modelClient = new PersistentGoalModelClient();
      const loop = createGoalEnabledAgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
        toolHost: new CapturingToolHost(),
      });
  
      await loop.setThreadGoal(thread.id, { objective: 'Inspect the project and finish the requested change', status: 'active' });
      const completedGoal = await waitForTestState(
        () => loop.getThreadGoal(thread.id),
        // Completion and final usage are committed together after the assistant turn succeeds.
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
        .filter((event) => event.type === 'token.count' && event.turnId === completionMarkers[0]?.turnId);
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
      expect(completedGoal).toMatchObject({ status: 'complete', tokensUsed: 15 });
      expect(completionMarkers).toHaveLength(1);
      expect(completionMarkers[0]).toMatchObject({
        turnId: expect.stringMatching(/^turn_/u),
        goalMode: { kind: 'complete', goal: { status: 'complete', tokensUsed: 15 } },
      });
      expect(finalUsageEvents).not.toHaveLength(0);
      expect(completionMarkerEvent?.seq).toBeGreaterThan(finalUsageSeq);
      expect(completionMarkerEvent).toBeDefined();
      expect(loop.activeTurnId(thread.id)).toBeNull();
    });

  it('does not finalize completion when the required follow-up sample fails', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Failed Goal completion' });
      const modelClient = new FailingGoalCompletionModelClient();
      const loop = createGoalEnabledAgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.setThreadGoal(thread.id, {
        objective: 'Only complete after the final response succeeds',
        status: 'active',
      });
      const blocked = await waitForTestState(
        () => loop.getThreadGoal(thread.id),
        (goal) => goal?.status === 'blocked',
        (goal) => `Timed out waiting for failed completion settlement; goal=${JSON.stringify(goal ?? null)}`,
      );
      const saved = await threadStore.getThread(thread.id);
      const followUpPrompt = modelClient.requests[1]?.messages.map((message) => message.content).join('\n') ?? '';
      const followUpToolNames = modelClient.requests[1]?.tools?.map((tool) => tool.name) ?? [];

      expect(blocked).toMatchObject({
        status: 'blocked',
        stopReason: { code: 'runtimeError', message: 'Completion follow-up failed.' },
      });
      expect(saved?.messages.some((message) => message.goalMode?.kind === 'complete')).toBe(false);
      expect(followUpPrompt).not.toContain('Continue working toward the active thread goal.');
      expect(followUpPrompt).not.toContain('<goal_context>');
      expect(followUpToolNames.filter((name) => (
        name === 'create_goal' || name === 'get_goal' || name === 'update_goal'
      ))).toEqual([]);
    });

  it('blocks autonomous continuation after three turns without new progress evidence', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'No-progress goal' });
      const modelClient = new NoProgressGoalModelClient();
      const loop = createGoalEnabledAgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.setThreadGoal(thread.id, { objective: 'Find verifiable progress', status: 'active' });
      const blocked = await waitForTestState(
        () => loop.getThreadGoal(thread.id),
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
      const loop = createGoalEnabledAgentLoop({
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
          goal: await loop.getThreadGoal(thread.id),
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
      const loop = createGoalEnabledAgentLoop({
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
        () => loop.getThreadGoal(thread.id),
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
      expect(modelClient.requests[2].tools?.map((tool) => tool.name) ?? []).toEqual([]);
    });

  it('retains regular-turn Skills, attachments, and thinking for Goal continuations', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Goal execution inheritance' });
      await threadStore.appendEvent(thread.id, goalStateEvent(ids, thread.id, {
        version: 1,
        id: 'goal_replaced_execution',
        threadId: thread.id,
        objective: 'Old paused objective',
        status: 'paused',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 2,
        execution: { skillIds: ['skill_old'], thinking: false },
      }));
      const modelClient = new RegularTurnCreatesPersistentGoalModelClient();
      const loop = createGoalEnabledAgentLoop({
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
        () => loop.getThreadGoal(thread.id),
        (goal) => goal?.status === 'complete' && goal.tokensUsed === 5,
        (goal) => `Timed out waiting for inherited Goal execution; goal=${JSON.stringify(goal)}`,
      );

      expect(completed).toMatchObject({
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
      expect(completed?.id).not.toBe('goal_replaced_execution');
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
      const loop = createGoalEnabledAgentLoop({
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
        () => loop.getThreadGoal(thread.id),
        (goal) => goal?.status === 'paused',
        (goal) => `Timed out waiting for paused goal; goal=${JSON.stringify(goal ?? null)}`,
      );
  
      expect(pausedGoal).toMatchObject({ status: 'paused' });
      expect(modelClient.requests).toHaveLength(1);
    });

  it('defers a resumed Goal until its cancelled turn has fully settled', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Resume settling goal' });
      let releaseProvider: () => void = () => undefined;
      const settleAfterAbort = new Promise<void>((resolve) => {
        releaseProvider = resolve;
      });
      const modelClient = new CancellableModelClient({
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
      }, settleAfterAbort);
      const loop = createGoalEnabledAgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.setThreadGoal(thread.id, { objective: 'Resume without overlap', status: 'active' });
      await modelClient.waitUntilAbortListenerReady();
      await waitForTestState(
        () => threadStore.listEvents(thread.id, 0),
        (events) => events.some((event) => event.type === 'token.count'),
        (events) => `Timed out waiting for pre-cancel usage; events=${JSON.stringify(events)}`,
      );
      const cancelledTurnId = loop.activeTurnId(thread.id);
      expect(cancelledTurnId).toEqual(expect.any(String));
      await loop.cancelTurn(thread.id, cancelledTurnId!);
      await waitForModelAbort(modelClient);
      await loop.setThreadGoal(thread.id, { status: 'active' });

      expect(modelClient.requests).toHaveLength(1);
      expect(await loop.getThreadGoal(thread.id)).toMatchObject({ status: 'active' });

      releaseProvider();
      await waitForModelRequestCount(modelClient, 2);
      const resumed = await waitForTestState(
        () => loop.getThreadGoal(thread.id),
        (goal) => goal?.status === 'active' && goal.tokensUsed === 5,
        (goal) => `Timed out waiting for resumed Goal accounting; goal=${JSON.stringify(goal)}`,
      );

      expect(resumed).toMatchObject({ status: 'active', tokensUsed: 5 });
      await loop.shutdown();
    });

  it('pauses a regular turn after that turn creates its Goal', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Pause founding turn' });
      const modelClient = new RegularTurnCreatesCancellableGoalModelClient();
      const loop = createGoalEnabledAgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.startTurn(thread.id, { input: 'Create a Goal and keep working on it.' });
      await modelClient.waitUntilAbortListenerReady();
      await waitForTestState(
        () => threadStore.listEvents(thread.id, 0),
        (events) => events.some((event) => event.type === 'token.count'),
        (events) => `Timed out waiting for founding-turn usage; events=${JSON.stringify(events)}`,
      );
      expect(await loop.getThreadGoal(thread.id)).toMatchObject({
        objective: 'Pause the founding regular turn',
        status: 'active',
      });

      await loop.setThreadGoal(thread.id, { status: 'paused' });
      await waitForModelAbort(modelClient);
      await loop.shutdown();
      const saved = await threadStore.getThread(thread.id);
      const savedGoal = await loop.getThreadGoal(thread.id);
      const events = await threadStore.listEvents(thread.id, 0);

      expect(modelClient.requests).toHaveLength(2);
      expect(savedGoal).toMatchObject({
        objective: 'Pause the founding regular turn',
        status: 'paused',
        tokensUsed: 5,
        stopReason: { code: 'userPaused' },
      });
      expect(saved?.messages.some((message) => message.goalMode)).toBe(false);
      expect(events.some((event) => event.type === 'thread.goal_updated')).toBe(false);
    });

  it('retains Goal revision bindings while shutdown drains an edited turn', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Shutdown edited goal' });
      const modelClient = new CancellableModelClient({
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
      });
      const loop = createGoalEnabledAgentLoop({
        threadStore,
        modelClient,
        eventBus: new InMemoryEventBus(),
        clock: systemClock,
        ids,
      });

      await loop.setThreadGoal(thread.id, { objective: 'Original shutdown objective', status: 'active' });
      await modelClient.waitUntilAbortListenerReady();
      await waitForTestState(
        () => threadStore.listEvents(thread.id, 0),
        (events) => events.some((event) => event.type === 'token.count'),
        (events) => `Timed out waiting for pre-shutdown usage; events=${JSON.stringify(events)}`,
      );
      const edited = await loop.setThreadGoal(thread.id, { objective: 'Edited shutdown objective' });

      expect(await loop.shutdown()).toBe(true);
      expect(await loop.getThreadGoal(thread.id)).toMatchObject({
        id: edited.id,
        objective: 'Edited shutdown objective',
        status: 'active',
        tokensUsed: 5,
      });
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
      const loop = createGoalEnabledAgentLoop({
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
        async () => ({
          goal: await loop.getThreadGoal(thread.id),
          thread: await threadStore.getThread(thread.id),
          activeTurnId: loop.activeTurnId(thread.id),
        }),
        (state) => state.goal === null && state.activeTurnId === null,
        (state) => `Timed out waiting for cleared Goal; state=${JSON.stringify(state)}`,
      );
      const events = await threadStore.listEvents(thread.id, 0);
      const clearedEvent = events.find((event) => (
        isFeatureEventEnvelope(event)
        && event.featureId === goalStateReplacedEvent.featureId
        && event.eventType === goalStateReplacedEvent.eventType
        && (event.payload as { goal?: unknown }).goal === null
      ));

      expect(cleared.goal).toBeNull();
      expect(cleared.thread?.messages.some((message) => message.goalMode)).toBe(false);
      expect(clearedEvent).toBeDefined();
      expect(events.some((event) => event.type === 'thread.goal_cleared')).toBe(false);
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
      const loop = createGoalEnabledAgentLoop({
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
      expect(await loop.getThreadGoal(thread.id)).toBeNull();
      releaseLookup();

      const settled = await waitForTestState(
        async () => ({
          activeTurnId: loop.activeTurnId(thread.id),
          goal: await loop.getThreadGoal(thread.id),
        }),
        (state) => state.activeTurnId === null,
        (state) => `Timed out waiting for Goal settlement race; state=${JSON.stringify(state)}`,
      );
      expect(settled.goal).toBeNull();
    });
  
  it('accepts visible user guidance during an active goal turn and samples it next', async () => {
      const ids = new RandomIdGenerator();
      const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
      const thread = await threadStore.createThread({ title: 'Guided goal' });
      const modelClient = new GoalSteerModelClient();
      const loop = createGoalEnabledAgentLoop({
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
        async () => ({ goal: await loop.getThreadGoal(thread.id), activeTurnId: loop.activeTurnId(thread.id) }),
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

function goalStateEvent(ids: RandomIdGenerator, threadId: string, goal: Goal) {
  return createFeatureEvent(
    goalStateReplacedEvent,
    {
      id: ids.id('event'),
      threadId,
      createdAt: systemClock.now().toISOString(),
    },
    { goal },
  );
}
