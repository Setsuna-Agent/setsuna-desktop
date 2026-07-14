import { describe, expect, it } from 'vitest';
import { applyRuntimeEventToThread } from './thread-events.js';
import type { RuntimeEvent } from './events.js';
import type { RuntimeThread } from './threads.js';

describe('applyRuntimeEventToThread context compaction', () => {
  it('separates streamed tool preparation from actual execution', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [{
        id: 'msg_1',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'streaming',
      }],
    };
    const preview: RuntimeEvent = {
      id: 'event_preview',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.preview',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        argumentsPreview: '{"file_path":"src/generated.ts"',
        argumentsLength: 34,
      },
    };
    const started: RuntimeEvent = {
      id: 'event_started',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.started',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        argumentsPreview: '{"file_path":"src/generated.ts","content":"export {};"}',
      },
    };

    const preparing = applyRuntimeEventToThread(thread, preview);
    const executing = applyRuntimeEventToThread(preparing, started);

    expect(preparing.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'running',
      phase: 'preparing',
      argumentsLength: 34,
      preparedAt: '2026-06-26T00:00:01.000Z',
    });
    expect(executing.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'running',
      phase: 'executing',
      preparedAt: '2026-06-26T00:00:01.000Z',
      startedAt: '2026-06-26T00:00:02.000Z',
    });
  });

  it('appends tool output deltas to the matching assistant tool run', () => {
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
          turnId: 'turn_1',
          content: '',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'streaming',
        },
      ],
    };
    const started: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.started',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        argumentsPreview: '{"command":"pnpm test"}',
        source: 'agent',
      },
    };
    const firstDelta: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.output_delta',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        delta: 'stdout: hello\n',
        stream: 'stdout',
        source: 'agent',
      },
    };
    const secondDelta: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.output_delta',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        delta: 'stdout: world\n',
        stream: 'stdout',
        source: 'agent',
      },
    };

    const updated = [started, firstDelta, secondDelta].reduce(applyRuntimeEventToThread, thread);

    expect(updated.lastSeq).toBe(3);
    expect(updated.messages[0].toolRuns).toEqual([
      expect.objectContaining({
        id: 'call_1',
        name: 'run_shell_command',
        source: 'agent',
        status: 'running',
        argumentsPreview: '{"command":"pnpm test"}',
        resultPreview: 'stdout: hello\nstdout: world\n',
      }),
    ]);
  });

  it('uses tool completion content as the final preview after streaming deltas', () => {
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
          turnId: 'turn_1',
          content: '',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'streaming',
          toolRuns: [
            {
              id: 'call_1',
              name: 'run_shell_command',
              status: 'running',
              resultPreview: 'stdout: partial\n',
            },
          ],
        },
      ],
    };
    const completed: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.completed',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        status: 'success',
        content: '$ pnpm test\nstdout: done\nexit: 0',
        durationMs: 42,
      },
    };

    const updated = applyRuntimeEventToThread(thread, completed);

    expect(updated.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'success',
      resultPreview: '$ pnpm test\nstdout: done\nexit: 0',
      durationMs: 42,
    });
  });

  it('preserves structured completion previews instead of replacing them with model-facing content', () => {
    const structuredPreview = JSON.stringify({
      diff: { path: 'src/theme.css', action: 'Edited', additions: 4, deletions: 2, lines: [] },
    });
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [{
        id: 'msg_1',
        role: 'assistant',
        turnId: 'turn_1',
        content: '',
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'streaming',
        toolRuns: [{ id: 'call_1', name: 'write_file', status: 'running' }],
      }],
    };
    const completed: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.completed',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        status: 'success',
        content: 'Updated src/theme.css.',
        resultPreview: structuredPreview,
      },
    };

    const updated = applyRuntimeEventToThread(thread, completed);

    expect(updated.messages[0].toolRuns?.[0]?.resultPreview).toBe(structuredPreview);
  });

  it('marks approved tool runs as running while the tool continues', () => {
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
          turnId: 'turn_1',
          content: '',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'streaming',
          toolRuns: [
            {
              id: 'call_1',
              name: 'workspace_write_file',
              status: 'pending_approval',
              approvalId: 'approval_1',
              approvalStatus: 'pending',
              argumentsPreview: '{"path":"merge_sort.py"}',
            },
          ],
        },
      ],
    };
    const event: RuntimeEvent = {
      id: 'event_approval',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.resolved',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        approvalId: 'approval_1',
        decision: 'approve',
      },
    };

    const updated = applyRuntimeEventToThread(thread, event);

    expect(updated.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'running',
      approvalStatus: 'approved',
    });
  });

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

  it('records assistant memory citations from message.completed events', () => {
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
          content: 'answer',
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
      payload: {
        messageId: 'msg_1',
        memoryCitation: {
          entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'summary' }],
          rolloutIds: ['thread_a'],
        },
      },
    };

    const completed = applyRuntimeEventToThread(thread, event);

    expect(completed.messages[0].memoryCitation).toEqual({
      entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'summary' }],
      rolloutIds: ['thread_a'],
    });
  });

  it('records plan mode metadata from message.completed events', () => {
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
          content: '1. Inspect first.',
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
      payload: {
        messageId: 'msg_1',
        planMode: { mode: 'plan', status: 'awaiting_confirmation' },
      },
    };

    const completed = applyRuntimeEventToThread(thread, event);

    expect(completed.messages[0]).toMatchObject({
      planMode: { mode: 'plan', status: 'awaiting_confirmation' },
      status: 'complete',
    });
  });

  it('records mailbox deliveries for thread history projections', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      activeTurnId: null,
      messages: [],
    };
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'mailbox.delivered',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: {
        id: 'mail_1',
        content: 'child result',
        deliveryMode: 'queue_only',
        fromAgentId: 'agent_child',
        fromThreadId: 'thread_child',
      },
    };

    const updated = applyRuntimeEventToThread(thread, event);

    expect(updated.mailboxDeliveries).toEqual([
      {
        id: 'mail_1',
        content: 'child result',
        createdAt: '2026-06-26T00:00:03.000Z',
        turnId: 'turn_1',
        deliveryMode: 'queue_only',
        fromAgentId: 'agent_child',
        fromThreadId: 'thread_child',
      },
    ]);
  });

  it('updates plan mode metadata without recompleting the message', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '1. Inspect first.',
      lastSeq: 0,
      messages: [
        {
          id: 'msg_1',
          turnId: 'turn_plan',
          role: 'assistant',
          content: '1. Inspect first.',
          createdAt: '2026-06-26T00:00:00.000Z',
          completedAt: '2026-06-26T00:00:01.000Z',
          status: 'complete',
          planMode: { mode: 'plan', status: 'awaiting_confirmation' },
        },
      ],
    };
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_plan',
      type: 'message.plan_mode_updated',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: {
        messageId: 'msg_1',
        planMode: { mode: 'plan', status: 'accepted' },
      },
    };

    const updated = applyRuntimeEventToThread(thread, event);

    expect(updated.messages[0]).toMatchObject({
      completedAt: '2026-06-26T00:00:01.000Z',
      planMode: { mode: 'plan', status: 'accepted' },
      status: 'complete',
    });
  });

  it('terminalizes active messages and tool runs when a turn is cancelled', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 2,
      lastMessagePreview: 'request',
      lastSeq: 0,
      turns: [{
        id: 'turn_1',
        startedAt: '2026-06-26T00:00:00.000Z',
        status: 'in_progress',
        items: [
          { id: 'agent_item_1', kind: 'agent_message', status: 'in_progress', content: 'partial' },
          { id: 'tool_item_1', kind: 'tool_call', status: 'in_progress', toolCall: { id: 'tool_item_1', name: 'run_shell_command', arguments: '{"command":"pnpm test"}' } },
          { id: 'plan_item_1', kind: 'plan', status: 'completed', content: 'Already finished.' },
        ],
      }],
      messages: [
        {
          id: 'msg_user',
          role: 'user',
          turnId: 'turn_1',
          content: 'request',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'complete',
        },
        {
          id: 'msg_assistant',
          role: 'assistant',
          turnId: 'turn_1',
          content: '',
          createdAt: '2026-06-26T00:00:01.000Z',
          status: 'streaming',
          toolRuns: [
            {
              id: 'call_running',
              name: 'run_shell_command',
              status: 'running',
              resultPreview: 'partial output',
            },
            {
              id: 'call_approval',
              name: 'apply_patch',
              status: 'pending_approval',
              approvalStatus: 'pending',
            },
          ],
        },
      ],
    };
    const event: RuntimeEvent = {
      id: 'event_cancel',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.cancelled',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: { reason: 'Stopped after restart.' },
    };

    const cancelled = applyRuntimeEventToThread(thread, event);

    expect(cancelled.messages[1]).toMatchObject({
      status: 'complete',
      completedAt: '2026-06-26T00:00:03.000Z',
      error: 'Stopped after restart.',
    });
    expect(cancelled.messages[1].toolRuns).toEqual([
      expect.objectContaining({
        id: 'call_running',
        status: 'cancelled',
        resultPreview: 'partial output',
        completedAt: '2026-06-26T00:00:03.000Z',
      }),
      expect.objectContaining({
        id: 'call_approval',
        status: 'cancelled',
        approvalStatus: 'cancelled',
        approvalMessage: 'Stopped after restart.',
        resultPreview: 'Stopped after restart.',
        completedAt: '2026-06-26T00:00:03.000Z',
      }),
    ]);
    expect(cancelled.turns?.[0]).toMatchObject({
      id: 'turn_1',
      status: 'cancelled',
      completedAt: '2026-06-26T00:00:03.000Z',
      error: 'Stopped after restart.',
      items: [
        { id: 'agent_item_1', status: 'cancelled' },
        { id: 'tool_item_1', status: 'cancelled' },
        { id: 'plan_item_1', status: 'completed' },
      ],
    });
  });

  it('does not reactivate a cancelled turn when a delayed started event arrives', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      activeTurnId: null,
      messages: [],
    };
    const cancelled: RuntimeEvent = {
      id: 'event_cancel',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.cancelled',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: { reason: 'Turn cancelled.', taskKind: 'regular' },
    };
    const delayedStarted: RuntimeEvent = {
      id: 'event_started',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.started',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: { input: 'late start', taskKind: 'regular' },
    };

    const projected = applyRuntimeEventToThread(applyRuntimeEventToThread(thread, cancelled), delayedStarted);

    expect(projected.activeTurnId).toBeNull();
    expect(projected.turns?.[0]).toMatchObject({
      id: 'turn_1',
      input: 'late start',
      status: 'cancelled',
      completedAt: '2026-06-26T00:00:01.000Z',
      error: 'Turn cancelled.',
    });
  });

  it('prunes persisted turn items when messages are truncated', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 4,
      lastMessagePreview: 'second answer',
      lastSeq: 0,
      activeTurnId: 'turn_2',
      turns: [
        {
          id: 'turn_1',
          status: 'completed',
          items: [{ id: 'agent_1', kind: 'agent_message', status: 'completed', content: 'first answer' }],
        },
        {
          id: 'turn_2',
          status: 'completed',
          items: [{ id: 'agent_2', kind: 'agent_message', status: 'completed', content: 'second answer' }],
        },
      ],
      messages: [
        { id: 'msg_user_1', role: 'user', turnId: 'turn_1', content: 'first', createdAt: '2026-06-26T00:00:00.000Z', status: 'complete' },
        { id: 'msg_assistant_1', role: 'assistant', turnId: 'turn_1', content: 'first answer', createdAt: '2026-06-26T00:00:01.000Z', status: 'complete' },
        { id: 'msg_user_2', role: 'user', turnId: 'turn_2', content: 'second', createdAt: '2026-06-26T00:00:02.000Z', status: 'complete' },
        { id: 'msg_assistant_2', role: 'assistant', turnId: 'turn_2', content: 'second answer', createdAt: '2026-06-26T00:00:03.000Z', status: 'complete' },
      ],
    };
    const event: RuntimeEvent = {
      id: 'event_truncate',
      seq: 1,
      threadId: 'thread_1',
      type: 'messages.truncated',
      createdAt: '2026-06-26T00:00:04.000Z',
      payload: {
        messageId: 'msg_user_2',
        includeSelf: true,
        removedMessageIds: ['msg_user_2', 'msg_assistant_2'],
      },
    };

    const truncated = applyRuntimeEventToThread(thread, event);

    expect(truncated.messages.map((message) => message.id)).toEqual(['msg_user_1', 'msg_assistant_1']);
    expect(truncated.turns?.map((turn) => turn.id)).toEqual(['turn_1']);
    expect(truncated.activeTurnId).toBeNull();
  });

  it('keeps model-only messages out of transcript summary fields', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: 'visible request',
      lastSeq: 0,
      messages: [
        {
          id: 'msg_visible',
          role: 'user',
          content: 'visible request',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'complete',
        },
      ],
    };
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'message.created',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        message: {
          id: 'msg_injected',
          role: 'user',
          content: 'Side conversation boundary.',
          createdAt: '2026-06-26T00:00:01.000Z',
          status: 'complete',
          visibility: 'model',
        },
      },
    };

    const updated = applyRuntimeEventToThread(thread, event);

    expect(updated.messages.map((message) => message.id)).toEqual(['msg_visible', 'msg_injected']);
    expect(updated.messageCount).toBe(1);
    expect(updated.lastMessagePreview).toBe('visible request');
    expect(updated.title).toBe('Thread');
  });

  it('stores and clears thread goals from thread goal events', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const updatedEvent: RuntimeEvent = {
      id: 'event_goal_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'thread.goal_updated',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        goal: {
          threadId: 'thread_1',
          objective: 'Ship alignment.',
          status: 'active',
          tokenBudget: 100,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1782432001,
          updatedAt: 1782432001,
        },
      },
    };
    const clearedEvent: RuntimeEvent = {
      id: 'event_goal_2',
      seq: 2,
      threadId: 'thread_1',
      type: 'thread.goal_cleared',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: { cleared: true },
    };

    const withGoal = applyRuntimeEventToThread(thread, updatedEvent);
    const cleared = applyRuntimeEventToThread(withGoal, clearedEvent);

    expect(withGoal.goal).toEqual(updatedEvent.payload.goal);
    expect(cleared.goal).toBeUndefined();
  });

  it('stores and clears thread git metadata from metadata events', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const updatedEvent: RuntimeEvent = {
      id: 'event_metadata_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'thread.metadata_updated',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        gitInfo: {
          sha: 'abc123',
          branch: 'feature/swe',
          originUrl: 'git@example.com:setsuna-desktop.git',
        },
      },
    };
    const clearedEvent: RuntimeEvent = {
      id: 'event_metadata_2',
      seq: 2,
      threadId: 'thread_1',
      type: 'thread.metadata_updated',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: { gitInfo: null },
    };

    const withMetadata = applyRuntimeEventToThread(thread, updatedEvent);
    const cleared = applyRuntimeEventToThread(withMetadata, clearedEvent);

    expect(withMetadata.gitInfo).toEqual(updatedEvent.payload.gitInfo);
    expect(cleared.gitInfo).toBeNull();
  });

  it('stores thread memory mode from memory mode events', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      memoryMode: 'enabled',
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const event: RuntimeEvent = {
      id: 'event_memory_mode_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'thread.memory_mode_updated',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        mode: 'polluted',
        reason: 'external_context:mcp__search__fetch',
      },
    };

    const updated = applyRuntimeEventToThread(thread, event);

    expect(updated.memoryMode).toBe('polluted');
    expect(updated.lastSeq).toBe(1);
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
      role: 'user' as const,
      content: '<context_compaction_summary>hello</context_compaction_summary>',
      createdAt: '2026-06-26T00:00:02.000Z',
      status: 'complete' as const,
      contextCompaction: {
        autoCompactTokenLimit: 400,
        compactedMessageCount: 1,
        compactedTokens: 128,
        keptRecentMessageCount: 0,
        maxContextTokens: 256000,
        maxContextTokensK: 256,
        originalMessageCount: 1,
        originalTokens: 512,
        tokensUntilCompaction: 272,
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
      tokensUntilCompaction: 272,
      usedTokens: 128,
    });
    expect(completed.messages).toHaveLength(2);
    expect(completed.messages[0]).toMatchObject({ id: 'msg_1', visibility: 'transcript' });
    expect(completed.messages[1]).toMatchObject({ id: 'msg_compact', contextCompaction: compactedMessage.contextCompaction });
  });

  it('keeps hook runs pending until a context compaction message exists for the turn', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const started: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_compact',
      type: 'hook.started',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        id: 'hook_turn_compact_PreCompact_0',
        turnId: 'turn_compact',
        eventName: 'PreCompact',
        handlerType: 'command',
        status: 'running',
        matcher: 'manual',
      },
    };
    const completed: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_compact',
      type: 'hook.completed',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        id: 'hook_turn_compact_PreCompact_0',
        turnId: 'turn_compact',
        eventName: 'PreCompact',
        handlerType: 'command',
        status: 'completed',
        matcher: 'manual',
        entries: [{ kind: 'warning', text: 'pre compact warning' }],
      },
    };
    const compactedMessage = {
      id: 'msg_compact',
      turnId: 'turn_compact',
      role: 'user' as const,
      content: '<context_compaction_summary>hello</context_compaction_summary>',
      createdAt: '2026-06-26T00:00:03.000Z',
      status: 'complete' as const,
      contextCompaction: {
        compactedMessageCount: 1,
        compactedTokens: 128,
        keptRecentMessageCount: 0,
        maxContextTokensK: 256,
        originalMessageCount: 1,
        originalTokens: 512,
        triggerScopes: ['manual'],
      },
    };
    const compacted: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_compact',
      type: 'thread.context_compacted',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: {
        messages: [compactedMessage],
        notice: compactedMessage.contextCompaction,
      },
    };

    const pending = [started, completed].reduce(applyRuntimeEventToThread, thread);
    expect(pending.pendingHookRuns).toMatchObject([
      {
        eventName: 'PreCompact',
        status: 'completed',
        entries: [{ kind: 'warning', text: 'pre compact warning' }],
      },
    ]);

    const projected = applyRuntimeEventToThread(pending, compacted);
    expect(projected.pendingHookRuns).toBeUndefined();
    expect(projected.messages[0]).toMatchObject({
      id: 'msg_compact',
      hookRuns: [{
        eventName: 'PreCompact',
        status: 'completed',
        matcher: 'manual',
        entries: [{ kind: 'warning', text: 'pre compact warning' }],
      }],
    });
  });

  it('projects sampling step snapshots into the owning turn', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const snapshot = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      threadLastSeq: 3,
      conversationMessageIds: ['msg_user'],
      messageIds: ['msg_system', 'msg_user'],
      inputMessageIds: ['msg_user'],
      toolNames: ['read_file'],
      advertisedToolNames: ['read_file'],
      deferredToolNames: ['hidden_lookup'],
      routerToolNames: ['tool_search'],
      toolRuntimes: [{
        name: 'read_file',
        source: 'host' as const,
        exposure: 'direct' as const,
        supportsParallel: true,
        waitsForRuntimeCancellation: true,
      }],
      toolChoice: 'auto' as const,
      toolEnvironment: {
        id: 'project_1',
        cwd: '/tmp/project',
        workspaceRoot: '/tmp/project',
        workspaceRoots: ['/tmp/project'],
        repository: { kind: 'git' as const, root: '/tmp', workspacePrefix: 'project' },
      },
      selectedSkills: [{ id: 'skill_1', name: 'Skill One' }],
      mcpServerKeys: ['filesystem'],
      mcpServerCount: 1,
      permissionProfile: 'workspace-write' as const,
      sandboxWorkspaceWrite: {
        writableRoots: ['/tmp/project'],
        readableRoots: ['/tmp/project'],
        deniedRoots: ['/tmp/project/.git'],
        deniedGlobPatterns: ['**/.env'],
        networkAccess: false,
      },
      contextWindow: {
        autoCompactTokenLimit: 850,
        compactionHash: 'sha256:abc',
        compactionSummaryMessageIds: ['msg_compact'],
        estimatedTokens: 128,
        maxContextTokens: 1000,
        maxContextTokensK: 1,
        messageCount: 2,
        tokensUntilCompaction: 722,
      },
      featureKeys: ['request_permissions_tool'],
      worldState: {
        activeProviderId: 'test',
        memoryEnabled: true,
        threadMessageCount: 1,
        threadUpdatedAt: '2026-06-26T00:00:00.000Z',
      },
    };

    const projected = applyRuntimeEventToThread(thread, {
      id: 'event_step_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.step_snapshot',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: { snapshot },
    });

    expect(projected.turns?.[0]?.stepSnapshots).toEqual([{
      createdAt: '2026-06-26T00:00:01.000Z',
      snapshot,
    }]);

    const cloned = applyRuntimeEventToThread(projected, {
      id: 'event_step_2',
      seq: 2,
      threadId: 'thread_1',
      type: 'thread.updated',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: { title: 'Renamed' },
    });
    cloned.turns![0]!.stepSnapshots![0]!.snapshot.toolNames.push('mutated');
    cloned.turns![0]!.stepSnapshots![0]!.snapshot.advertisedToolNames!.push('mutated');
    cloned.turns![0]!.stepSnapshots![0]!.snapshot.deferredToolNames!.push('mutated');
    cloned.turns![0]!.stepSnapshots![0]!.snapshot.inputMessageIds!.push('mutated');
    cloned.turns![0]!.stepSnapshots![0]!.snapshot.routerToolNames!.push('mutated');
    cloned.turns![0]!.stepSnapshots![0]!.snapshot.toolRuntimes![0]!.name = 'mutated';
    cloned.turns![0]!.stepSnapshots![0]!.snapshot.contextWindow!.compactionSummaryMessageIds.push('mutated');
    cloned.turns![0]!.stepSnapshots![0]!.snapshot.toolEnvironment!.workspaceRoots!.push('/mutated');
    cloned.turns![0]!.stepSnapshots![0]!.snapshot.toolEnvironment!.repository!.workspacePrefix = 'mutated';
    expect(projected.turns?.[0]?.stepSnapshots?.[0]?.snapshot.toolNames).toEqual(['read_file']);
    expect(projected.turns?.[0]?.stepSnapshots?.[0]?.snapshot.advertisedToolNames).toEqual(['read_file']);
    expect(projected.turns?.[0]?.stepSnapshots?.[0]?.snapshot.deferredToolNames).toEqual(['hidden_lookup']);
    expect(projected.turns?.[0]?.stepSnapshots?.[0]?.snapshot.inputMessageIds).toEqual(['msg_user']);
    expect(projected.turns?.[0]?.stepSnapshots?.[0]?.snapshot.routerToolNames).toEqual(['tool_search']);
    expect(projected.turns?.[0]?.stepSnapshots?.[0]?.snapshot.toolRuntimes?.[0]?.name).toBe('read_file');
    expect(projected.turns?.[0]?.stepSnapshots?.[0]?.snapshot.contextWindow?.compactionSummaryMessageIds).toEqual(['msg_compact']);
    expect(projected.turns?.[0]?.stepSnapshots?.[0]?.snapshot.toolEnvironment?.workspaceRoots).toEqual(['/tmp/project']);
    expect(projected.turns?.[0]?.stepSnapshots?.[0]?.snapshot.toolEnvironment?.repository?.workspacePrefix).toBe('project');
  });

  it('projects item-based model stream state into the owning turn', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const events: RuntimeEvent[] = [
      {
        id: 'event_1',
        seq: 1,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.started',
        createdAt: '2026-06-26T00:00:01.000Z',
        payload: { input: 'inspect', taskKind: 'regular' },
      },
      {
        id: 'event_2',
        seq: 2,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'item.started',
        createdAt: '2026-06-26T00:00:02.000Z',
        payload: {
          item: {
            id: 'item_agent_1',
            kind: 'agent_message',
            status: 'in_progress',
            transcriptMessageId: 'msg_assistant_1',
          },
        },
      },
      {
        id: 'event_3',
        seq: 3,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'item.delta',
        createdAt: '2026-06-26T00:00:03.000Z',
        payload: { itemId: 'item_agent_1', delta: 'Hello' },
      },
      {
        id: 'event_4',
        seq: 4,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'item.completed',
        createdAt: '2026-06-26T00:00:04.000Z',
        payload: {
          item: {
            id: 'item_agent_1',
            kind: 'agent_message',
            status: 'completed',
            transcriptMessageId: 'msg_assistant_1',
          },
        },
      },
      {
        id: 'event_5',
        seq: 5,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'plan.delta',
        createdAt: '2026-06-26T00:00:05.000Z',
        payload: { itemId: 'item_plan_1', delta: '1. Inspect state.' },
      },
      {
        id: 'event_6',
        seq: 6,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'reasoning.summary_delta',
        createdAt: '2026-06-26T00:00:06.000Z',
        payload: { itemId: 'item_reasoning_1', delta: 'Thinking briefly.', summaryIndex: 0 },
      },
      {
        id: 'event_7',
        seq: 7,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'safety.buffering',
        createdAt: '2026-06-26T00:00:07.000Z',
        payload: { buffering: { model: 'slow-model', fasterModel: 'fast-model', reasons: ['policy'], showBufferingUi: true } },
      },
      {
        id: 'event_8',
        seq: 8,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'model.verification',
        createdAt: '2026-06-26T00:00:08.000Z',
        payload: { verification: { model: 'slow-model', provider: 'setsuna', warnings: ['fallback'] } },
      },
      {
        id: 'event_9',
        seq: 9,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'token.count',
        createdAt: '2026-06-26T00:00:09.000Z',
        payload: {
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          modelContextWindow: 128000,
          tokensUntilCompaction: 64000,
        },
      },
      {
        id: 'event_10',
        seq: 10,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.diff',
        createdAt: '2026-06-26T00:00:10.000Z',
        payload: { unifiedDiff: 'diff --git a/a.txt b/a.txt' },
      },
      {
        id: 'event_10b',
        seq: 11,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.diff',
        createdAt: '2026-06-26T00:00:10.100Z',
        payload: { unifiedDiff: 'diff --git a/b.txt b/b.txt' },
      },
      {
        id: 'event_10c',
        seq: 12,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.diff',
        createdAt: '2026-06-26T00:00:10.200Z',
        payload: { unifiedDiff: 'diff --git a/a.txt b/a.txt' },
      },
      {
        id: 'event_11',
        seq: 13,
        threadId: 'thread_1',
        turnId: 'turn_1',
        type: 'turn.completed',
        createdAt: '2026-06-26T00:00:11.000Z',
        payload: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      },
    ];

    const projected = events.reduce(applyRuntimeEventToThread, thread);

    expect(projected.activeTurnId).toBeNull();
    expect(projected.turns).toHaveLength(1);
    expect(projected.turns?.[0]).toMatchObject({
      id: 'turn_1',
      input: 'inspect',
      taskKind: 'regular',
      status: 'completed',
      startedAt: '2026-06-26T00:00:01.000Z',
      completedAt: '2026-06-26T00:00:11.000Z',
      diff: 'diff --git a/a.txt b/a.txt\n\ndiff --git a/b.txt b/b.txt',
      safetyBuffering: {
        model: 'slow-model',
        fasterModel: 'fast-model',
        reasons: ['policy'],
        showBufferingUi: true,
      },
      modelVerifications: [{ model: 'slow-model', provider: 'setsuna', warnings: ['fallback'] }],
      tokenCounts: [{
        createdAt: '2026-06-26T00:00:09.000Z',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        modelContextWindow: 128000,
        tokensUntilCompaction: 64000,
      }],
      items: [
        {
          id: 'item_agent_1',
          kind: 'agent_message',
          status: 'completed',
          content: 'Hello',
          transcriptMessageId: 'msg_assistant_1',
        },
        { id: 'item_plan_1', kind: 'plan', status: 'in_progress', content: '1. Inspect state.' },
        { id: 'item_reasoning_1', kind: 'reasoning', status: 'in_progress', content: 'Thinking briefly.' },
      ],
    });

    const cloned = applyRuntimeEventToThread(projected, {
      id: 'event_12',
      seq: 12,
      threadId: 'thread_1',
      type: 'thread.updated',
      createdAt: '2026-06-26T00:00:12.000Z',
      payload: { title: 'Renamed' },
    });
    cloned.turns![0]!.items[0]!.content = 'mutated';
    expect(projected.turns?.[0]?.items[0]?.content).toBe('Hello');
  });
});
