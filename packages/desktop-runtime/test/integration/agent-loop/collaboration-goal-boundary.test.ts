import { expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { systemClock } from '../../../src/ports/clock.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { createGoalEnabledAgentLoop } from '../../support/agent-loop/goal-feature.js';
import { RegularTurnCreatesPersistentGoalModelClient } from '../../support/agent-loop/goals.js';
import { mkDataDir } from '../../support/agent-loop/shared.js';

it('rejects a child Goal tool call so completing a delegated task cannot start autonomous continuation', async () => {
  const ids = new RandomIdGenerator();
  const threadStore = createTestThreadStore(await mkDataDir(), systemClock, ids);
  const parent = await threadStore.createThread({ title: 'Parent' });
  const child = await threadStore.createThread({ title: 'Delegated work', parentThreadId: parent.id });
  // This client calls create_goal even when it was not advertised, then would continue on success.
  const modelClient = new RegularTurnCreatesPersistentGoalModelClient();
  const loop = createGoalEnabledAgentLoop({ threadStore, modelClient, ids, clock: systemClock, eventBus: new InMemoryEventBus() });
  try {
    await loop.sendTurn(child.id, { input: 'Complete the delegated work.' });
    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[0]!.tools?.some((tool) => tool.name === 'create_goal') ?? false).toBe(false);
    expect(modelClient.requests[1]!.messages).toContainEqual(expect.objectContaining({
      role: 'tool', toolCallId: 'goal_create_regular', content: expect.stringContaining('only available in main conversations'),
    }));
    expect(await loop.getThreadGoal(child.id)).toBeNull();
    expect((await threadStore.getThread(child.id))?.turns).toEqual([
      expect.objectContaining({ taskKind: 'subagent', status: 'completed' }),
    ]);
  } finally {
    await loop.shutdown();
    await threadStore.close();
  }
});
