import type { ModelRequest, ModelStreamEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { ModelClient } from '../../../src/ports/model-client.js';
import { ImageCapabilityConfigStore } from '../../support/agent-loop/attachments.js';
import {
  mkDataDir,
  stepSnapshotSkillRegistry,
  waitForModelRequestCount,
  waitForTestState,
} from '../../support/agent-loop/shared.js';
import { SteerableModelClient } from '../../support/agent-loop/steering-mailbox.js';

describe('agent loop queued turn inputs', () => {
  it('persists active-turn input and automatically sends queued items in FIFO order', async () => {
    const { loop, modelClient, threadStore, threadId } = await createBlockedLoop();
    const started = await loop.startTurn(threadId, {
      clientId: 'client-initial',
      input: 'Initial prompt',
    });
    await waitForModelRequestCount(modelClient, 1);

    const first = await loop.queueTurnInput(threadId, {
      clientId: 'client-queued-1',
      input: 'First queued prompt',
      skillIds: ['skill_step'],
      thinking: true,
      thinkingEffort: 'high',
    });
    const second = await loop.queueTurnInput(threadId, {
      clientId: 'client-queued-2',
      input: 'Second queued prompt',
    });
    const beforeRelease = await threadStore.getThread(threadId);

    expect(first).toMatchObject({ disposition: 'queued', turnId: null });
    expect(second).toMatchObject({ disposition: 'queued', turnId: null });
    expect(beforeRelease?.queuedTurnInputs?.map((item) => item.input)).toEqual([
      'First queued prompt',
      'Second queued prompt',
    ]);
    expect(beforeRelease?.messages.filter((message) => message.role === 'user')).toHaveLength(1);

    modelClient.releaseFirstResponse();
    const completed = await waitForQueueDrain(threadStore, threadId, 3);
    const userMessages = completed.messages.filter((message) => message.role === 'user');

    expect(modelClient.requests).toHaveLength(3);
    expect(modelClient.requests[1]).toMatchObject({
      thinking: true,
      reasoningEffort: 'high',
    });
    expect(modelClient.requests[1]?.stepSnapshot?.messageIds).toContain('skill_skill_step');
    expect(userMessages.map((message) => message.content)).toEqual([
      'Initial prompt',
      'First queued prompt',
      'Second queued prompt',
    ]);
    expect(new Set(userMessages.map((message) => message.turnId)).size).toBe(3);
    expect(userMessages[0]?.turnId).toBe(started.turnId);
  });

  it('sends a queued item immediately by steering the current turn', async () => {
    const { loop, modelClient, threadStore, threadId } = await createBlockedLoop();
    const started = await loop.startTurn(threadId, { input: 'Initial prompt' });
    await waitForModelRequestCount(modelClient, 1);
    const queued = await loop.queueTurnInput(threadId, {
      clientId: 'client-send-now',
      input: 'Use this guidance now',
    });

    await expect(loop.sendQueuedTurnInputNow(threadId, queued.queuedInputId)).resolves.toMatchObject({
      disposition: 'steered',
      queuedInputId: queued.queuedInputId,
      turnId: started.turnId,
    });
    const steered = await threadStore.getThread(threadId);
    expect(steered?.queuedTurnInputs).toEqual([]);
    expect(steered?.messages.find((message) => message.clientId === 'client-send-now')).toMatchObject({
      content: 'Use this guidance now',
      role: 'user',
      turnId: started.turnId,
    });

    modelClient.releaseFirstResponse();
    await waitForThreadIdle(threadStore, threadId);

    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[1]?.messages.find((message) => message.clientId === 'client-send-now')).toMatchObject({
      content: 'Use this guidance now',
      turnId: started.turnId,
    });
  });

  it('retrieves, updates, and deletes pending items without leaking removed content', async () => {
    const { loop, modelClient, threadStore, threadId } = await createBlockedLoop();
    await loop.startTurn(threadId, { input: 'Initial prompt' });
    await waitForModelRequestCount(modelClient, 1);
    const kept = await loop.queueTurnInput(threadId, {
      clientId: 'client-edit',
      input: 'Prompt before edit',
    });
    const removed = await loop.queueTurnInput(threadId, {
      clientId: 'client-delete',
      input: 'Prompt to delete',
    });

    const editSession = await loop.retrieveQueuedTurnInput(threadId, kept.queuedInputId);
    expect(editSession).toMatchObject({
      editToken: expect.any(String),
      input: {
        id: kept.queuedInputId,
        input: 'Prompt before edit',
      },
    });
    await expect(loop.updateQueuedTurnInput(threadId, kept.queuedInputId, {
      editToken: editSession.editToken,
      input: 'Prompt after edit',
    })).resolves.toMatchObject({
      disposition: 'queued',
      queuedInputId: kept.queuedInputId,
      turnId: null,
    });
    await expect(loop.deleteQueuedTurnInput(threadId, removed.queuedInputId)).resolves.toEqual({
      deleted: true,
    });
    const pending = await threadStore.getThread(threadId);
    expect(pending?.queuedTurnInputs).toMatchObject([
      {
        id: kept.queuedInputId,
        input: 'Prompt after edit',
        updatedAt: expect.any(String),
      },
    ]);
    expect(pending?.messages.some((message) => message.clientId === 'client-delete')).toBe(false);

    modelClient.releaseFirstResponse();
    const completed = await waitForQueueDrain(threadStore, threadId, 2);

    expect(completed.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
      'Initial prompt',
      'Prompt after edit',
    ]);
    expect(modelClient.requests).toHaveLength(2);
  });

  it('keeps a retrieved item durable and paused until the edited text is committed', async () => {
    const { loop, modelClient, threadStore, threadId } = await createBlockedLoop();
    await loop.startTurn(threadId, { input: 'Initial prompt' });
    await waitForModelRequestCount(modelClient, 1);
    const queued = await loop.queueTurnInput(threadId, {
      clientId: 'client-retrieved-edit',
      input: 'Original queued text',
    });

    const editSession = await loop.retrieveQueuedTurnInput(threadId, queued.queuedInputId);
    modelClient.releaseFirstResponse();
    const paused = await waitForThreadIdle(threadStore, threadId);

    expect(paused?.queuedTurnInputs).toMatchObject([{
      id: queued.queuedInputId,
      input: 'Original queued text',
    }]);
    expect(modelClient.requests).toHaveLength(1);

    await expect(loop.updateQueuedTurnInput(threadId, queued.queuedInputId, {
      editToken: editSession.editToken,
      input: 'Edited queued text',
    })).resolves.toMatchObject({
      disposition: 'started',
      queuedInputId: queued.queuedInputId,
      turnId: expect.any(String),
    });
    const completed = await waitForQueueDrain(threadStore, threadId, 2);

    expect(completed.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
      'Initial prompt',
      'Edited queued text',
    ]);
    expect(modelClient.requests).toHaveLength(2);
  });

  it('releases editing explicitly and rejects a stale release token', async () => {
    const { loop, modelClient, threadStore, threadId } = await createBlockedLoop();
    await loop.startTurn(threadId, { input: 'Initial prompt' });
    await waitForModelRequestCount(modelClient, 1);
    const queued = await loop.queueTurnInput(threadId, {
      input: 'Queued prompt after release',
    });
    const firstSession = await loop.retrieveQueuedTurnInput(threadId, queued.queuedInputId);
    const currentSession = await loop.retrieveQueuedTurnInput(threadId, queued.queuedInputId);

    await expect(loop.releaseQueuedTurnInputEdit(threadId, queued.queuedInputId, {
      editToken: firstSession.editToken,
    })).resolves.toEqual({ released: false, resumed: null });

    modelClient.releaseFirstResponse();
    const paused = await waitForThreadIdle(threadStore, threadId);
    expect(paused?.queuedTurnInputs).toHaveLength(1);
    expect(modelClient.requests).toHaveLength(1);

    await expect(loop.releaseQueuedTurnInputEdit(threadId, queued.queuedInputId, {
      editToken: currentSession.editToken,
    })).resolves.toMatchObject({
      released: true,
      resumed: {
        disposition: 'started',
        queuedInputId: queued.queuedInputId,
      },
    });
    const completed = await waitForQueueDrain(threadStore, threadId, 2);
    expect(completed.messages.filter((message) => message.role === 'user').at(-1)).toMatchObject({
      content: 'Queued prompt after release',
    });
  });

  it('updates attachments while preserving the durable queued item', async () => {
    const { loop, modelClient, threadStore, threadId } = await createBlockedLoop();
    await loop.startTurn(threadId, { input: 'Initial prompt' });
    await waitForModelRequestCount(modelClient, 1);
    const queued = await loop.queueTurnInput(threadId, {
      input: 'Edit the attachment',
      attachments: [inlineAttachment('attachment_old', 'old.png')],
    });
    const session = await loop.retrieveQueuedTurnInput(threadId, queued.queuedInputId);

    await expect(loop.updateQueuedTurnInput(threadId, queued.queuedInputId, {
      attachments: [inlineAttachment('attachment_new', 'new.png')],
      editToken: session.editToken,
      input: 'Edited attachment',
    })).resolves.toMatchObject({
      disposition: 'queued',
      queuedInputId: queued.queuedInputId,
    });
    const pending = await threadStore.getThread(threadId);
    expect(pending?.queuedTurnInputs?.[0]).toMatchObject({
      id: queued.queuedInputId,
      input: 'Edited attachment',
      attachments: [expect.objectContaining({
        id: 'attachment_new',
        name: 'new.png',
      })],
    });

    modelClient.releaseFirstResponse();
    const completed = await waitForQueueDrain(threadStore, threadId, 2);
    expect(completed.messages.filter((message) => message.role === 'user').at(-1)).toMatchObject({
      content: 'Edited attachment',
      attachments: [expect.objectContaining({ id: 'attachment_new' })],
    });
  });

  it('restores Plan mode when a typed queued item starts', async () => {
    const { loop, modelClient, threadStore, threadId } = await createBlockedLoop();
    await loop.startTurn(threadId, { input: 'Initial prompt' });
    await waitForModelRequestCount(modelClient, 1);

    const queued = await loop.queueTurnInput(threadId, {
      input: 'Plan the refactor before editing.',
      kind: 'plan',
    });
    expect((await threadStore.getThread(threadId))?.queuedTurnInputs).toMatchObject([{
      id: queued.queuedInputId,
      kind: 'plan',
    }]);

    modelClient.releaseFirstResponse();
    await waitForQueueDrain(threadStore, threadId, 2);

    expect(modelClient.requests[1]).toMatchObject({ toolChoice: 'none' });
    expect(modelClient.requests[1]?.messages).toContainEqual(expect.objectContaining({
      id: 'desktop_plan_mode',
      role: 'developer',
    }));
    const plannedThread = await threadStore.getThread(threadId);
    expect(plannedThread?.messages.find((message) => (
      message.role === 'user'
      && message.content === 'Plan the refactor before editing.'
    ))).toMatchObject({
      inputKind: 'plan',
    });
    expect(plannedThread?.messages.at(-1)?.planMode).toEqual({
      mode: 'plan',
      status: 'awaiting_confirmation',
    });
  });

  it('turns a typed Goal item into a persistent goal and consumes it atomically', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Queued goal test' });
    const modelClient = new QueuedGoalModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      configStore: new ImageCapabilityConfigStore(true),
      ids,
      skillRegistry: stepSnapshotSkillRegistry(),
    });

    await loop.startTurn(thread.id, { input: 'Initial prompt' });
    await waitForModelRequestCount(modelClient, 1);
    const queued = await loop.queueTurnInput(thread.id, {
      attachments: [inlineAttachment('attachment_goal', 'goal.png')],
      input: 'Finish the queued goal safely.',
      kind: 'goal',
      skillIds: ['skill_step'],
      thinking: true,
      thinkingEffort: 'high',
    });
    expect((await threadStore.getThread(thread.id))?.queuedTurnInputs).toMatchObject([{
      id: queued.queuedInputId,
      kind: 'goal',
    }]);

    modelClient.releaseFirstResponse();
    const completed = await waitForTestState(
      () => threadStore.getThread(thread.id),
      (snapshot) => Boolean(
        snapshot
        && snapshot.activeTurnId === null
        && !snapshot.queuedTurnInputs?.length
        && snapshot.goal?.status === 'complete'
      ),
      (snapshot) => `Timed out waiting for queued goal; snapshot=${JSON.stringify(snapshot)}`,
    );
    const events = await threadStore.listEvents(thread.id);

    expect(completed?.goal).toMatchObject({
      objective: 'Finish the queued goal safely.',
      status: 'complete',
      execution: {
        attachments: [expect.objectContaining({ id: 'attachment_goal' })],
        sourceMessageId: expect.any(String),
        skillIds: ['skill_step'],
        thinking: true,
        thinkingEffort: 'high',
      },
    });
    const visibleGoalMessage = completed?.messages.find((message) => (
      message.role === 'user'
      && message.content === 'Finish the queued goal safely.'
    ));
    expect(visibleGoalMessage).toMatchObject({
      id: completed?.goal?.execution?.sourceMessageId,
      inputKind: 'goal',
      attachments: [expect.objectContaining({ id: 'attachment_goal' })],
    });
    expect(visibleGoalMessage?.turnId).toBeTruthy();
    expect(modelClient.requests[1]).toMatchObject({
      thinking: true,
      reasoningEffort: 'high',
    });
    expect(modelClient.requests[1]?.stepSnapshot?.messageIds).toContain('skill_skill_step');
    expect(modelClient.requests[1]?.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      content: expect.stringContaining('Finish the queued goal safely.'),
    }));
    expect(modelClient.requests[1]?.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      attachments: [expect.objectContaining({ id: 'attachment_goal' })],
    }));
    expect(modelClient.requests[1]?.messages.filter((message) => (
      message.attachments?.some((attachment) => attachment.id === 'attachment_goal')
    ))).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: 'thread.goal_updated',
      turnId: visibleGoalMessage?.turnId,
      payload: expect.objectContaining({
        queuedInputId: queued.queuedInputId,
        sourceMessage: expect.objectContaining({
          id: visibleGoalMessage?.id,
          inputKind: 'goal',
        }),
      }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'turn.started',
      payload: expect.objectContaining({ taskKind: 'goal' }),
    }));
  });

  it('rejects invalid or duplicate Goal items before writing a queue event', async () => {
    const { loop, modelClient, threadStore, threadId } = await createBlockedLoop();
    await loop.startTurn(threadId, { input: 'Keep validation test active.' });
    await waitForModelRequestCount(modelClient, 1);

    await expect(loop.queueTurnInput(threadId, {
      input: 'x'.repeat(4_001),
      kind: 'goal',
    })).rejects.toThrow('goal objective must be at most 4000 characters');
    expect((await threadStore.getThread(threadId))?.queuedTurnInputs ?? []).toEqual([]);

    const queued = await loop.queueTurnInput(threadId, {
      input: 'The only queued goal.',
      kind: 'goal',
    });
    await expect(loop.queueTurnInput(threadId, {
      input: 'A duplicate queued goal.',
      kind: 'goal',
    })).rejects.toThrow('A queued goal already exists');
    await expect(loop.setThreadGoal(threadId, {
      objective: 'A direct Goal that would conflict with the queue.',
      status: 'active',
    })).rejects.toThrow('A queued goal already exists');
    expect((await threadStore.getThread(threadId))?.queuedTurnInputs).toMatchObject([{
      id: queued.queuedInputId,
      kind: 'goal',
    }]);

    await loop.deleteQueuedTurnInput(threadId, queued.queuedInputId);
    modelClient.releaseFirstResponse();
    await waitForThreadIdle(threadStore, threadId);
  });

  it('rejects another Goal before persistence while an unfinished Goal exists', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Existing goal validation' });
    const modelClient = new QueuedGoalModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.setThreadGoal(thread.id, {
      objective: 'Finish the existing goal first.',
      status: 'active',
    });
    await waitForModelRequestCount(modelClient, 1);

    await expect(loop.queueTurnInput(thread.id, {
      input: 'Do not persist this competing goal.',
      kind: 'goal',
    })).rejects.toThrow('An unfinished goal already exists');
    expect((await threadStore.getThread(thread.id))?.queuedTurnInputs ?? []).toEqual([]);

    modelClient.releaseFirstResponse();
    await waitForTestState(
      () => threadStore.getThread(thread.id),
      (snapshot) => snapshot?.goal?.status === 'complete' && snapshot.activeTurnId === null,
      (snapshot) => `Timed out waiting for existing goal completion; snapshot=${JSON.stringify(snapshot)}`,
    );
  });

  it('keeps an active Goal idle while a queued Plan awaits confirmation', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Goal waits for plan confirmation' });
    const modelClient = new GoalWithQueuedPlanModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.setThreadGoal(thread.id, {
      objective: 'Finish only after the plan is confirmed.',
      status: 'active',
    });
    await waitForModelRequestCount(modelClient, 1);
    await loop.queueTurnInput(thread.id, {
      input: 'Plan the remaining Goal work.',
      kind: 'plan',
    });
    modelClient.releaseFirstGoalResponse();

    const awaiting = await waitForTestState(
      () => threadStore.getThread(thread.id),
      (snapshot) => Boolean(
        snapshot
        && snapshot.activeTurnId === null
        && snapshot.goal?.status === 'active'
        && snapshot.messages.some((message) =>
          message.planMode?.status === 'awaiting_confirmation'
        )
      ),
      (snapshot) => `Timed out waiting for queued Plan confirmation; snapshot=${JSON.stringify(snapshot)}`,
    );
    expect(awaiting?.queuedTurnInputs).toEqual([]);
    expect(modelClient.requests).toHaveLength(2);

    await loop.startTurn(thread.id, { input: '', planDecision: 'accepted' });
    const completed = await waitForTestState(
      () => threadStore.getThread(thread.id),
      (snapshot) => snapshot?.goal?.status === 'complete' && snapshot.activeTurnId === null,
      (snapshot) => `Timed out waiting for Goal after plan acceptance; snapshot=${JSON.stringify(snapshot)}`,
    );

    expect(completed?.messages.find((message) => message.planMode)).toMatchObject({
      planMode: { mode: 'plan', status: 'accepted' },
    });
    expect(modelClient.requests).toHaveLength(5);
    expect(modelClient.requests[2]?.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      content: '请按照上述已确认的计划开始执行。',
    }));
  });

  it('returns queued success when an edit claim prevents immediate scheduling', async () => {
    const { loop, modelClient, threadStore, threadId } = await createBlockedLoop();
    await loop.startTurn(threadId, { input: 'Initial prompt' });
    await waitForModelRequestCount(modelClient, 1);
    const first = await loop.queueTurnInput(threadId, {
      input: 'Keep this item under edit.',
    });
    const editSession = await loop.retrieveQueuedTurnInput(threadId, first.queuedInputId);
    modelClient.releaseFirstResponse();
    await waitForThreadIdle(threadStore, threadId);

    const persisted = await loop.startTurn(threadId, {
      clientId: 'client-persisted-once',
      input: 'Persist this exactly once.',
    });
    expect(persisted).toMatchObject({
      accepted: true,
      disposition: 'queued',
      queuedInputId: expect.any(String),
      turnId: null,
    });
    expect((await threadStore.getThread(threadId))?.queuedTurnInputs?.map((item) => item.input)).toEqual([
      'Keep this item under edit.',
      'Persist this exactly once.',
    ]);

    await loop.releaseQueuedTurnInputEdit(threadId, first.queuedInputId, {
      editToken: editSession.editToken,
    });
    const completed = await waitForQueueDrain(threadStore, threadId, 3);
    expect(completed.messages.filter((message) => message.clientId === 'client-persisted-once')).toHaveLength(1);
  });

  it('pauses after an error and resumes old items before newly submitted input', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Paused queue after error' });
    const modelClient = new FailingFirstModelClient();
    const loop = new AgentLoop({
      threadStore,
      modelClient,
      eventBus: new InMemoryEventBus(),
      clock: systemClock,
      ids,
    });

    await loop.startTurn(thread.id, { input: 'Fail this prompt' });
    await waitForModelRequestCount(modelClient, 1);
    const queued = await loop.queueTurnInput(thread.id, {
      clientId: 'client-retry-after-error',
      input: 'Send only after manual resume',
    });
    modelClient.releaseFailure();

    const paused = await waitForTestState(
      async () => ({
        events: await threadStore.listEvents(thread.id),
        thread: await threadStore.getThread(thread.id),
      }),
      ({ events, thread: snapshot }) => (
        snapshot?.activeTurnId === null
        && events.some((event) => event.type === 'runtime.error')
      ),
      (state) => (
        `Timed out waiting for failed turn; active=${state?.thread?.activeTurnId ?? 'unknown'}, `
        + `events=${JSON.stringify(state?.events.map((event) => event.type) ?? [])}`
      ),
    );
    expect(paused.thread?.queuedTurnInputs?.map((item) => item.id)).toEqual([queued.queuedInputId]);
    expect(modelClient.requests).toHaveLength(1);

    await expect(loop.startTurn(thread.id, {
      clientId: 'client-new-after-error',
      input: 'New input submitted while the queue is paused',
    })).resolves.toMatchObject({
      accepted: true,
      disposition: 'queued',
      queuedInputId: expect.any(String),
      turnId: null,
    });
    const completed = await waitForQueueDrain(threadStore, thread.id, 3);

    expect(modelClient.requests).toHaveLength(3);
    expect(completed.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
      'Fail this prompt',
      'Send only after manual resume',
      'New input submitted while the queue is paused',
    ]);
    expect(completed.messages.find((message) => message.clientId === 'client-retry-after-error')).toMatchObject({
      content: 'Send only after manual resume',
      role: 'user',
    });
  });
});

