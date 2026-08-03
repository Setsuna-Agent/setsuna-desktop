import type {
  RuntimeEvent,
  RuntimeThread,
  RuntimeThreadSummary,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  activeTurnIdFromThreadSnapshot,
  adoptOwnedThreadSnapshot,
  applyCurrentThreadEvent,
  inferActiveTurnIdFromThread,
  isThreadContextCompacting,
  selectInitialThreadSummary,
} from '../../../../src/services/runtime-client/runtimeThreadState.js';

describe('applyCurrentThreadEvent', () => {
  it('rejects events from another thread and events that do not advance sequence', () => {
    const thread = threadWithMessages([]);
    thread.lastSeq = 5;

    expect(applyCurrentThreadEvent(thread, threadUpdatedEvent('thread_other', 6)))
      .toBe(thread);
    expect(applyCurrentThreadEvent(thread, threadUpdatedEvent(thread.id, 5)))
      .toBe(thread);
  });

  it('projects a newer event for the selected thread', () => {
    const thread = threadWithMessages([]);
    thread.lastSeq = 5;

    const projected = applyCurrentThreadEvent(
      thread,
      threadUpdatedEvent(thread.id, 6, 'Updated thread'),
    );

    expect(projected).not.toBe(thread);
    expect(projected).toMatchObject({
      id: thread.id,
      lastSeq: 6,
      title: 'Updated thread',
    });
  });

  it.each([
    {
      name: 'a dropped delta',
      delivery: [1, 2, 4, 5],
    },
    {
      name: 'duplicates and a late reordered delta',
      delivery: [1, 2, 2, 4, 3, 4, 5],
    },
  ])('uses canonical completion to repair $name', ({ delivery }) => {
    const events = canonicalCompletionEvents();
    let thread: RuntimeThread | null = threadWithMessages([]);

    for (const sequence of delivery) {
      thread = applyCurrentThreadEvent(thread, events.get(sequence)!);
    }

    expect(thread).toMatchObject({
      lastSeq: 5,
      messages: [
        expect.objectContaining({
          content: 'The complete answer.',
          id: 'assistant_1',
          status: 'complete',
        }),
      ],
    });
  });
});

describe('adoptOwnedThreadSnapshot', () => {
  it('rejects a late snapshot after selection moved to another thread', () => {
    const current = threadWithMessages([]);
    current.id = 'thread_new';
    current.lastSeq = 3;
    const late = threadWithMessages([]);
    late.id = 'thread_old';
    late.lastSeq = 20;

    expect(adoptOwnedThreadSnapshot(current, 'thread_old', late)).toBe(current);
  });

  it('rejects an older snapshot and accepts a non-regressing owned snapshot', () => {
    const current = threadWithMessages([]);
    current.lastSeq = 8;
    const older = { ...current, lastSeq: 7 };
    const newer = { ...current, lastSeq: 9 };

    expect(adoptOwnedThreadSnapshot(current, current.id, older)).toBe(current);
    expect(adoptOwnedThreadSnapshot(current, current.id, newer)).toBe(newer);
  });
});

describe('isThreadContextCompacting', () => {
  it('does not treat an empty thread selection as an active compaction', () => {
    expect(isThreadContextCompacting(null, null)).toBe(false);
  });

  it('only reports compaction for the matching concrete thread', () => {
    expect(isThreadContextCompacting('thread_active', 'thread_active')).toBe(true);
    expect(isThreadContextCompacting('thread_active', 'thread_other')).toBe(false);
    expect(isThreadContextCompacting('thread_active', null)).toBe(false);
  });
});

