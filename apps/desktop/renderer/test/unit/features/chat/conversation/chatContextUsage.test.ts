import {
  applyRuntimeEventToThread,
  type RuntimeConfigState,
  type RuntimeContextCompactionNotice,
  type RuntimeMessage,
  type RuntimeModelRequestStepSnapshot,
  type RuntimeThread,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  activeModelContextWindowTokens,
  contextTokenUsageFromThread,
  formatTokenCount,
} from '../../../../../src/features/chat/conversation/chatContextUsage.js';

describe('chat context usage', () => {
  it('separates estimated input from output reserve through sampling and compaction', () => {
    let thread = sampledThread();
    expect(contextTokenUsageFromThread(thread)).toMatchObject({
      usedTokens: 178_904,
      reservedOutputTokens: 38_400,
      totalTokens: 256_000,
      percent: 70,
    });

    thread = applyRuntimeEventToThread(thread, {
      id: 'compacting', threadId: thread.id, turnId: 'turn_1', seq: 3,
      createdAt: '2026-09-12T14:43:31.634Z', type: 'thread.context_compacting',
      payload: { maxContextTokens: 256_000, maxContextTokensK: 256, usedTokens: 219_518, percent: 100 },
    });
    // Runtime's event percent is relative to its trigger threshold; the ring stays
    // relative to the full model window throughout all three lifecycle states.
    expect(contextTokenUsageFromThread(thread)).toMatchObject({ usedTokens: 181_118, percent: 71 });

    const notice: RuntimeContextCompactionNotice = {
      compactedMessageCount: 206, compactedTokens: 8_527, compactedRequestTokens: 115_670,
      keptRecentMessageCount: 8, originalMessageCount: 214, originalTokens: 112_375,
      maxContextTokens: 256_000, maxContextTokensK: 256, autoCompactTokenLimit: 217_600,
    };
    thread = applyRuntimeEventToThread(thread, {
      id: 'compacted', threadId: thread.id, turnId: 'turn_1', seq: 4,
      createdAt: '2026-09-12T14:43:39.495Z', type: 'thread.context_compacted',
      payload: {
        notice,
        messages: [{ ...runtimeMessage({ id: 'summary', role: 'user', content: 'Short summary' }), contextCompaction: notice }],
      },
    });
    expect(contextTokenUsageFromThread(thread)).toMatchObject({ usedTokens: 77_270, percent: 30 });
    expect(contextTokenUsageFromThread({ ...thread, messages: [] }).usedTokens).toBe(77_270);

    thread = applyRuntimeEventToThread(thread, {
      id: 'next_step', threadId: thread.id, turnId: 'turn_1', seq: 5,
      createdAt: '2026-09-12T14:50:00.265Z', type: 'turn.step_snapshot',
      payload: { snapshot: requestSnapshot(169_951, ['summary']) },
    });
    expect(contextTokenUsageFromThread(thread)).toMatchObject({ usedTokens: 131_551, percent: 51 });
  });

  it('keeps request usage independent of transcript pagination and provider billing counts', () => {
    const thread = sampledThread();
    const completeUsage = contextTokenUsageFromThread(thread);
    const paged = { ...thread, messages: [], messagePage: { nextBefore: 200, total: 400 } };
    expect(contextTokenUsageFromThread(paged)).toEqual(completeUsage);

    const withBilling = applyRuntimeEventToThread(paged, {
      id: 'usage', threadId: thread.id, turnId: 'turn_1', seq: 3,
      createdAt: '2026-09-12T14:43:30.000Z', type: 'token.count',
      payload: { usage: { inputTokens: 214_693, cachedInputTokens: 214_144, outputTokens: 55, totalTokens: 214_748 } },
    });
    expect(contextTokenUsageFromThread(withBilling)).toEqual(completeUsage);
  });

  it('uses the running request limit until it finishes, then reflects the selected model limit', () => {
    const thread = sampledThread();
    expect(contextTokenUsageFromThread(thread, 1_000_000)).toMatchObject({ totalTokens: 256_000, percent: 70 });

    const idleUsage = contextTokenUsageFromThread({ ...thread, activeTurnId: null }, 1_000_000);
    expect(idleUsage.totalTokens).toBe(1_000_000);
  });

  it('discards request budgets when the context is cleared', () => {
    const thread = sampledThread();
    const cleared = applyRuntimeEventToThread(thread, {
      id: 'clear', threadId: thread.id, seq: 3,
      createdAt: '2026-09-12T14:43:31.000Z', type: 'thread.context_cleared',
      payload: { clearedMessageCount: thread.messages.length },
    });
    expect(contextTokenUsageFromThread(cleared)).toMatchObject({ usedTokens: 0, percent: 0 });
  });

  it.each(['messages.deleted', 'messages.truncated'] as const)('recounts remaining context after %s and accepts a fresh request budget', (type) => {
    const original = sampledThread();
    const hello = { ...runtimeMessage({ id: 'hello', role: 'user', content: 'hello' }), turnId: 'turn_1' };
    const history = { ...original.messages[0]!, turnId: 'turn_1' };
    const thread = { ...original, messages: type === 'messages.deleted' ? [history, hello] : [hello, history] };
    const createdAt = '2026-09-12T14:43:31.000Z';
    const event = { id: 'remove', threadId: thread.id, seq: 3, createdAt };
    const updated = applyRuntimeEventToThread(thread, type === 'messages.deleted'
      ? { ...event, type, payload: { messageIds: ['history'] } }
      : { ...event, type, payload: { messageId: 'hello', includeSelf: false, removedMessageIds: ['history'] } });

    expect(updated.messages).toEqual([hello]);
    // Keep diagnostic snapshots intact, while invalidating their use as a live budget.
    expect(updated.turns?.[0]?.stepSnapshots).toBe(thread.turns?.[0]?.stepSnapshots);
    expect(contextTokenUsageFromThread(updated, 128_000)).toMatchObject({
      usedTokens: contextTokenUsageFromThread({ ...updated, turns: [] }, 128_000).usedTokens,
      percent: 0,
    });
    expect(contextTokenUsageFromThread(thread).usedTokens).toBe(178_904);

    const refreshed = applyRuntimeEventToThread(updated, {
      id: 'fresh_step', threadId: thread.id, turnId: 'turn_1', seq: 4, createdAt,
      type: 'turn.step_snapshot', payload: { snapshot: { ...requestSnapshot(2_000), threadLastSeq: 3 } },
    });
    expect(contextTokenUsageFromThread(refreshed).usedTokens).toBe(2_000);
    expect(contextTokenUsageFromThread({ ...refreshed, messages: [], messagePage: { nextBefore: 10, total: 20 } }).usedTokens).toBe(2_000);
  });

  it('invalidates compaction budgets after deletion and restores them on the next compaction', () => {
    const thread = compactedThread('archived');
    const notice = { ...thread.contextCompaction!.notice!, compactedRequestTokens: 110_000 };
    const compacted = applyRuntimeEventToThread(thread, {
      id: 'compacted', threadId: thread.id, seq: 3, createdAt: '2026-09-12T14:43:31.000Z',
      type: 'thread.context_compacted', payload: { notice, messages: thread.messages },
    });
    const deleted = applyRuntimeEventToThread(compacted, {
      id: 'delete_summary', threadId: thread.id, seq: 4, createdAt: compacted.updatedAt,
      type: 'messages.deleted', payload: { messageIds: ['message_summary'] },
    });
    // Also ignore a retained legacy notice on a message when its budget predates deletion.
    const retainedNotice = { ...deleted, messages: compacted.messages };
    expect(contextTokenUsageFromThread(retainedNotice).usedTokens).toBeLessThan(100);
    expect(contextTokenUsageFromThread({ ...deleted, messages: [] }).usedTokens).toBe(0);

    const recompacted = applyRuntimeEventToThread(deleted, {
      id: 'recompacted', threadId: thread.id, seq: 5, createdAt: deleted.updatedAt,
      type: 'thread.context_compacted', payload: { notice: { ...notice, compactedRequestTokens: 1_200 }, messages: thread.messages },
    });
    expect(contextTokenUsageFromThread(recompacted).usedTokens).toBe(1_200);
  });

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

function sampledThread(): RuntimeThread {
  return {
    ...compactedThread('archived'),
    contextCompaction: undefined,
    activeTurnId: 'turn_1',
    messages: [runtimeMessage({ id: 'history', role: 'user', content: 'x'.repeat(110_161 * 4) })],
    turns: [{
      id: 'turn_1', status: 'in_progress', items: [],
      stepSnapshots: [{ createdAt: '2026-09-12T14:43:29.000Z', snapshot: requestSnapshot(217_304) }],
    }],
  };
}

function requestSnapshot(estimatedTokens: number, summaryIds: string[] = []): RuntimeModelRequestStepSnapshot {
  const reservedOutputTokens = estimatedTokens >= 38_400 ? 38_400 : 0;
  const toolDefinitionTokens = Math.min(62_799, estimatedTokens - reservedOutputTokens);
  return {
    threadId: 'thread_1', turnId: 'turn_1', threadLastSeq: 2,
    conversationMessageIds: ['history'], messageIds: ['history'], toolNames: ['read_file'],
    selectedSkills: [], mcpServerKeys: [], mcpServerCount: 0, permissionProfile: 'workspace-write', featureKeys: [],
    worldState: { threadMessageCount: 1, threadUpdatedAt: '2026-09-12T14:43:29.000Z' },
    contextWindow: {
      estimatedTokens, maxContextTokens: 256_000, maxContextTokensK: 256,
      autoCompactTokenLimit: 217_600, tokensUntilCompaction: Math.max(0, 217_600 - estimatedTokens),
      compactionSummaryMessageIds: summaryIds, messageCount: 191,
      messageTokens: estimatedTokens - toolDefinitionTokens - reservedOutputTokens, toolDefinitionTokens, reservedOutputTokens,
    },
  };
}

function configWithContextWindow(contextWindowTokens: number): RuntimeConfigState {
  return {
    configPath: '/tmp/config.json',
    dataPath: '/tmp/setsuna',
    storagePath: '',
    activeProviderId: 'minimax',
    globalPrompt: '',
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
