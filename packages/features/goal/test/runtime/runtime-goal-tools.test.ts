import { describe, expect, it } from 'vitest';
import type { Goal } from '../../src/contracts/index.js';
import { goalToolDefinitions, goalToolResult } from '../../src/runtime/runtime-goal-tools.js';

describe('runtime Goal tools', () => {
  it('localizes result previews without changing the structured goal state', () => {
    const active = { goal: goal('active') };
    for (const [name, data, expected] of [
      ['get_goal', { goal: null }, '尚未设置目标。'],
      ['get_goal', active, '目标状态：进行中。'],
      ['create_goal', active, '目标已创建。'],
      ['update_goal', { ...active, completionPending: true }, '本轮成功结束后，目标将被标记为完成。'],
    ] as const) {
      const chinese = goalToolResult(name, data, 'zh-CN');
      const english = goalToolResult(name, data, 'en-US');
      expect(chinese.preview).toBe(expected);
      expect(english.preview).toMatch(/\bgoal\b/iu);
      expect(chinese.content).toBe(english.content);
      expect(chinese.data).toEqual(data);
    }
  });

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

  it('withholds Goal mutations while the current turn is finalizing completion', () => {
    expect(goalToolDefinitions(goal('active'), true)).toEqual([]);
  });
});

function goal(status: Goal['status']): Goal {
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
