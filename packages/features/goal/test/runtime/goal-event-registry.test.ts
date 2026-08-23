import { createFeatureEvent, FeatureEventDecodeError } from '@setsuna-desktop/feature-core/events';
import { describe, expect, it } from 'vitest';
import {
  createInitialGoalState,
  goalStateReplacedEvent,
  type Goal,
} from '../../src/contracts/index.js';
import { createRuntimeGoalEventRegistry } from '../../src/runtime/goal-event-registry.js';

describe('Goal Feature event registry', () => {
  it('projects current envelopes and read-only legacy records to the same state', () => {
    const registry = createRuntimeGoalEventRegistry();
    const expected = goal({ objective: 'Migrate the Goal event source' });
    const current = registry.reduce(createInitialGoalState(), {
      ...createFeatureEvent(
        goalStateReplacedEvent,
        metadata('current'),
        { goal: expected },
      ),
      seq: 1,
    });
    const legacy = registry.reduce(createInitialGoalState(), {
      ...metadata('legacy'),
      seq: 1,
      type: 'thread.goal_updated',
      payload: { goal: expected, preserveExecution: false },
    });

    expect(current).toEqual(legacy);
    expect(current.goal).toEqual(expected);
  });

  it('treats a legacy unsuccessful clear as a no-op', () => {
    const registry = createRuntimeGoalEventRegistry();
    const state = { goal: goal() };

    expect(registry.reduce(state, {
      ...metadata('legacy-clear'),
      seq: 2,
      type: 'thread.goal_cleared',
      payload: { cleared: false },
    })).toBe(state);
  });

  it('fails closed with event identity metadata for unknown versions', () => {
    const registry = createRuntimeGoalEventRegistry();
    const event = {
      ...createFeatureEvent(goalStateReplacedEvent, metadata('future'), { goal: goal() }),
      seq: 7,
      schemaVersion: 99,
    };

    expect(() => registry.reduce(createInitialGoalState(), event)).toThrowError(
      expect.objectContaining<Partial<FeatureEventDecodeError>>({
        eventType: 'goal.state-replaced',
        schemaVersion: 99,
        seq: 7,
      }),
    );
  });
});

function metadata(id: string) {
  return {
    id: `event_${id}`,
    threadId: 'thread_1',
    createdAt: '2026-08-22T00:00:00.000Z',
  };
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    version: 1,
    id: 'goal_1',
    threadId: 'thread_1',
    objective: 'Finish the Goal Feature migration',
    status: 'active',
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    safety: {
      automaticTurns: 0,
      consecutiveNoProgressTurns: 0,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
