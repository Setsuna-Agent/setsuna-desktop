import { describe, expect, it } from 'vitest';
import { applyRuntimeEventToThread } from './thread-events.js';
import type { RuntimeEvent } from './events.js';
import type { RuntimeThread } from './threads.js';

describe('applyRuntimeEventToThread context compaction', () => {
  it('records assistant completion time from message.completed events', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [
        {
          id: 'msg_1',
          role: 'assistant',
          content: '<think>plan</think>answer',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'streaming',
        },
      ],
    };
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: { messageId: 'msg_1' },
    };

    const completed = applyRuntimeEventToThread(thread, event);

    expect(completed.messages[0]).toMatchObject({
      completedAt: '2026-06-26T00:00:03.000Z',
      status: 'complete',
    });
  });

  it('tracks context compaction running and completed states', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: 'hello',
      lastSeq: 0,
      messages: [
        {
          id: 'msg_1',
          role: 'user',
          content: 'hello',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'complete',
        },
      ],
    };
    const compacting: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'thread.context_compacting',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        forced: true,
        maxContextTokens: 256000,
        maxContextTokensK: 256,
        percent: 12,
        usedTokens: 30720,
      },
    };
    const running = applyRuntimeEventToThread(thread, compacting);
    expect(running.contextCompaction).toMatchObject({
      forced: true,
      maxContextTokens: 256000,
      percent: 12,
      status: 'running',
      usedTokens: 30720,
    });

    const compactedMessage = {
      id: 'msg_compact',
      role: 'system' as const,
      content: '<context_compaction_summary>hello</context_compaction_summary>',
      createdAt: '2026-06-26T00:00:02.000Z',
      status: 'complete' as const,
      contextCompaction: {
        compactedMessageCount: 1,
        compactedTokens: 128,
        keptRecentMessageCount: 0,
        maxContextTokens: 256000,
        maxContextTokensK: 256,
        originalMessageCount: 1,
        originalTokens: 512,
        triggerScopes: ['manual'],
      },
    };
    const compacted: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      type: 'thread.context_compacted',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        messages: [compactedMessage],
        notice: compactedMessage.contextCompaction,
      },
    };
    const completed = applyRuntimeEventToThread(running, compacted);
    expect(completed.contextCompaction).toMatchObject({
      notice: compactedMessage.contextCompaction,
      status: 'completed',
      usedTokens: 128,
    });
    expect(completed.messages).toHaveLength(1);
  });
});
