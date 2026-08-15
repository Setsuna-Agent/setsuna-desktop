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

  it('transfers guidance to the assistant run after an intervening context boundary', () => {
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
        id: 'assistant_before',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'work before guidance',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'user_steer',
        role: 'user',
        turnId: 'turn_1',
        content: 'extra guidance',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
      {
        id: 'compact_1',
        role: 'user',
        turnId: 'turn_1',
        content: '<context_compaction_summary>summary</context_compaction_summary>',
        createdAt: '2026-06-26T00:00:03.000Z',
        status: 'complete',
        contextCompaction: {
          compactedMessageCount: 1,
          compactedTokens: 12,
          keptRecentMessageCount: 3,
          maxContextTokensK: 128,
          originalMessageCount: 4,
          originalTokens: 24,
          transcriptAfterMessageId: 'user_steer',
        },
      },
      {
        id: 'assistant_after',
        role: 'assistant',
        turnId: 'turn_1',
        content: 'handled guidance',
        phase: 'final_answer',
        createdAt: '2026-06-26T00:00:04.000Z',
        status: 'complete',
      },
    ];

    const items = createChatDisplayItems(messages);
    const assistantItems = items.filter((item) => item.type === 'assistant');

    expect(assistantItems).toHaveLength(2);
    expect(assistantItems[0]).toMatchObject({
      id: 'assistant_before',
      messageIds: ['assistant_before'],
      steerMessages: [],
    });
    expect(assistantItems[1]).toMatchObject({
      id: 'assistant_after',
      handledSteerMessageIds: ['user_steer'],
      messageIds: ['user_steer', 'assistant_after'],
      steerMessages: [expect.objectContaining({ id: 'user_steer' })],
    });
    expect(assistantItems.flatMap((item) => item.steerMessages)).toHaveLength(1);
  });

  it('does not assign current guidance to a legacy assistant run without a turn id', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'legacy_user',
        role: 'user',
        content: 'legacy prompt',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'legacy_assistant',
        role: 'assistant',
        content: 'legacy answer',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'context_boundary',
        role: 'user',
        content: '<context_compaction_summary>summary</context_compaction_summary>',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
        contextCompaction: {
          compactedMessageCount: 1,
          compactedTokens: 12,
          keptRecentMessageCount: 2,
          maxContextTokensK: 128,
          originalMessageCount: 2,
          originalTokens: 24,
        },
      },
      {
        id: 'current_user',
        role: 'user',
        turnId: 'turn_current',
        content: 'current prompt',
        createdAt: '2026-06-26T00:00:03.000Z',
        status: 'complete',
      },
      {
        id: 'current_steer',
        role: 'user',
        turnId: 'turn_current',
        content: 'current guidance',
        createdAt: '2026-06-26T00:00:04.000Z',
        status: 'complete',
      },
    ];

    const items = createChatDisplayItems(messages);

    expect(items.find((item) => item.type === 'assistant')).toMatchObject({
      id: 'legacy_assistant',
      steerMessages: [],
    });
    expect(items.find((item) => item.id === 'current_user')).toMatchObject({
      type: 'user',
      assistantTimelineSteerMessageIds: [],
      steerMessages: [expect.objectContaining({ id: 'current_steer' })],
    });
  });
});
