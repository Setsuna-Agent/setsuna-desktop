import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  createChatDisplayItems,
  reconcileChatDisplayItems,
} from '../../../../../src/features/chat/conversation/chatMessageDisplay.js';

describe('reconcileChatDisplayItems', () => {
  it('retains completed row identities while only the active assistant message changes', () => {
    const user: RuntimeMessage = {
      id: 'user_1',
      turnId: 'turn_1',
      role: 'user',
      content: 'Question',
      createdAt: '2026-07-16T00:00:00.000Z',
      status: 'complete',
    };
    const completed: RuntimeMessage = {
      id: 'assistant_1',
      turnId: 'turn_1',
      role: 'assistant',
      content: 'Answer',
      createdAt: '2026-07-16T00:00:01.000Z',
      status: 'complete',
    };
    const active: RuntimeMessage = {
      id: 'assistant_2',
      turnId: 'turn_2',
      role: 'assistant',
      content: 'Stream',
      createdAt: '2026-07-16T00:00:02.000Z',
      status: 'streaming',
    };
    const previous = createChatDisplayItems([user, completed, active]);
    const next = createChatDisplayItems([
      user,
      completed,
      { ...active, content: 'Streaming' },
    ]);
    const reconciled = reconcileChatDisplayItems(previous, next);

    expect(reconciled[0]).toBe(previous[0]);
    expect(reconciled[1]).toBe(previous[1]);
    expect(reconciled[2]).not.toBe(previous[2]);
  });
});
