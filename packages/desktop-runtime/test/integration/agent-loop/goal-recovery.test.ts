import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { AgentLoop } from '../../../src/loop/core/agent-loop.js';
import { systemClock } from '../../../src/ports/clock.js';
import { CancellableModelClient, mkDataDir } from '../../support/agent-loop/shared.js';
import { createTestThreadStore } from '../../support/thread-store.js';

describe('agent loop Goal recovery', () => {
  it('accounts only the current Goal turn across a newer control snapshot', async () => {
    const ids = new RandomIdGenerator();
    const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
    const thread = await threadStore.createThread({ title: 'Restored goal' });
    const modelClient = new CancellableModelClient();
    const replacedTurnId = 'turn_replaced_goal';
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      type: 'thread.goal_updated',
      createdAt: systemClock.now().toISOString(),
      payload: {
        goal: {
          version: 1,
          id: 'goal_replaced',
          threadId: thread.id,
          objective: 'Do not charge this work to the replacement',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    });
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      turnId: replacedTurnId,
      type: 'turn.started',
      createdAt: '2026-08-10T00:00:00.000Z',
      payload: { input: 'Continue the replaced goal.', taskKind: 'goal' },
    });
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      turnId: replacedTurnId,
      type: 'token.count',
      createdAt: '2026-08-10T00:00:01.000Z',
      payload: { usage: { inputTokens: 50, outputTokens: 49, totalTokens: 99 } },
    });
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
          accountedThroughSeq: 0,
          createdAt: 1,
          updatedAt: 2,
        },
      },
    });
    // The replaced turn can finish after the current Goal is installed.
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      turnId: replacedTurnId,
      type: 'turn.cancelled',
      createdAt: '2026-08-10T00:00:02.000Z',
      payload: { reason: 'Replaced by a newer Goal.', taskKind: 'goal' },
    });
    const currentTurnId = 'turn_restored_goal';
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      turnId: currentTurnId,
      type: 'turn.started',
      createdAt: '2026-08-10T00:00:00.000Z',
      payload: { input: 'Continue the active goal.', taskKind: 'goal' },
    });
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      turnId: currentTurnId,
      type: 'token.count',
      createdAt: '2026-08-10T00:00:01.000Z',
      payload: { usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
    });
    await threadStore.appendEvent(thread.id, {
      id: ids.id('event'),
      threadId: thread.id,
      turnId: currentTurnId,
      type: 'turn.cancelled',
      createdAt: '2026-08-10T00:00:02.000Z',
      payload: { reason: 'Turn cancelled because the desktop runtime restarted.', taskKind: 'goal' },
    });
    // An edit/control write can follow the terminal event while turn cleanup is still running.
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
          accountedThroughSeq: 0,
          createdAt: 1,
          updatedAt: 3,
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
});
