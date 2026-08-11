import type {
  RuntimeGoalLifecycleKind,
  RuntimeMessage,
  RuntimeThreadGoalStatus,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  assistantRunCopyText,
  createChatDisplayItems,
} from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

describe('Goal exit transcript summary', () => {
  it('hides lifecycle tombstones and attaches terminal usage to the assistant run', () => {
    const firstReply = assistantMessage('assistant_1', 'First part.');
    const finalReply = assistantMessage('assistant_2', 'Finished.');
    const complete = goalNotice('complete', 'complete', 42, 7);

    const items = createChatDisplayItems([
      goalNotice('active', 'active'),
      firstReply,
      goalNotice('paused', 'paused'),
      goalNotice('resumed', 'active'),
      goalNotice('cleared', 'paused'),
      finalReply,
      complete,
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({
      type: 'assistant',
      goalExit: complete.goalMode,
      messageIds: ['assistant_1', 'assistant_2', complete.id],
    }));
  });

  it('appends final Goal usage to the assistant text', () => {
    const items = createChatDisplayItems([
      assistantMessage('assistant_1', 'Finished.'),
      goalNotice('complete', 'complete', 72_852, 71),
    ]);
    const assistant = items[0];

    expect(assistant?.type).toBe('assistant');
    if (assistant?.type !== 'assistant') throw new Error('Expected an assistant transcript item.');
    expect(assistantRunCopyText(assistant)).toBe(
      'Finished.\n\n目标已完成 · 用时 1m 11s · 72,852 Token',
    );
  });
});

function assistantMessage(id: string, content: string): RuntimeMessage {
  return {
    id,
    turnId: 'turn_goal',
    role: 'assistant',
    content,
    createdAt: '2026-08-10T00:00:01.000Z',
    status: 'complete',
  };
}

function goalNotice(
  kind: RuntimeGoalLifecycleKind,
  status: RuntimeThreadGoalStatus,
  tokensUsed = 0,
  timeUsedSeconds = 0,
): RuntimeMessage {
  return {
    id: `goal_${kind}`,
    turnId: 'turn_goal',
    role: 'developer',
    promptSource: 'goal',
    visibility: 'transcript',
    content: `Goal ${kind}`,
    createdAt: '2026-08-10T00:00:00.000Z',
    status: 'complete',
    goalMode: {
      kind,
      goal: {
        version: 1,
        id: 'goal_1',
        threadId: 'thread_1',
        objective: 'Finish the objective',
        status,
        tokenBudget: null,
        tokensUsed,
        timeUsedSeconds,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  };
}
