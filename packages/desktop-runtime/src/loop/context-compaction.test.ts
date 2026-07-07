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
    const notice = result?.notice;
    expect(notice?.historyTokens).toBeGreaterThan(0);
    expect(notice?.summaryTokens).toBeGreaterThan(0);
    expect(notice?.autoCompactTokenLimit).toBe(217600);
    expect(notice?.tokensUntilCompaction).toBe(Math.max(0, (notice?.autoCompactTokenLimit ?? 0) - (notice?.compactedTokens ?? 0)));
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

  it('uses the active model budget when deciding automatic compaction', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'token-ish '.repeat(600),
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: 'recent answer',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
      },
    ];

    expect(createRuntimeContextCompactionCandidate({ messages })).toBeNull();
    const candidate = createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 1_000 },
      force: false,
      keepRecentMessages: 1,
      messages,
    });
    const result = candidate
      ? materializeRuntimeContextCompaction({
          candidate,
          createdAt: '2026-06-25T00:01:00.000Z',
          id: 'compact_1',
          summary: 'small-window summary',
        })
      : null;

    expect(candidate?.autoCompactTokenLimit).toBe(850);
    expect(result?.notice.autoCompactTokenLimit).toBe(850);
    expect(result?.notice.tokensUntilCompaction).toBe(Math.max(0, 850 - (result?.notice.compactedTokens ?? 0)));
    expect(result?.notice.maxContextTokens).toBe(1_000);
    expect(result?.notice.maxContextTokensK).toBe(1);
    expect(result?.messages.find((message) => message.id === 'compact_1')?.content).toContain('max_context_tokens_k="1"');
  });

  it('allows an oversized latest tool result to be summarized mid-turn', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'Inspect the generated report.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: '{"file_path":"report.txt"}' }],
      },
      {
        id: 'tool_1',
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'read_file',
        content: 'huge tool output '.repeat(90_000),
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
    ];

    const candidate = createRuntimeContextCompactionCandidate({ messages });
    expect(candidate?.recentMessages).toHaveLength(0);
    expect(candidate?.olderMessages.map((message) => message.id)).toEqual(['user_1', 'assistant_1', 'tool_1']);
    expect(candidate?.triggerScopes).toEqual(['total', 'latest_tool']);
  });

  it('allows oversized latest user text to be summarized when it alone exceeds the budget', () => {
    const messages: RuntimeMessage[] = [
      {
        id: 'user_1',
        role: 'user',
        content: 'Start the task.',
        createdAt: '2026-06-25T00:00:00.000Z',
        status: 'complete',
      },
      {
        id: 'assistant_1',
        role: 'assistant',
        content: 'Initial answer.',
        createdAt: '2026-06-25T00:00:01.000Z',
        status: 'complete',
      },
      {
        id: 'steer_1',
        role: 'user',
        content: 'oversized steer detail '.repeat(800),
        createdAt: '2026-06-25T00:00:02.000Z',
        status: 'complete',
      },
    ];

    const candidate = createRuntimeContextCompactionCandidate({
      budget: { maxContextTokens: 1_000 },
      messages,
    });
    const result = candidate
      ? materializeRuntimeContextCompaction({
          candidate,
          createdAt: '2026-06-25T00:01:00.000Z',
          id: 'compact_1',
          summary: 'summarized oversized steer',
          turnId: 'turn_1',
        })
      : null;

    expect(candidate?.recentMessages).toHaveLength(0);
    expect(candidate?.olderMessages.map((message) => message.id)).toEqual(['user_1', 'assistant_1', 'steer_1']);
    expect(candidate?.triggerScopes).toEqual(['total', 'latest_input']);
    expect(result?.messages.slice(0, 3).every((message) => message.visibility === 'transcript')).toBe(true);
    expect(result?.messages[3]).toMatchObject({
      id: 'compact_1',
      role: 'system',
      contextCompaction: {
        triggerScopes: ['total', 'latest_input'],
      },
    });
  });
});
