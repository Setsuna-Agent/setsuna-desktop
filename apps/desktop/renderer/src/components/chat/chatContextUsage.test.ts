import { describe, expect, it } from 'vitest';
import type { RuntimeContextCompactionNotice, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import { contextTokenUsageFromThread } from './chatContextUsage.js';

describe('chat context usage', () => {
  it('ignores transcript-only history immediately after compaction', () => {
    const shortTranscript = compactedThread('archived');
    const longTranscript = compactedThread('archived'.repeat(20_000));

    expect(contextTokenUsageFromThread(longTranscript).usedTokens).toBe(contextTokenUsageFromThread(shortTranscript).usedTokens);
  });

  it('continues counting new model-visible messages after compaction', () => {
    const compacted = compactedThread('archived'.repeat(20_000));
    const compactedUsage = contextTokenUsageFromThread(compacted);
    const withFollowUp: RuntimeThread = {
      ...compacted,
      messages: [
        ...compacted.messages,
        runtimeMessage({ id: 'message_follow_up', role: 'user', content: 'new visible context '.repeat(80) }),
      ],
    };

    expect(contextTokenUsageFromThread(withFollowUp).usedTokens).toBeGreaterThan(compactedUsage.usedTokens);
  });
});

function compactedThread(transcriptContent: string): RuntimeThread {
  const notice: RuntimeContextCompactionNotice = {
    compactedMessageCount: 1,
    compactedTokens: 64,
    keptRecentMessageCount: 0,
    maxContextTokens: 1_000,
    maxContextTokensK: 1,
    originalMessageCount: 1,
    originalTokens: 800,
  };
  return {
    id: 'thread_1',
    title: 'Compacted thread',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:01.000Z',
    archived: false,
    lastSeq: 2,
    messageCount: 2,
    lastMessagePreview: 'summary',
    contextCompaction: {
      status: 'completed',
      maxContextTokens: 1_000,
      maxContextTokensK: 1,
      notice,
      percent: 6,
      usedTokens: 64,
    },
    messages: [
      runtimeMessage({ id: 'message_archived', role: 'user', content: transcriptContent, visibility: 'transcript' }),
      {
        ...runtimeMessage({ id: 'message_summary', role: 'system', content: '<context_compaction_summary>summary</context_compaction_summary>' }),
        contextCompaction: notice,
      },
    ],
  };
}

function runtimeMessage(input: Pick<RuntimeMessage, 'id' | 'role' | 'content'> & Pick<Partial<RuntimeMessage>, 'visibility'>): RuntimeMessage {
  return {
    ...input,
    createdAt: '2026-07-11T00:00:00.000Z',
    status: 'complete',
  };
}
