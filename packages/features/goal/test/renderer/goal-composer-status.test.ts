import { describe, expect, it } from 'vitest';
import { goalActiveTurnStartedAt } from '../../src/renderer/GoalComposerStatusView.js';

describe('Goal composer status', () => {
  it('counts only active turns owned by the Goal Feature', () => {
    expect(goalActiveTurnStartedAt({
      startedAt: '2026-08-23T00:00:00.000Z',
      taskKind: 'goal',
    })).toBe('2026-08-23T00:00:00.000Z');
    expect(goalActiveTurnStartedAt({
      startedAt: '2026-08-23T00:00:00.000Z',
      taskKind: 'regular',
    })).toBeUndefined();
    expect(goalActiveTurnStartedAt({
      startedAt: '2026-08-23T00:00:00.000Z',
      taskKind: 'review',
    })).toBeUndefined();
  });
});
