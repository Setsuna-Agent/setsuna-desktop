import type { RuntimeThreadGoal } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { goalToolDefinitions } from '../../../src/loop/lifecycle/runtime-goal-tools.js';

describe('runtime Goal tools', () => {
  it('always exposes explicit creation without a Token budget input', () => {
    const tools = goalToolDefinitions(null);

    expect(tools.map((tool) => tool.name)).toEqual(['create_goal']);
    expect(tools[0]?.inputSchema.properties).not.toHaveProperty('token_budget');
  });

  it('exposes read and completion only while the Goal is active', () => {
    expect(goalToolDefinitions(goal('active')).map((tool) => tool.name)).toEqual([
      'create_goal',
      'get_goal',
      'update_goal',
    ]);
    expect(goalToolDefinitions(goal('paused')).map((tool) => tool.name)).toEqual(['create_goal']);
    expect(goalToolDefinitions(goal('complete')).map((tool) => tool.name)).toEqual(['create_goal']);
  });
});

function goal(status: RuntimeThreadGoal['status']): RuntimeThreadGoal {
  return {
    version: 1,
    id: 'goal_1',
    threadId: 'thread_1',
    objective: 'Verify tool exposure',
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}
