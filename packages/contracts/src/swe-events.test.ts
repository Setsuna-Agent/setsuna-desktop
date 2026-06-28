import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from './events.js';
import { createSweNotificationMapper, runtimeEventToSweNotifications, runtimeThreadToSweTurns } from './swe-events.js';
import type { RuntimeThread } from './threads.js';

describe('runtime AppServer SWE event mapping', () => {
  it('maps thread creation to a AppServer thread started notification', () => {
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'thread.created',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: { title: 'AppServer thread' },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([{
      method: 'thread/started',
      params: {
        thread: expect.objectContaining({
          id: 'thread_1',
          sessionId: 'thread_1',
          name: 'AppServer thread',
          status: { type: 'notLoaded' },
          source: 'appServer',
        }),
      },
    }]);
  });

  it('maps thread updates to AppServer lifecycle notifications', () => {
    const renamed: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'thread.updated',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: { title: 'Renamed thread' },
    };
    const archived: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      type: 'thread.updated',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { archived: true },
    };
    const unarchived: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      type: 'thread.updated',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { archived: false },
    };

    expect(runtimeEventToSweNotifications(renamed)).toEqual([{
      method: 'thread/name/updated',
      params: { threadId: 'thread_1', threadName: 'Renamed thread' },
    }]);
    expect(runtimeEventToSweNotifications(archived)).toEqual([{
      method: 'thread/archived',
      params: { threadId: 'thread_1' },
    }]);
    expect(runtimeEventToSweNotifications(unarchived)).toEqual([{
      method: 'thread/unarchived',
      params: { threadId: 'thread_1' },
    }]);
  });

  it('maps thread deletion to AppServer thread deleted notifications', () => {
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      type: 'thread.deleted',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {},
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([{
      method: 'thread/deleted',
      params: { threadId: 'thread_1' },
    }]);
  });

  it('maps thread goal events to AppServer goal notifications', () => {
    const goal = {
      threadId: 'thread_1',
      objective: 'Ship alignment.',
      status: 'active' as const,
      tokenBudget: 100,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 1782432001,
      updatedAt: 1782432001,
    };
    const updated: RuntimeEvent = {
      id: 'event_goal_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'thread.goal_updated',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: { goal },
    };
    const cleared: RuntimeEvent = {
      id: 'event_goal_2',
      seq: 2,
      threadId: 'thread_1',
      type: 'thread.goal_cleared',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { cleared: true },
    };
    const clearNoop: RuntimeEvent = {
      id: 'event_goal_3',
      seq: 3,
      threadId: 'thread_1',
      type: 'thread.goal_cleared',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { cleared: false },
    };

    expect(runtimeEventToSweNotifications(updated)).toEqual([{
      method: 'thread/goal/updated',
      params: { threadId: 'thread_1', turnId: 'turn_1', goal },
    }]);
    expect(runtimeEventToSweNotifications(cleared)).toEqual([{
      method: 'thread/goal/cleared',
      params: { threadId: 'thread_1' },
    }]);
    expect(runtimeEventToSweNotifications(clearNoop)).toEqual([]);
  });

  it('maps context compaction events to AppServer contextCompaction item lifecycle notifications', () => {
    const compacting: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'thread.context_compacting',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        forced: true,
        maxContextTokens: 128000,
        maxContextTokensK: 128,
        percent: 91,
        usedTokens: 116000,
      },
    };
    const compacted: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'thread.context_compacted',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        messages: [],
        notice: {
          compactedMessageCount: 20,
          compactedTokens: 1200,
          forced: true,
          keptRecentMessageCount: 4,
          maxContextTokensK: 128,
          originalMessageCount: 24,
          originalTokens: 116000,
        },
      },
    };

    expect(runtimeEventToSweNotifications(compacting)).toEqual([{
      method: 'item/started',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: { type: 'contextCompaction', id: 'turn_1:context_compaction' },
        startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
      },
    }]);
    expect(runtimeEventToSweNotifications(compacted)).toEqual([
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'contextCompaction', id: 'turn_1:context_compaction' },
          completedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        },
      },
      {
        method: 'thread/compacted',
        params: { threadId: 'thread_1', turnId: 'turn_1' },
      },
    ]);
  });

  it('maps review mode messages to AppServer item lifecycle notifications', () => {
    const entered: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_review',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_review_entered',
          turnId: 'turn_review',
          role: 'system',
          content: '',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'complete',
          visibility: 'transcript',
          reviewMode: { kind: 'entered', review: 'current changes' },
        },
      },
    };
    const exited: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_review',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        message: {
          id: 'msg_review_exited',
          turnId: 'turn_review',
          role: 'system',
          content: '',
          createdAt: '2026-06-27T00:00:01.000Z',
          status: 'complete',
          visibility: 'transcript',
          reviewMode: { kind: 'exited', review: 'No findings.' },
        },
      },
    };

    expect(runtimeEventToSweNotifications(entered)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_review',
          item: { type: 'enteredReviewMode', id: 'turn_review', review: 'current changes' },
          startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_review',
          item: { type: 'enteredReviewMode', id: 'turn_review', review: 'current changes' },
          completedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
        },
      },
    ]);
    expect(runtimeEventToSweNotifications(exited)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_review',
          item: { type: 'exitedReviewMode', id: 'turn_review', review: 'No findings.' },
          startedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_review',
          item: { type: 'exitedReviewMode', id: 'turn_review', review: 'No findings.' },
          completedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        },
      },
    ]);
  });

  it('maps turn lifecycle notifications to AppServer Turn payloads', () => {
    const mapEvent = createSweNotificationMapper();
    const started: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.started',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: { input: 'hello' },
    };
    const completed: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.completed',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: {},
    };

    expect(mapEvent(started)).toEqual([{
      method: 'thread/status/changed',
      params: {
        threadId: 'thread_1',
        status: { type: 'active', activeFlags: [] },
      },
    }, {
      method: 'turn/started',
      params: {
        threadId: 'thread_1',
        turn: {
          id: 'turn_1',
          items: [],
          itemsView: 'full',
          status: 'inProgress',
          error: null,
          startedAt: Date.parse('2026-06-27T00:00:00.000Z') / 1000,
          completedAt: null,
          durationMs: null,
        },
      },
    }]);
    expect(mapEvent(completed)).toEqual([{
      method: 'turn/completed',
      params: {
        threadId: 'thread_1',
        turn: {
          id: 'turn_1',
          items: [],
          itemsView: 'full',
          status: 'completed',
          error: null,
          startedAt: Date.parse('2026-06-27T00:00:00.000Z') / 1000,
          completedAt: Date.parse('2026-06-27T00:00:02.000Z') / 1000,
          durationMs: 2000,
        },
      },
    }, {
      method: 'thread/status/changed',
      params: {
        threadId: 'thread_1',
        status: { type: 'idle' },
      },
    }]);
  });

  it('maps cancelled turns to interrupted AppServer Turn payloads', () => {
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.cancelled',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { reason: 'user' },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([{
      method: 'turn/completed',
      params: {
        threadId: 'thread_1',
        turn: {
          id: 'turn_1',
          items: [],
          itemsView: 'full',
          status: 'interrupted',
          error: null,
          startedAt: null,
          completedAt: Date.parse('2026-06-27T00:00:02.000Z') / 1000,
          durationMs: null,
        },
      },
    }]);
  });

  it('starts agent messages on first text delta and completes them with accumulated text', () => {
    const mapEvent = createSweNotificationMapper();
    const created: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_1',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'streaming',
        },
      },
    };
    const firstDelta: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { messageId: 'msg_1', text: 'hello ' },
    };
    const secondDelta: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { messageId: 'msg_1', text: 'world' },
    };
    const completed: RuntimeEvent = {
      id: 'event_4',
      seq: 4,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-27T00:00:03.000Z',
      payload: { messageId: 'msg_1' },
    };

    expect(mapEvent(created)).toEqual([]);
    expect(mapEvent(firstDelta)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'agentMessage', id: 'msg_1', text: '', phase: null, memoryCitation: null },
          startedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        },
      },
      {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'msg_1', delta: 'hello ' },
      },
    ]);
    expect(mapEvent(secondDelta)).toEqual([
      {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'msg_1', delta: 'world' },
      },
    ]);
    expect(mapEvent(completed)).toEqual([
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'agentMessage', id: 'msg_1', text: 'hello world', phase: null, memoryCitation: null },
          completedAtMs: Date.parse('2026-06-27T00:00:03.000Z'),
        },
      },
    ]);
  });

  it('completes streaming agent messages that start with initial text', () => {
    const mapEvent = createSweNotificationMapper();
    const created: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_1',
          turnId: 'turn_1',
          role: 'assistant',
          content: 'hello ',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'streaming',
        },
      },
    };
    const delta: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { messageId: 'msg_1', text: 'world' },
    };
    const completed: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { messageId: 'msg_1' },
    };

    expect(mapEvent(created)).toEqual([{
      method: 'item/started',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: { type: 'agentMessage', id: 'msg_1', text: 'hello ', phase: null, memoryCitation: null },
        startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
      },
    }]);
    expect(mapEvent(delta)).toEqual([{
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'msg_1', delta: 'world' },
    }]);
    expect(mapEvent(completed)).toEqual([{
      method: 'item/completed',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: { type: 'agentMessage', id: 'msg_1', text: 'hello world', phase: null, memoryCitation: null },
        completedAtMs: Date.parse('2026-06-27T00:00:02.000Z'),
      },
    }]);
  });

  it('maps user messages to started items with client ids', () => {
    const event: RuntimeEvent = {
      id: 'event_user',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_user',
          clientId: 'client-user-message-1',
          turnId: 'turn_1',
          role: 'user',
          content: 'Steer this turn.',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'complete',
        },
      },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([{
      method: 'item/started',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: {
          type: 'userMessage',
          id: 'msg_user',
          clientId: 'client-user-message-1',
          content: [{ type: 'text', text: 'Steer this turn.' }],
        },
        startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
      },
    }]);
  });

  it('streams thinking tags as reasoning items before visible agent text', () => {
    const mapEvent = createSweNotificationMapper();
    const created: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_1',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'streaming',
        },
      },
    };
    const reasoningDelta: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { messageId: 'msg_1', text: '<think>plan' },
    };
    const closeReasoning: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { messageId: 'msg_1', text: '</think>' },
    };
    const answerDelta: RuntimeEvent = {
      id: 'event_4',
      seq: 4,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:03.000Z',
      payload: { messageId: 'msg_1', text: 'Done.' },
    };
    const completed: RuntimeEvent = {
      id: 'event_5',
      seq: 5,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-27T00:00:04.000Z',
      payload: { messageId: 'msg_1' },
    };

    expect(mapEvent(created)).toEqual([]);
    expect(mapEvent(reasoningDelta)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'reasoning', id: 'msg_1:reasoning', summary: [], content: [] },
          startedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        },
      },
      {
        method: 'item/reasoning/summaryTextDelta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'msg_1:reasoning', delta: 'plan', summaryIndex: 0 },
      },
    ]);
    expect(mapEvent(closeReasoning)).toEqual([]);
    expect(mapEvent(answerDelta)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'agentMessage', id: 'msg_1', text: '', phase: null, memoryCitation: null },
          startedAtMs: Date.parse('2026-06-27T00:00:03.000Z'),
        },
      },
      {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'msg_1', delta: 'Done.' },
      },
    ]);
    expect(mapEvent(completed)).toEqual([
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'reasoning', id: 'msg_1:reasoning', summary: ['plan'], content: [] },
          completedAtMs: Date.parse('2026-06-27T00:00:04.000Z'),
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'agentMessage', id: 'msg_1', text: 'Done.', phase: null, memoryCitation: null },
          completedAtMs: Date.parse('2026-06-27T00:00:04.000Z'),
        },
      },
    ]);
  });

  it('does not emit empty agent items for tool-only assistant holders', () => {
    const mapEvent = createSweNotificationMapper();
    const created: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_holder',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'streaming',
        },
      },
    };
    const completed: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { messageId: 'msg_holder' },
    };

    expect(mapEvent(created)).toEqual([]);
    expect(mapEvent(completed)).toEqual([]);
  });

  it('maps file mutation tool events to AppServer fileChange item lifecycle notifications', () => {
    const preview = JSON.stringify({
      diff: {
        path: 'src/generated.txt',
        action: 'Created',
        additions: 1,
        deletions: 0,
        truncated: false,
        lines: [{ type: 'added', content: 'generated', newLine: 1 }],
      },
    });
    const started: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.started',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        argumentsPreview: '{"file_path":"src/generated.txt"}',
        resultPreview: preview,
      },
    };
    const completed: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.completed',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        status: 'success',
        content: preview,
      },
    };

    expect(runtimeEventToSweNotifications(started)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
          item: {
            type: 'fileChange',
            id: 'call_1',
            status: 'inProgress',
            changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
          },
        },
      },
      {
        method: 'item/fileChange/patchUpdated',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
        },
      },
    ]);
    expect(runtimeEventToSweNotifications(completed)).toEqual([
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          completedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
          item: {
            type: 'fileChange',
            id: 'call_1',
            status: 'completed',
            changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
          },
        },
      },
      {
        method: 'turn/diff/updated',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          diff: 'diff --git a/src/generated.txt b/src/generated.txt\n--- /dev/null\n+++ b/src/generated.txt\n+generated',
        },
      },
    ]);
  });

  it('maps file mutation approvals to AppServer fileChange approval requests', () => {
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.requested',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        approval: {
          id: 'approval_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolCallId: 'call_1',
          toolName: 'apply_patch',
          reason: 'Review file change before applying apply_patch to src/generated.txt.',
          argumentsPreview: JSON.stringify({
            diff: {
              path: 'src/generated.txt',
              action: 'Created',
              lines: [{ type: 'added', content: 'generated' }],
            },
          }),
          status: 'pending',
          createdAt: '2026-06-27T00:00:00.000Z',
        },
      },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([
      {
        method: 'item/fileChange/patchUpdated',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
        },
      },
      {
        method: 'item/fileChange/requestApproval',
        id: 'approval_1',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'call_1',
          startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
          reason: 'Review file change before applying apply_patch to src/generated.txt.',
          grantRoot: null,
        },
      },
    ]);
  });

  it('streams file patch updates without repeating item started for the same call', () => {
    const mapEvent = createSweNotificationMapper();
    const first = toolStartedFilePreview(1, 'call_1', 'src/generated.txt', 'one');
    const second = toolStartedFilePreview(2, 'call_1', 'src/generated.txt', 'two');

    expect(mapEvent(first).map((item) => item.method)).toEqual([
      'item/started',
      'item/fileChange/patchUpdated',
    ]);
    expect(mapEvent(second)).toEqual([{
      method: 'item/fileChange/patchUpdated',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'call_1',
        changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+two' }],
      },
    }]);
  });

  it('maps shell approvals to AppServer commandExecution approval requests', () => {
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.requested',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        approval: {
          id: 'approval_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolCallId: 'call_1',
          toolName: 'run_shell_command',
          reason: 'High risk command requires approval.',
          argumentsPreview: '{"command":"git reset --hard","directory":"."}',
          status: 'pending',
          createdAt: '2026-06-27T00:00:00.000Z',
        },
      },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([{
      method: 'item/commandExecution/requestApproval',
      id: 'approval_1',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'call_1',
        startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
        approvalId: null,
        environmentId: null,
        reason: 'High risk command requires approval.',
        command: 'git reset --hard',
        cwd: '.',
        commandActions: [],
      },
    }]);
  });

  it('maps resolved approvals to AppServer server request resolved notifications', () => {
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.resolved',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        approvalId: 'approval_1',
        decision: 'approve',
      },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([{
      method: 'serverRequest/resolved',
      params: {
        threadId: 'thread_1',
        requestId: 'approval_1',
      },
    }]);
  });

  it('emits AppServer thread status changes for turn and approval activity', () => {
    const mapEvent = createSweNotificationMapper();
    const started: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.started',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: { input: 'run command' },
    };
    const requested: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.requested',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        approval: {
          id: 'approval_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolCallId: 'call_1',
          toolName: 'run_shell_command',
          reason: 'High risk command requires approval.',
          argumentsPreview: '{"command":"git status","directory":"."}',
          status: 'pending',
          createdAt: '2026-06-27T00:00:01.000Z',
        },
      },
    };
    const resolved: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'approval.resolved',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { approvalId: 'approval_1', decision: 'approve' },
    };
    const completed: RuntimeEvent = {
      id: 'event_4',
      seq: 4,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.completed',
      createdAt: '2026-06-27T00:00:03.000Z',
      payload: {},
    };

    expect(mapEvent(started)[0]).toEqual({
      method: 'thread/status/changed',
      params: { threadId: 'thread_1', status: { type: 'active', activeFlags: [] } },
    });
    expect(mapEvent(requested).at(-1)).toEqual({
      method: 'thread/status/changed',
      params: { threadId: 'thread_1', status: { type: 'active', activeFlags: ['waitingOnApproval'] } },
    });
    expect(mapEvent(resolved)).toEqual([
      {
        method: 'serverRequest/resolved',
        params: { threadId: 'thread_1', requestId: 'approval_1' },
      },
      {
        method: 'thread/status/changed',
        params: { threadId: 'thread_1', status: { type: 'active', activeFlags: [] } },
      },
    ]);
    expect(mapEvent(completed).at(-1)).toEqual({
      method: 'thread/status/changed',
      params: { threadId: 'thread_1', status: { type: 'idle' } },
    });
  });

  it('preserves shell command execution details from completed tool events', () => {
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.completed',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        status: 'success',
        content: '$ pnpm test\nexit: 0',
        argumentsPreview: '{"command":"pnpm test","directory":"."}',
        durationMs: 123,
        data: {
          process_id: 'shell_1',
          command: 'pnpm test',
          directory: '.',
          exit_code: 0,
        },
      },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([{
      method: 'item/completed',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        completedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        item: {
          type: 'commandExecution',
          id: 'call_1',
          command: 'pnpm test',
          cwd: '.',
          processId: 'shell_1',
          source: 'agent',
          status: 'completed',
          commandActions: [],
          aggregatedOutput: '$ pnpm test\nexit: 0',
          exitCode: 0,
          durationMs: 123,
        },
      },
    }]);
  });

  it('maps shell output deltas to AppServer commandExecution outputDelta notifications', () => {
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'tool.output_delta',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        stream: 'stdout',
        processId: 'shell_1',
        delta: 'hello\n',
      },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([{
      method: 'item/commandExecution/outputDelta',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'call_1',
        delta: 'hello\n',
      },
    }]);
  });

  it('aggregates turn diff updates across a AppServer SWE mapper stream', () => {
    const mapEvent = createSweNotificationMapper();
    const first = fileCompletedEvent(1, 'one.txt', 'one');
    const second = fileCompletedEvent(2, 'two.txt', 'two');

    const firstDiff = mapEvent(first).find((item) => item.method === 'turn/diff/updated');
    const secondDiff = mapEvent(second).find((item) => item.method === 'turn/diff/updated');

    expect(firstDiff).toMatchObject({
      params: { diff: expect.stringContaining('one.txt') },
    });
    expect(secondDiff).toMatchObject({
      params: {
        diff: expect.stringContaining('one.txt'),
      },
    });
    expect(secondDiff).toMatchObject({
      params: {
        diff: expect.stringContaining('two.txt'),
      },
    });
  });

  it('projects stored runtime thread history into AppServer turn items', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Stored thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:04.000Z',
      archived: false,
      messageCount: 4,
      lastMessagePreview: 'Done',
      lastSeq: 4,
      messages: [
        {
          id: 'msg_user',
          turnId: 'turn_1',
          role: 'user',
          content: 'Run tests and edit a file.',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'complete',
        },
        {
          id: 'msg_assistant_tools',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-27T00:00:01.000Z',
          status: 'complete',
          toolRuns: [
            {
              id: 'call_shell',
              name: 'run_shell_command',
              status: 'success',
              argumentsPreview: '{"command":"pnpm test","directory":"."}',
              resultPreview: '$ pnpm test\nexit: 0',
              data: { process_id: 'shell_1', command: 'pnpm test', directory: '.', exit_code: 0 },
              durationMs: 42,
            },
            {
              id: 'call_file',
              name: 'write_file',
              status: 'success',
              resultPreview: JSON.stringify({
                diff: {
                  path: 'src/generated.txt',
                  action: 'Created',
                  lines: [{ type: 'added', content: 'generated' }],
                },
              }),
            },
          ],
        },
        {
          id: 'msg_tool',
          turnId: 'turn_1',
          role: 'tool',
          toolCallId: 'call_shell',
          toolName: 'run_shell_command',
          content: '$ pnpm test\nexit: 0',
          createdAt: '2026-06-27T00:00:02.000Z',
          status: 'complete',
        },
        {
          id: 'msg_injected',
          turnId: 'turn_1',
          role: 'user',
          content: 'Hidden model-only boundary.',
          createdAt: '2026-06-27T00:00:02.500Z',
          status: 'complete',
          visibility: 'model',
        },
        {
          id: 'msg_assistant_done',
          turnId: 'turn_1',
          role: 'assistant',
          content: 'Done.',
          createdAt: '2026-06-27T00:00:03.000Z',
          completedAt: '2026-06-27T00:00:04.000Z',
          status: 'complete',
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
      id: 'turn_1',
      status: 'completed',
      items: [
        { type: 'userMessage', id: 'msg_user', content: [{ type: 'text', text: 'Run tests and edit a file.' }] },
        {
          type: 'commandExecution',
          id: 'call_shell',
          command: 'pnpm test',
          cwd: '.',
          processId: 'shell_1',
          exitCode: 0,
          durationMs: 42,
        },
        {
          type: 'fileChange',
          id: 'call_file',
          changes: [{ path: 'src/generated.txt', kind: 'add', diff: '+generated' }],
          status: 'completed',
        },
        { type: 'agentMessage', id: 'msg_assistant_done', text: 'Done.' },
      ],
    }]);
  });

  it('projects active runtime turns as in progress', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Active thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:01.000Z',
      archived: false,
      messageCount: 1,
      lastMessagePreview: '',
      lastSeq: 2,
      messages: [
        {
          id: 'msg_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'streaming',
          toolRuns: [
            {
              id: 'call_shell',
              name: 'run_shell_command',
              status: 'running',
              argumentsPreview: '{"command":"pnpm test"}',
              resultPreview: 'stdout: running\n',
            },
          ],
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
      id: 'turn_1',
      status: 'inProgress',
      completedAt: null,
      durationMs: null,
      items: [
        {
          type: 'commandExecution',
          id: 'call_shell',
          command: 'pnpm test',
          status: 'inProgress',
          aggregatedOutput: 'stdout: running\n',
        },
      ],
    }]);
  });

  it('projects compacted context summaries into the source turn without reordering retained history', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Compacted thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:04.000Z',
      archived: false,
      messageCount: 3,
      lastMessagePreview: 'Continue.',
      lastSeq: 4,
      messages: [
        {
          id: 'msg_compaction',
          turnId: 'turn_2',
          role: 'system',
          content: '<context_compaction_summary>Earlier work.</context_compaction_summary>',
          createdAt: '2026-06-27T00:00:03.000Z',
          status: 'complete',
          contextCompaction: {
            compactedMessageCount: 10,
            compactedTokens: 100,
            keptRecentMessageCount: 2,
            maxContextTokensK: 256,
            originalMessageCount: 12,
            originalTokens: 300000,
            triggerScopes: ['total'],
          },
        },
        {
          id: 'msg_retained',
          turnId: 'turn_1',
          role: 'assistant',
          content: 'Recent retained answer.',
          createdAt: '2026-06-27T00:00:01.000Z',
          status: 'complete',
        },
        {
          id: 'msg_user',
          turnId: 'turn_2',
          role: 'user',
          content: 'Continue.',
          createdAt: '2026-06-27T00:00:02.000Z',
          status: 'complete',
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)).toMatchObject([
      {
        id: 'turn_1',
        items: [{ type: 'agentMessage', id: 'msg_retained', text: 'Recent retained answer.' }],
      },
      {
        id: 'turn_2',
        items: [
          { type: 'userMessage', id: 'msg_user', content: [{ type: 'text', text: 'Continue.' }] },
          { type: 'contextCompaction', id: 'turn_2:context_compaction' },
        ],
      },
    ]);
  });

  it('projects stored review mode markers into the source turn', () => {
    const thread: RuntimeThread = {
      id: 'thread_review',
      title: 'Review thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:03.000Z',
      archived: false,
      messageCount: 4,
      lastMessagePreview: 'No findings.',
      lastSeq: 4,
      messages: [
        {
          id: 'turn_review',
          turnId: 'turn_review',
          role: 'user',
          content: 'commit 1234567: Tidy UI colors',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'complete',
        },
        {
          id: 'msg_review_entered',
          turnId: 'turn_review',
          role: 'system',
          content: '',
          createdAt: '2026-06-27T00:00:01.000Z',
          status: 'complete',
          visibility: 'transcript',
          reviewMode: { kind: 'entered', review: 'commit 1234567: Tidy UI colors' },
        },
        {
          id: 'msg_assistant',
          turnId: 'turn_review',
          role: 'assistant',
          content: 'No findings.',
          createdAt: '2026-06-27T00:00:02.000Z',
          status: 'complete',
        },
        {
          id: 'msg_review_exited',
          turnId: 'turn_review',
          role: 'system',
          content: '',
          createdAt: '2026-06-27T00:00:03.000Z',
          status: 'complete',
          visibility: 'transcript',
          reviewMode: { kind: 'exited', review: 'No findings.' },
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
      id: 'turn_review',
      items: [
        { type: 'userMessage', id: 'turn_review', content: [{ type: 'text', text: 'commit 1234567: Tidy UI colors' }] },
        { type: 'enteredReviewMode', id: 'turn_review', review: 'commit 1234567: Tidy UI colors' },
        { type: 'agentMessage', id: 'msg_assistant', text: 'No findings.' },
        { type: 'exitedReviewMode', id: 'turn_review', review: 'No findings.' },
      ],
    }]);
  });

  it('projects stored assistant thinking as reasoning before visible agent text', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Reasoning thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:02.000Z',
      archived: false,
      messageCount: 2,
      lastMessagePreview: 'Done.',
      lastSeq: 2,
      messages: [
        {
          id: 'msg_user',
          turnId: 'turn_1',
          role: 'user',
          content: 'Explain.',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'complete',
        },
        {
          id: 'msg_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: '<think>plan</think>Done.',
          createdAt: '2026-06-27T00:00:01.000Z',
          completedAt: '2026-06-27T00:00:02.000Z',
          status: 'complete',
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
      id: 'turn_1',
      status: 'completed',
      items: [
        { type: 'userMessage', id: 'msg_user', content: [{ type: 'text', text: 'Explain.' }] },
        { type: 'reasoning', id: 'msg_assistant:reasoning', summary: ['plan'], content: [] },
        { type: 'agentMessage', id: 'msg_assistant', text: 'Done.' },
      ],
    }]);
  });
});

function fileCompletedEvent(seq: number, path: string, line: string): RuntimeEvent {
  return {
    id: `event_${seq}`,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'tool.completed',
    createdAt: '2026-06-27T00:00:01.000Z',
    payload: {
      toolCallId: `call_${seq}`,
      toolName: 'write_file',
      status: 'success',
      content: JSON.stringify({
        diff: {
          path,
          action: 'Created',
          additions: 1,
          deletions: 0,
          truncated: false,
          lines: [{ type: 'added', content: line, newLine: 1 }],
        },
      }),
    },
  };
}

function toolStartedFilePreview(seq: number, callId: string, path: string, line: string): RuntimeEvent {
  return {
    id: `event_${seq}`,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'tool.started',
    createdAt: '2026-06-27T00:00:00.000Z',
    payload: {
      toolCallId: callId,
      toolName: 'write_file',
      argumentsPreview: '{"file_path":"src/generated.txt"}',
      resultPreview: JSON.stringify({
        diff: {
          path,
          action: 'Created',
          additions: 1,
          deletions: 0,
          truncated: false,
          lines: [{ type: 'added', content: line, newLine: 1 }],
        },
      }),
    },
  };
}
