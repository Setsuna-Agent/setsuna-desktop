import type { RuntimeEvent, RuntimeThreadGoal } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { nextGoalSafety, nextGoalState } from '../../../src/loop/lifecycle/runtime-goal-state.js';

describe('runtime Goal state', () => {
  it('preserves the last progress fingerprint across an empty turn', () => {
    const evidence = progressEvent('turn_1');

    const first = nextGoalSafety(undefined, [evidence]);
    const empty = nextGoalSafety(first, []);
    const repeated = nextGoalSafety(empty, [progressEvent('turn_3')]);

    expect(first).toMatchObject({ automaticTurns: 1, consecutiveNoProgressTurns: 0 });
    expect(empty).toMatchObject({
      automaticTurns: 2,
      consecutiveNoProgressTurns: 1,
      lastProgressFingerprint: first.lastProgressFingerprint,
    });
    expect(repeated).toMatchObject({
      automaticTurns: 3,
      consecutiveNoProgressTurns: 2,
      lastProgressFingerprint: first.lastProgressFingerprint,
    });
  });

  it('counts a short alternating evidence cycle as repeated work', () => {
    const states = [
      progressEvent('turn_1', 'A'),
      progressEvent('turn_2', 'B'),
      progressEvent('turn_3', 'A'),
      progressEvent('turn_4', 'B'),
      progressEvent('turn_5', 'A'),
    ].reduce<NonNullable<RuntimeThreadGoal['safety']>[]>((history, event) => {
      history.push(nextGoalSafety(history.at(-1), [event]));
      return history;
    }, []);

    expect(states.map((state) => state.consecutiveNoProgressTurns)).toEqual([0, 0, 1, 2, 3]);
    expect(states.at(-1)?.recentProgressFingerprints).toHaveLength(2);
  });

  it('starts fresh work when a completed Goal becomes active again', () => {
    const previous: RuntimeThreadGoal = {
      version: 1,
      id: 'goal_complete',
      threadId: 'thread_1',
      objective: 'Completed objective',
      status: 'complete',
      tokenBudget: 1_000,
      tokensUsed: 91,
      timeUsedSeconds: 73,
      createdAt: 1,
      updatedAt: 2,
      execution: { skillIds: ['skill_old'], thinking: true },
    };

    const next = nextGoalState(
      'thread_1',
      previous,
      { objective: 'New objective', status: 'active' },
      new Date('2026-08-10T00:00:00.000Z'),
      { id: () => 'goal_new' },
      false,
    );

    expect(next).toMatchObject({
      id: 'goal_new',
      objective: 'New objective',
      status: 'active',
      tokenBudget: null,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1_786_320_000,
    });
    expect(next.execution).toBeUndefined();
  });
});

function progressEvent(turnId: string, evidence = 'README'): RuntimeEvent {
  return {
    id: `event_${turnId}`,
    seq: 1,
    threadId: 'thread_1',
    turnId,
    type: 'tool.completed',
    createdAt: '2026-08-10T00:00:00.000Z',
    payload: {
      toolCallId: `tool_call_${turnId}`,
      toolName: 'workspace_read_file',
      status: 'success',
      content: `${evidence} contents`,
      argumentsPreview: `{"path":"${evidence}.md"}`,
      resultPreview: `${evidence} contents`,
    },
  };
}
