import { describe, expect, it } from 'vitest';
import { applyRuntimeEventToThread } from './thread-events.js';
import type { RuntimeEvent } from './events.js';
import type { RuntimeThread } from './threads.js';

describe('applyRuntimeEventToThread context compaction', () => {
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
        status: 'rejected',
        resultPreview: 'partial output',
        completedAt: '2026-06-26T00:00:03.000Z',
      }),
      expect.objectContaining({
        id: 'call_approval',
        status: 'rejected',
        approvalStatus: 'rejected',
        approvalMessage: 'Stopped after restart.',
        resultPreview: 'Stopped after restart.',
        completedAt: '2026-06-26T00:00:03.000Z',
      }),
    ]);
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
    expect(completed.messages).toHaveLength(2);
    expect(completed.messages[0]).toMatchObject({ id: 'msg_1', visibility: 'transcript' });
    expect(completed.messages[1]).toMatchObject({ id: 'msg_compact', contextCompaction: compactedMessage.contextCompaction });
  });
});
