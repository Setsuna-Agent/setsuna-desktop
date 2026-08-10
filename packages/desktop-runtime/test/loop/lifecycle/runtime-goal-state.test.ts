import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { nextGoalSafety } from '../../../src/loop/lifecycle/runtime-goal-state.js';

describe('runtime Goal safety state', () => {
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
});

function progressEvent(turnId: string): RuntimeEvent {
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
      content: 'README contents',
      argumentsPreview: '{"path":"README.md"}',
      resultPreview: 'README contents',
    },
  };
}