describe('inferActiveTurnIdFromThread', () => {
  it('prefers the runtime snapshot active turn id even without streaming evidence', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_complete',
        turnId: 'turn_active',
        role: 'assistant',
        content: 'still active between model segments',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
      },
    ]);
    thread.activeTurnId = 'turn_active';

    expect(activeTurnIdFromThreadSnapshot(thread, new Set())).toBe('turn_active');
  });

  it('clears active state when the runtime snapshot has no active turn and no fallback evidence', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_complete',
        turnId: 'turn_done',
        role: 'assistant',
        content: 'done',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
      },
    ]);
    thread.activeTurnId = null;

    expect(activeTurnIdFromThreadSnapshot(thread, new Set())).toBeNull();
  });

  it('keeps a running tool turn cancellable even when local active state is empty', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_running',
        turnId: 'turn_running',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_read', name: 'read_file', status: 'running' }],
      },
    ]);

    expect(inferActiveTurnIdFromThread(thread, new Set())).toBe('turn_running');
  });

  it('does not revive terminal turns', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_running',
        turnId: 'turn_done',
        role: 'assistant',
        content: '',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
        toolRuns: [{ id: 'call_read', name: 'read_file', status: 'running' }],
      },
    ]);

    expect(inferActiveTurnIdFromThread(thread, new Set(['turn_done']))).toBeNull();
  });

  it('does not infer a turn from a completed intermediate assistant segment', () => {
    const thread = threadWithMessages([
      {
        id: 'assistant_tools',
        turnId: 'turn_tools',
        role: 'assistant',
        content: '我先看一下文件',
        createdAt: '2026-06-29T00:00:00.000Z',
        status: 'complete',
      },
    ]);

    expect(inferActiveTurnIdFromThread(thread, new Set())).toBeNull();
  });
});

describe('selectInitialThreadSummary', () => {
  it('restores the persisted thread when it still exists in the current list', () => {
    const threads = [
      threadSummary('global_1'),
      threadSummary('project_1', { projectId: 'project_a' }),
    ];

    expect(selectInitialThreadSummary(threads, 'project_1')?.id).toBe('project_1');
  });

  it('keeps the previous global-first fallback when the persisted thread is stale', () => {
    const threads = [
      threadSummary('project_1', { projectId: 'project_a' }),
      threadSummary('global_1'),
    ];

    expect(selectInitialThreadSummary(threads, 'missing')?.id).toBe('global_1');
  });

  it('falls back to the first thread when no global thread exists', () => {
    const threads = [
      threadSummary('project_1', { projectId: 'project_a' }),
      threadSummary('project_2', { projectId: 'project_b' }),
    ];

    expect(selectInitialThreadSummary(threads, null)?.id).toBe('project_1');
  });
});

function threadUpdatedEvent(
  threadId: string,
  seq: number,
  title = 'Ignored title',
): RuntimeEvent {
  return {
    id: `event_${threadId}_${seq}`,
    seq,
    threadId,
    type: 'thread.updated',
    createdAt: '2026-06-29T00:00:01.000Z',
    payload: { title },
  };
}

function canonicalCompletionEvents(): Map<number, RuntimeEvent> {
  const createdAt = '2026-06-29T00:00:01.000Z';
  const base = {
    threadId: 'thread_1',
    turnId: 'turn_1',
    createdAt,
  };
  const events: RuntimeEvent[] = [
    {
      ...base,
      id: 'event_message_created',
      seq: 1,
      type: 'message.created',
      payload: {
        message: {
          id: 'assistant_1',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt,
          status: 'streaming',
        },
      },
    },
    {
      ...base,
      id: 'event_delta_kept',
      seq: 2,
      type: 'message.delta',
      payload: { messageId: 'assistant_1', text: 'The ' },
    },
    {
      ...base,
      id: 'event_delta_dropped',
      seq: 3,
      type: 'message.delta',
      payload: { messageId: 'assistant_1', text: 'partial answer.' },
    },
    {
      ...base,
      id: 'event_message_completed',
      seq: 4,
      type: 'message.completed',
      payload: { messageId: 'assistant_1', content: 'The complete answer.' },
    },
    {
      ...base,
      id: 'event_turn_completed',
      seq: 5,
      type: 'turn.completed',
      payload: {},
    },
  ];
  return new Map(events.map((event) => [event.seq, event]));
}

function threadWithMessages(messages: RuntimeThread['messages']): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
    archived: false,
    messageCount: messages.length,
    lastMessagePreview: '',
    lastSeq: messages.length,
    messages,
  };
}

function threadSummary(
  id: string,
  patch: Partial<RuntimeThreadSummary> = {},
): RuntimeThreadSummary {
  return {
    id,
    title: id,
    createdAt: '2026-06-29T00:00:00.000Z',
    updatedAt: '2026-06-29T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    ...patch,
  };
}
