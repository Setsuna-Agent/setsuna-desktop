import { describe, expect, it } from 'vitest';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';

describe('thread event structural sharing', () => {
  it('clones only the message touched by a stream delta', () => {
    const thread: RuntimeThread = {
      id: 'thread_cow',
      title: 'Copy on write',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      archived: false,
      messageCount: 2,
      lastMessagePreview: '',
      lastSeq: 1,
      turns: [{ id: 'turn_1', status: 'in_progress', items: [] }],
      messages: [
        {
          id: 'message_user',
          turnId: 'turn_1',
          role: 'user',
          content: 'Question',
          createdAt: '2026-08-03T00:00:00.000Z',
          status: 'complete',
        },
        {
          id: 'message_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: 'Partial',
          createdAt: '2026-08-03T00:00:01.000Z',
          status: 'streaming',
        },
      ],
    };

    const projected = applyRuntimeEventToThread(thread, {
      id: 'event_delta',
      seq: 2,
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-08-03T00:00:02.000Z',
      payload: { messageId: 'message_assistant', text: ' answer.' },
    });

    expect(projected).not.toBe(thread);
    expect(projected.messages).not.toBe(thread.messages);
    expect(projected.messages[0]).toBe(thread.messages[0]);
    expect(projected.messages[1]).not.toBe(thread.messages[1]);
    expect(projected.messages[1]?.content).toBe('Partial answer.');
    expect(thread.messages[1]?.content).toBe('Partial');
    expect(projected.turns).toBe(thread.turns);
  });

  it('retains all nested domains for metadata-only events', () => {
    const messages: RuntimeThread['messages'] = [];
    const turns: NonNullable<RuntimeThread['turns']> = [];
    const thread: RuntimeThread = {
      id: 'thread_metadata',
      title: 'Before',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages,
      turns,
    };

    const projected = applyRuntimeEventToThread(thread, {
      id: 'event_title',
      seq: 1,
      threadId: thread.id,
      type: 'thread.updated',
      createdAt: '2026-08-03T00:00:01.000Z',
      payload: { title: 'After' },
    });

    expect(projected.title).toBe('After');
    expect(projected.messages).toBe(messages);
    expect(projected.turns).toBe(turns);
  });

  it('normalizes missing and removed Plan queued input kinds during unrelated projections', () => {
    const legacyInput = {
      id: 'queued_legacy',
      input: 'Continue later',
      createdAt: '2026-08-03T00:00:00.000Z',
    };
    const planInput = {
      id: 'queued_plan',
      kind: 'plan' as const,
      input: 'Plan later',
      createdAt: '2026-08-03T00:00:00.000Z',
    };
    const thread: RuntimeThread = {
      id: 'thread_legacy_queue',
      title: 'Before',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
      queuedTurnInputs: [legacyInput, planInput],
    };

    const projected = applyRuntimeEventToThread(thread, {
      id: 'event_title',
      seq: 1,
      threadId: thread.id,
      type: 'thread.updated',
      createdAt: '2026-08-03T00:00:01.000Z',
      payload: { title: 'After' },
    });

    expect(projected.queuedTurnInputs?.map((input) => input.kind)).toEqual(['message', 'message']);
    expect(projected.queuedTurnInputs?.[0]).not.toBe(legacyInput);
    expect(projected.queuedTurnInputs?.[1]).not.toBe(planInput);
    expect(legacyInput).not.toHaveProperty('kind');
  });
});
