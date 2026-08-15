import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { createChatDisplayItems } from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

describe('chat message guidance display', () => {
  it('attaches guidance accepted before the first assistant segment to that run', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_initial',
        role: 'user',
        turnId: 'turn_1',
        content: 'initial prompt',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'user_steer',
        role: 'user',
        turnId: 'turn_1',
        content: 'extra guidance',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_followup',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'handled guidance',
        phase: 'final_answer',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
    ];

    const items = createChatDisplayItems(messages);

    expect(items.find((item) => item.id === 'user_initial')).toMatchObject({
      type: 'user',
      guidanceProcessed: true,
      handledSteerMessageIds: ['user_steer'],
    });
    expect(items.find((item) => item.type === 'assistant')).toMatchObject({
      type: 'assistant',
      handledSteerMessageIds: ['user_steer'],
      messageIds: ['user_steer', 'assistant_followup'],
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
  });

  it('marks a late unhandled steer as owned when the existing assistant timeline renders it', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_initial',
        role: 'user',
        turnId: 'turn_1',
        content: 'initial prompt',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_before_steer',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'response before late steer',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'user_steer',
        role: 'user',
        turnId: 'turn_1',
        content: 'late guidance',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
    ];

    const items = createChatDisplayItems(messages);

    expect(items.find((item) => item.id === 'user_initial')).toMatchObject({
      type: 'user',
      guidanceProcessed: false,
      assistantTimelineSteerMessageIds: ['user_steer'],
    });
    expect(items.find((item) => item.type === 'assistant')).toMatchObject({
      type: 'assistant',
      handledSteerMessageIds: [],
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
  });
});