async function createBlockedLoop() {
  const ids = new RandomIdGenerator();
  const threadStore = new JsonThreadStore(await mkDataDir(), systemClock, ids);
  const thread = await threadStore.createThread({ title: 'Queued input test' });
  const modelClient = new SteerableModelClient();
  const loop = new AgentLoop({
    threadStore,
    modelClient,
    eventBus: new InMemoryEventBus(),
    clock: systemClock,
    ids,
    skillRegistry: stepSnapshotSkillRegistry(),
  });
  return { loop, modelClient, threadId: thread.id, threadStore };
}

function waitForThreadIdle(
  threadStore: JsonThreadStore,
  threadId: string,
) {
  return waitForTestState(
    () => threadStore.getThread(threadId),
    (thread) => thread?.activeTurnId === null,
    (thread) => `Timed out waiting for idle thread; active=${thread?.activeTurnId ?? 'unknown'}`,
  );
}

function inlineAttachment(id: string, name: string) {
  return {
    id,
    name,
    type: 'image/png',
    size: 1,
    url: 'data:image/png;base64,AA==',
  };
}

async function waitForQueueDrain(
  threadStore: JsonThreadStore,
  threadId: string,
  expectedUserMessages: number,
) {
  const thread = await waitForTestState(
    () => threadStore.getThread(threadId),
    (thread) => Boolean(
      thread
      && thread.activeTurnId === null
      && !thread.queuedTurnInputs?.length
      && thread.messages.filter((message) => message.role === 'user').length === expectedUserMessages
    ),
    (thread) => (
      `Timed out waiting for queued turns; active=${thread?.activeTurnId ?? 'unknown'}, `
      + `queued=${thread?.queuedTurnInputs?.length ?? 0}, `
      + `userMessages=${thread?.messages.filter((message) => message.role === 'user').length ?? 0}`
    ),
  );
  if (!thread) throw new Error(`Thread disappeared while draining queued input: ${threadId}`);
  return thread;
}

class FailingFirstModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private releaseFirstFailure: () => void = () => undefined;
  private readonly firstFailureReleased = new Promise<void>((resolve) => {
    this.releaseFirstFailure = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      await this.firstFailureReleased;
      throw new Error('Expected queued-turn test failure.');
    }
    yield { type: 'text_delta', text: 'Recovered.' };
    yield { type: 'done', finishReason: 'stop' };
  }

  releaseFailure(): void {
    this.releaseFirstFailure();
  }
}

class QueuedGoalModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private releaseFirst: () => void = () => undefined;
  private readonly firstResponseReleased = new Promise<void>((resolve) => {
    this.releaseFirst = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'text_delta', text: 'Initial response.' };
      await this.firstResponseReleased;
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 2) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'queued_goal_complete',
          name: 'update_goal',
          arguments: '{"status":"complete"}',
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Queued goal completed.' };
    yield { type: 'done', finishReason: 'stop' };
  }

  releaseFirstResponse(): void {
    this.releaseFirst();
  }
}

class GoalWithQueuedPlanModelClient implements ModelClient {
  requests: ModelRequest[] = [];
  private releaseFirstGoal: () => void = () => undefined;
  private readonly firstGoalReleased = new Promise<void>((resolve) => {
    this.releaseFirstGoal = resolve;
  });

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { type: 'text_delta', text: 'Initial Goal work.' };
      await this.firstGoalReleased;
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 2) {
      yield { type: 'text_delta', text: '1. Inspect the remaining work.\n2. Finish the Goal.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 3) {
      yield { type: 'text_delta', text: 'Confirmed plan execution finished.' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    if (this.requests.length === 4) {
      yield {
        type: 'tool_calls',
        toolCalls: [{
          id: 'goal_after_plan_complete',
          name: 'update_goal',
          arguments: '{"status":"complete"}',
        }],
      };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }
    yield { type: 'text_delta', text: 'Goal completed after plan confirmation.' };
    yield { type: 'done', finishReason: 'stop' };
  }

  releaseFirstGoalResponse(): void {
    this.releaseFirstGoal();
  }
}
