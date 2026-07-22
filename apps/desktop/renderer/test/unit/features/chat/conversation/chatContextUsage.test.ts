import type {
  RuntimeConfigState,
  RuntimeContextCompactionNotice,
  RuntimeMessage,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  activeModelContextWindowTokens,
  contextTokenUsageFromThread,
  formatTokenCount,
} from '../../../../../src/features/chat/conversation/chatContextUsage.js';

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

  it('uses the configured model context window instead of the 256k display fallback', () => {
    expect(contextTokenUsageFromThread(null, 1_000_000).totalTokens).toBe(1_000_000);
  });

  it('uses the selected model context window over a stale thread compaction limit', () => {
    const thread = compactedThread('archived');

    expect(contextTokenUsageFromThread(thread, 1_000_000).totalTokens).toBe(1_000_000);
  });

  it('reads the context window from the active provider model', () => {
    expect(activeModelContextWindowTokens(configWithContextWindow(1_000_000))).toBe(1_000_000);
  });

  it.each([
    [999_000, '999k'],
    [1_000_000, '1M'],
    [1_250_000, '1.3M'],
    [10_000_000, '10M'],
  ])('formats %i tokens as %s', (tokens, expected) => {
    expect(formatTokenCount(tokens)).toBe(expected);
  });
});

function configWithContextWindow(contextWindowTokens: number): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/setsuna',
    storagePath: '',
    activeProviderId: 'minimax',
    globalPrompt: '',
    memory: {
      useMemories: true,
      generateMemories: true,
      dedicatedTools: false,
      disableOnExternalContext: true,
    },
    memoryEnabled: true,
    setsunaStyle: 'developer',
    approvalPolicy: 'on-request',
    permissionProfile: 'workspace-write',
    providers: [
      {
        id: 'minimax',
        name: 'MiniMax',
        provider: 'openai-compatible',
        baseUrl: 'https://example.com/v1',
        enabled: true,
        apiKeySet: true,
        apiKeyPreview: '***',
        models: [
          {
            id: 'minimax-m3',
            name: 'MiniMax-M3',
            code: 'MiniMax-M3',
            enabled: true,
            contextWindowTokens,
            maxOutputTokens: 4096,
            thinkingEnabled: false,
            thinkingEfforts: [],
          },
        ],
      },
    ],
  };
}

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
