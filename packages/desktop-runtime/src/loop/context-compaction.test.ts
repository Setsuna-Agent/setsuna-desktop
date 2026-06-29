import { describe, expect, it } from 'vitest';
import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { createRuntimeContextCompactionCandidate, materializeRuntimeContextCompaction } from './context-compaction.js';

describe('runtime context compaction', () => {
  it('creates a system summary and keeps recent messages when forced', () => {
    const messages = Array.from({ length: 12 }, (_, index): RuntimeMessage => ({
      id: `msg_${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `message ${index}`,
      createdAt: `2026-06-25T00:00:${String(index).padStart(2, '0')}.000Z`,
      status: 'complete',
    }));

    const candidate = createRuntimeContextCompactionCandidate({ force: true, messages });
    const result = candidate
      ? materializeRuntimeContextCompaction({
          candidate,
          createdAt: '2026-06-25T00:01:00.000Z',
          id: 'compact_1',
          summary: 'model generated summary',
        })
      : null;

    expect(result?.messages[4]).toMatchObject({
      id: 'compact_1',
      role: 'system',
      contextCompaction: {
        compactedMessageCount: 4,
        maxContextTokens: 256000,
        keptRecentMessageCount: 8,
        maxContextTokensK: 256,
        summaryRole: 'system',
        triggerScopes: ['manual'],
      },
    });
    expect(result?.notice.historyTokens).toBeGreaterThan(0);
    expect(result?.notice.summaryTokens).toBeGreaterThan(0);
    expect(result?.messages.map((message) => message.id)).toEqual([
      ...messages.slice(0, 4).map((message) => message.id),
      'compact_1',
      ...messages.slice(4).map((message) => message.id),
    ]);
    expect(result?.messages.slice(0, 4).every((message) => message.visibility === 'transcript')).toBe(true);
    expect(result?.messages.slice(5).every((message) => message.visibility !== 'transcript')).toBe(true);
    expect(result?.messages[4].content).toContain('model generated summary');
  });

  it('keeps prior transcript-only history visible without re-compacting it', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'archived_user',
        role: 'user',
        content: 'already archived',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
        visibility: 'transcript',
      },
      ...Array.from({ length: 10 }, (_, index): RuntimeMessage => ({
        id: `msg_${index}`,
        role: index % 2 ? 'assistant' : 'user',
        content: `message ${index}`,
        createdAt: `2026-06-25T00:00:${String(index + 1).padStart(2, '0')}.000Z`,
        status: 'complete',
      })),
    ];

    const candidate = createRuntimeContextCompactionCandidate({ force: true, messages });
    const result = candidate
      ? materializeRuntimeContextCompaction({
          candidate,
          createdAt: '2026-06-25T00:01:00.000Z',
          id: 'compact_1',
          summary: 'model generated summary',
        })
      : null;

    expect(result?.notice.compactedMessageCount).toBe(2);
    expect(result?.messages.map((message) => message.id)).toEqual([
      'archived_user',
      'msg_0',
      'msg_1',
      'compact_1',
      ...messages.slice(3).map((message) => message.id),
    ]);
    expect(result?.messages[0]).toMatchObject({ id: 'archived_user', visibility: 'transcript' });
    expect(result?.messages[1]).toMatchObject({ id: 'msg_0', visibility: 'transcript' });
    expect(result?.messages[2]).toMatchObject({ id: 'msg_1', visibility: 'transcript' });
  });

  it('does not compact small context unless forced', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'short',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
    ];

    expect(createRuntimeContextCompactionCandidate({ messages })).toBeNull();
  });
});
