import { describe, expect, it } from 'vitest';
import type { RuntimeThread, RuntimeThreadGoal } from '@setsuna-desktop/contracts';
import { mergeGoalThreadSnapshot } from './useChatTurnActions.js';

describe('mergeGoalThreadSnapshot', () => {
  it('uses the runtime goal snapshot so the active turn keeps the stop action available', () => {
    const current = thread({ lastSeq: 2, activeTurnId: null });
    const snapshot = thread({ lastSeq: 4, activeTurnId: 'turn_goal_1' });

    expect(mergeGoalThreadSnapshot(current, snapshot, goal)).toMatchObject({
      activeTurnId: 'turn_goal_1',
      lastSeq: 4,
      goal,
    });
  });

  it('preserves newer SSE state while merging the runtime active goal turn', () => {
    const current = thread({ lastSeq: 6, activeTurnId: null, messages: [{
      id: 'message_newer',
      turnId: 'turn_goal_1',
      role: 'assistant',
      content: 'Newer streamed content',
      createdAt: '2026-07-11T00:00:01.000Z',
      status: 'streaming',
    }] });
    const snapshot = thread({ lastSeq: 4, activeTurnId: 'turn_goal_1' });

    const merged = mergeGoalThreadSnapshot(current, snapshot, goal);
    expect(merged.activeTurnId).toBe('turn_goal_1');
    expect(merged.lastSeq).toBe(6);
    expect(merged.messages).toEqual(current.messages);
  });
});

const goal: RuntimeThreadGoal = {
  threadId: 'thread_1',
  objective: 'Finish the goal',
  status: 'active',
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: 1,
  updatedAt: 1,
};

function thread(overrides: Partial<RuntimeThread>): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq: 0,
    ...overrides,
  };
}
