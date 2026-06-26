import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { assistantRunCopyText, createChatDisplayItems } from './chatMessageDisplay.js';

describe('createChatDisplayItems', () => {
  it('keeps manually compacted context at its runtime position instead of appending it', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'compact_1',
        role: 'system',
        content: '<context_compaction_summary>older context</context_compaction_summary>',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
        contextCompaction: {
          compactedMessageCount: 1,
          compactedTokens: 128,
          keptRecentMessageCount: 2,
          maxContextTokensK: 256,
          originalMessageCount: 3,
          originalTokens: 512,
          triggerScopes: ['manual'],
        },
      },
      {
        id: 'user_1',
        role: 'user',
        content: '你好',
        createdAt: '2026-06-26T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: '你好！',
        createdAt: '2026-06-26T00:00:02.000Z',
        status: 'complete',
      },
    ];

    expect(createChatDisplayItems(messages).map((item) => item.id)).toEqual([
      'compact_1',
      'user_1',
      'assistant_1',
    ]);
  });

  it('excludes completed thinking content from assistant copy text', () => {
    expect(assistantRunCopyText({
      type: 'assistant',
      id: 'assistant_1',
      messageIds: ['assistant_1'],
      segments: [
        {
          id: 'assistant_1',
          role: 'assistant',
          content: '<think>internal plan</think>visible answer',
          createdAt: '2026-06-26T00:00:02.000Z',
          status: 'complete',
        },
      ],
    })).toBe('visible answer');
  });
});
