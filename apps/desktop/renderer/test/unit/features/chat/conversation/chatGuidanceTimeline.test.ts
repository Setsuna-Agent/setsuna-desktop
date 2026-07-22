import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  interleaveGuidanceByMessageOrder,
} from '../../../../../src/features/chat/conversation/chatGuidanceTimeline.js';

describe('interleaveGuidanceByMessageOrder', () => {
  it('inserts steer messages before the next work item in message order', () => {
    const guidance = message('user_steer', 'extra guidance');
    const result = interleaveGuidanceByMessageOrder({
      getItemMessageId: (item) => item.messageId,
      guidanceMessages: [guidance],
      items: [
        { id: 'before', messageId: 'assistant_before' },
        { id: 'after', messageId: 'assistant_after' },
      ],
      messageOrderIds: ['assistant_before', 'user_steer', 'assistant_after'],
    });

    expect(result.entries.map((entry) => entry.type === 'item' ? entry.item.id : entry.messages.map((item) => item.id).join(','))).toEqual([
      'before',
      'user_steer',
      'after',
    ]);
    expect([...result.consumedGuidanceIds]).toEqual(['user_steer']);
  });

  it('leaves guidance after all work items for the caller to render after the block', () => {
    const guidance = message('user_steer', 'extra guidance');
    const result = interleaveGuidanceByMessageOrder({
      getItemMessageId: (item) => item.messageId,
      guidanceMessages: [guidance],
      items: [{ id: 'before', messageId: 'assistant_before' }],
      messageOrderIds: ['assistant_before', 'user_steer'],
    });

    expect(result.entries.map((entry) => entry.type === 'item' ? entry.item.id : 'guidance')).toEqual(['before']);
    expect([...result.consumedGuidanceIds]).toEqual([]);
  });
});

function message(id: string, content: string): RuntimeMessage {
  return {
    id,
    role: 'user',
    content,
    createdAt: '2026-06-26T00:00:00.000Z',
    status: 'complete',
  };
}
