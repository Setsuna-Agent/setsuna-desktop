import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { createChatDisplayItems } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

describe('Goal lifecycle transcript', () => {
  it('keeps persisted Goal lifecycle notices in transcript order', () => {
    const lifecycle: RuntimeMessage = {
      id: 'goal_started',
      turnId: 'turn_goal',
      role: 'developer',
      promptSource: 'goal',
      visibility: 'transcript',
      content: 'Goal started',
      createdAt: '2026-08-10T00:00:00.000Z',
      status: 'complete',
      goalMode: {
        kind: 'active',
        goal: {
          version: 1,
          id: 'goal_1',
          threadId: 'thread_1',
          objective: 'Finish the durable objective',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    };

    expect(createChatDisplayItems([lifecycle, {
      id: 'assistant_1',
      turnId: 'turn_goal',
      role: 'assistant',
      content: 'Working on it.',
      createdAt: '2026-08-10T00:00:01.000Z',
      status: 'complete',
    }])).toEqual([
      { type: 'goal', id: 'goal_started', message: lifecycle },
      expect.objectContaining({ type: 'assistant', messageIds: ['assistant_1'] }),
    ]);
  });
});
