import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../src/events.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';

describe('thread event lifecycle and metadata projection', () => {
  it('projects replacement and cleared Skill metadata from message updates', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: 'Old Skill prompt',
      lastSeq: 0,
      messages: [{
        id: 'msg_1',
        role: 'user',
        content: 'Old Skill prompt',
        skillIds: ['skill_old'],
        skillReferences: [{ skillId: 'skill_old', start: 0, end: 9 }],
        createdAt: '2026-06-26T00:00:00.000Z',
        status: 'complete',
      }],
    };
    const replaced = applyRuntimeEventToThread(thread, {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'message.updated',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        messageId: 'msg_1',
        content: 'New Skill prompt',
        skillIds: ['skill_new'],
        skillReferences: [{ skillId: 'skill_new', start: 0, end: 9 }],
      },
    });

    expect(replaced.messages[0]).toMatchObject({
      content: 'New Skill prompt',
      skillIds: ['skill_new'],
      skillReferences: [{ skillId: 'skill_new', start: 0, end: 9 }],
    });

    const cleared = applyRuntimeEventToThread(replaced, {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      type: 'message.updated',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        messageId: 'msg_1',
        content: 'Plain prompt',
        skillIds: [],
        skillReferences: [],
      },
    });

    expect(cleared.messages[0]?.skillIds).toBeUndefined();
    expect(cleared.messages[0]?.skillReferences).toBeUndefined();
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
      contextCompaction: {
        status: 'running',
        turnId: 'turn_1',
        startedAt: '2026-06-26T00:00:01.500Z',
      },
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

    expect(cancelled.contextCompaction).toBeUndefined();
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

  it('prunes persisted turn items when every message for a turn is deleted', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Thread',
      createdAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
      archived: false,
      messageCount: 3,
      lastMessagePreview: 'second',
      lastSeq: 0,
      activeTurnId: 'turn_2',
      turns: [
        { id: 'turn_1', status: 'completed', items: [] },
        { id: 'turn_2', status: 'completed', items: [] },
      ],
      messages: [
        { id: 'msg_user_1', role: 'user', turnId: 'turn_1', content: 'first', createdAt: '2026-06-26T00:00:00.000Z', status: 'complete' },
        { id: 'msg_user_2', role: 'user', turnId: 'turn_2', content: 'second', createdAt: '2026-06-26T00:00:01.000Z', status: 'complete' },
        { id: 'msg_assistant_2', role: 'assistant', turnId: 'turn_2', content: 'answer', createdAt: '2026-06-26T00:00:02.000Z', status: 'complete' },
      ],
    };
    const event: RuntimeEvent = {
      id: 'event_delete',
      seq: 1,
      threadId: 'thread_1',
      type: 'messages.deleted',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: { messageIds: ['msg_user_2', 'msg_assistant_2'] },
    };

    const deleted = applyRuntimeEventToThread(thread, event);

    expect(deleted.messages.map((message) => message.id)).toEqual(['msg_user_1']);
    expect(deleted.turns?.map((turn) => turn.id)).toEqual(['turn_1']);
    expect(deleted.activeTurnId).toBeNull();
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
      queuedTurnInputs: [{
        id: 'queued_goal',
        kind: 'goal',
        input: 'Ship alignment.',
        createdAt: '2026-06-26T00:00:00.000Z',
      }],
    };
    const updatedEvent: RuntimeEvent = {
      id: 'event_goal_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'thread.goal_updated',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        queuedInputId: 'queued_goal',
        sourceMessage: {
          id: 'message_goal',
          turnId: 'turn_goal',
          role: 'user',
          inputKind: 'goal',
          content: 'Ship alignment.',
          createdAt: '2026-06-26T00:00:01.000Z',
          status: 'complete',
          attachments: [{
            id: 'goal_image',
            name: 'goal.png',
            type: 'image/png',
            size: 1,
            url: 'data:image/png;base64,AA==',
          }],
        },
        goal: {
          version: 1,
          id: 'goal_1',
          threadId: 'thread_1',
          objective: 'Ship alignment.',
          status: 'active',
          tokenBudget: 100,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: 1782432001,
          updatedAt: 1782432001,
          execution: {
            attachments: [{
              id: 'goal_image',
              name: 'goal.png',
              type: 'image/png',
              size: 1,
              url: 'data:image/png;base64,AA==',
            }],
            skillIds: ['skill_goal'],
            thinking: true,
          },
        },
      },
    };
    const accountedEvent: RuntimeEvent = {
      id: 'event_goal_accounted',
      seq: 2,
      threadId: 'thread_1',
      type: 'thread.goal_updated',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        preserveExecution: true,
        goal: {
          ...updatedEvent.payload.goal,
          execution: undefined,
          tokensUsed: 25,
          updatedAt: 1782432002,
        },
      },
    };
    const completedGoal = {
      ...updatedEvent.payload.goal,
      status: 'complete' as const,
      tokensUsed: 25,
      updatedAt: 1782432003,
    };
    const completedEvent: RuntimeEvent = {
      id: 'event_goal_completed',
      seq: 3,
      threadId: 'thread_1',
      type: 'thread.goal_updated',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: {
        preserveExecution: true,
        goal: { ...completedGoal, execution: undefined },
        lifecycleMessage: {
          id: 'message_goal_completed',
          turnId: 'turn_goal',
          role: 'developer',
          promptSource: 'goal',
          visibility: 'transcript',
          content: 'The goal is complete.',
          createdAt: '2026-06-26T00:00:03.000Z',
          status: 'complete',
          goalMode: { kind: 'complete', goal: completedGoal },
        },
      },
    };
    const clearedEvent: RuntimeEvent = {
      id: 'event_goal_2',
      seq: 4,
      threadId: 'thread_1',
      type: 'thread.goal_cleared',
      createdAt: '2026-06-26T00:00:04.000Z',
      payload: {
        cleared: true,
        lifecycleMessage: {
          id: 'message_goal_cleared',
          role: 'developer',
          promptSource: 'goal',
          visibility: 'transcript',
          content: 'The user cleared this goal.',
          createdAt: '2026-06-26T00:00:04.000Z',
          status: 'complete',
          goalMode: { kind: 'cleared', goal: updatedEvent.payload.goal },
        },
      },
    };

    const withGoal = applyRuntimeEventToThread(thread, updatedEvent);
    const accounted = applyRuntimeEventToThread(withGoal, accountedEvent);
    const completed = applyRuntimeEventToThread(accounted, completedEvent);
    const cleared = applyRuntimeEventToThread(completed, clearedEvent);

    expect(withGoal.goal).toEqual(updatedEvent.payload.goal);
    expect(withGoal.queuedTurnInputs).toEqual([]);
    expect(withGoal.messages).toEqual([
      expect.objectContaining({
        id: 'message_goal',
        inputKind: 'goal',
        content: 'Ship alignment.',
      }),
    ]);
    expect(withGoal.messageCount).toBe(1);
    expect(withGoal.lastMessagePreview).toBe('Ship alignment.');
    expect(accounted.goal).toMatchObject({
      tokensUsed: 25,
      execution: updatedEvent.payload.goal.execution,
    });
    expect(completed.goal).toMatchObject({
      status: 'complete',
      tokensUsed: 25,
      execution: updatedEvent.payload.goal.execution,
    });
    expect(completed.messages).toContainEqual(expect.objectContaining({
      id: 'message_goal_completed',
      goalMode: expect.objectContaining({ kind: 'complete' }),
    }));
    expect(completed.messageCount).toBe(2);
    expect(cleared.goal).toBeUndefined();
    expect(cleared.messages).toContainEqual(expect.objectContaining({
      id: 'message_goal_cleared',
      goalMode: expect.objectContaining({ kind: 'cleared' }),
    }));
    expect(cleared.messageCount).toBe(3);
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
});
