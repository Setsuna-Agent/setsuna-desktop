import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from './events.js';
import {
  createSweNotificationMapper,
  filterSweNotificationsForClientCapabilities,
  runtimeEventToSweNotifications,
  runtimeThreadToSweTurns,
} from './swe-events.js';
import type { SweNotification } from './swe-events.js';
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

  it('does not publish model-only messages to AppServer clients', () => {
    const event: RuntimeEvent = {
      id: 'event_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: {
        message: {
          id: 'msg_hidden',
          turnId: 'turn_1',
          role: 'user',
          content: '<turn_aborted>\nhidden control message\n</turn_aborted>',
          createdAt: '2026-06-27T00:00:02.000Z',
          status: 'complete',
          visibility: 'model',
        },
      },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([]);
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

  it('maps streaming agent message memory citations onto the completed item', () => {
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
    const delta: RuntimeEvent = {
      id: 'event_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { messageId: 'msg_1', text: 'answer' },
    };
    const completed: RuntimeEvent = {
      id: 'event_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: {
        messageId: 'msg_1',
        memoryCitation: {
          entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'summary' }],
          rolloutIds: ['thread_a'],
        },
      },
    };

    expect(mapEvent(created)).toEqual([]);
    expect(mapEvent(delta)).toHaveLength(2);
    expect(mapEvent(completed)).toEqual([
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: {
            type: 'agentMessage',
            id: 'msg_1',
            text: 'answer',
            phase: null,
            memoryCitation: {
              entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 2, note: 'summary' }],
              rolloutIds: ['thread_a'],
            },
          },
          completedAtMs: Date.parse('2026-06-27T00:00:02.000Z'),
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

  it('maps request_permissions approvals to AppServer permission approval requests', () => {
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
          toolCallId: 'call_permissions',
          toolName: 'request_permissions',
          reason: 'Additional permissions requested: network access; writable roots: /work/tmp.',
          argumentsPreview: '{}',
          permissionApprovalContext: {
            environmentId: 'project_1',
            cwd: '/work',
            reason: 'Need network and temp write access.',
            requestedPermissions: {
              network: { enabled: true },
              file_system: {
                read: ['/work/readonly'],
                write: ['/work/tmp'],
                glob_scan_max_depth: 4,
                entries: [
                  { path: { type: 'glob_pattern', pattern: '**/*.env' }, access: 'deny' },
                  { path: { type: 'special', value: { kind: 'project_roots', subpath: 'tmp' } }, access: 'write' },
                ],
              },
            },
            grantedPermissions: {},
            availableScopes: ['turn', 'session'],
          },
          status: 'pending',
          createdAt: '2026-06-27T00:00:00.000Z',
        },
      },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([{
      method: 'item/permissions/requestApproval',
      id: 'approval_1',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'call_permissions',
        environmentId: 'project_1',
        startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
        cwd: '/work',
        reason: 'Need network and temp write access.',
        permissions: {
          network: { enabled: true },
          fileSystem: {
            read: ['/work/readonly'],
            write: ['/work/tmp'],
            globScanMaxDepth: 4,
            entries: [
              { path: { type: 'globPattern', pattern: '**/*.env' }, access: 'deny' },
              { path: { type: 'special', value: { kind: 'project_roots', subpath: 'tmp' } }, access: 'write' },
            ],
          },
        },
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
        networkApprovalContext: null,
        command: 'git reset --hard',
        cwd: '.',
        commandActions: [{ type: 'unknown', command: 'git reset --hard' }],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: null,
      },
    }]);
  });

  it('maps Codex policy proposal fields on shell approval requests', () => {
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
          toolName: 'exec_command',
          reason: 'Network access requires approval.',
          argumentsPreview: '{"cmd":"curl https://api.example.com/health","workdir":"/work"}',
          proposedExecPolicyAmendment: ['curl'],
          networkApprovalContext: {
            host: 'api.example.com',
            protocol: 'https',
            port: 443,
            target: 'https://api.example.com/health',
          },
          proposedNetworkPolicyAmendments: [{ host: 'api.example.com', action: 'allow' }],
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
        reason: 'Network access requires approval.',
        networkApprovalContext: { host: 'api.example.com', protocol: 'https' },
        command: 'curl https://api.example.com/health',
        cwd: '/work',
        commandActions: [{ type: 'unknown', command: 'curl https://api.example.com/health' }],
        proposedExecpolicyAmendment: ['curl'],
        proposedNetworkPolicyAmendments: [{ host: 'api.example.com', action: 'allow' }],
      },
    }]);
  });

  it('maps best-effort shell command actions on command approvals', () => {
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
          toolName: 'exec_command',
          reason: 'Command requires approval.',
          argumentsPreview: '{"cmd":"rg TODO src && cat README.md","workdir":"/work"}',
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
        reason: 'Command requires approval.',
        networkApprovalContext: null,
        command: 'rg TODO src && cat README.md',
        cwd: '/work',
        commandActions: [
          { type: 'search', command: 'rg TODO src', query: 'TODO', path: 'src' },
          { type: 'read', command: 'cat README.md', name: 'README.md', path: '/work/README.md' },
        ],
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: null,
      },
    }]);
  });

  it('maps Codex available command approval decisions', () => {
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
          toolName: 'exec_command',
          environmentId: 'project_1',
          reason: 'Command requires approval.',
          argumentsPreview: '{"cmd":"git status","workdir":"/work"}',
          additionalPermissions: {
            network: { enabled: true },
            file_system: {
              read: ['/work/readonly'],
              write: ['/work/tmp'],
              glob_scan_max_depth: 3,
              entries: [{ path: { type: 'glob_pattern', pattern: '/work/**/*.env' }, access: 'deny' }],
            },
          },
          availableDecisions: [
            { type: 'approve' },
            { type: 'approve_for_turn_with_strict_auto_review' },
            { type: 'approve_for_session' },
            { type: 'approve_persistently' },
            { type: 'approve_exec_policy_amendment', proposedExecPolicyAmendment: ['git', 'status'] },
            { type: 'approve_network_policy_amendment', networkPolicyAmendment: { host: 'api.example.com', action: 'deny' } },
            { type: 'reject' },
            { type: 'cancel' },
          ],
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
        environmentId: 'project_1',
        reason: 'Command requires approval.',
        networkApprovalContext: null,
        command: 'git status',
        cwd: '/work',
        commandActions: [{ type: 'unknown', command: 'git status' }],
        additionalPermissions: {
          network: { enabled: true },
          fileSystem: {
            read: ['/work/readonly'],
            write: ['/work/tmp'],
            globScanMaxDepth: 3,
            entries: [{ path: { type: 'globPattern', pattern: '/work/**/*.env' }, access: 'deny' }],
          },
        },
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: null,
        availableDecisions: [
          'accept',
          'acceptForSession',
          'acceptAndRemember',
          { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } },
          { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'api.example.com', action: 'deny' } } },
          'decline',
          'cancel',
        ],
      },
    }]);
  });

  it('strips experimental command approval fields unless the client enabled experimentalApi', () => {
    const notification: SweNotification = {
      method: 'item/commandExecution/requestApproval',
      id: 'approval_1',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        itemId: 'call_1',
        startedAtMs: Date.parse('2026-06-27T00:00:00.000Z'),
        approvalId: null,
        environmentId: 'project_1',
        reason: 'Need extra access.',
        networkApprovalContext: null,
        command: 'cat README.md',
        cwd: '/work',
        commandActions: [{ type: 'read', command: 'cat README.md', name: 'README.md', path: '/work/README.md' }],
        additionalPermissions: {
          network: { enabled: true },
          fileSystem: { read: ['/work/allowed'] },
        },
        proposedExecpolicyAmendment: null,
        proposedNetworkPolicyAmendments: null,
      },
    };

    const stripped = filterSweNotificationsForClientCapabilities([notification]);
    const experimental = filterSweNotificationsForClientCapabilities([notification], { experimentalApi: true });

    expect(stripped).toEqual([{
      ...notification,
      params: expect.not.objectContaining({
        additionalPermissions: expect.anything(),
      }),
    }]);
    expect(experimental).toEqual([notification]);
    expect(notification.params.additionalPermissions).toEqual({
      network: { enabled: true },
      fileSystem: { read: ['/work/allowed'] },
    });
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
          commandActions: [{ type: 'unknown', command: 'pnpm test' }],
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

  it('maps mailbox deliveries to AppServer collabToolCall lifecycle notifications', () => {
    const event: RuntimeEvent = {
      id: 'event_mailbox_1',
      seq: 1,
      threadId: 'thread_parent',
      turnId: 'turn_parent',
      type: 'mailbox.delivered',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        id: 'mail_1',
        content: 'child agent found a regression',
        deliveryMode: 'queue_only',
        fromAgentId: 'agent_child',
        fromThreadId: 'thread_child',
        toAgentId: 'agent_parent',
      },
    };

    expect(runtimeEventToSweNotifications(event)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_parent',
          turnId: 'turn_parent',
          item: {
            type: 'collabToolCall',
            id: 'mailbox_mail_1',
            tool: 'send_input',
            status: 'inProgress',
            senderThreadId: 'thread_child',
            receiverThreadId: 'thread_parent',
            prompt: 'child agent found a regression',
          },
          startedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_parent',
          turnId: 'turn_parent',
          item: {
            type: 'collabToolCall',
            id: 'mailbox_mail_1',
            tool: 'send_input',
            status: 'completed',
            senderThreadId: 'thread_child',
            receiverThreadId: 'thread_parent',
            prompt: 'child agent found a regression',
          },
          completedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        },
      },
    ]);
  });

  it('maps item-based plan and reasoning stream events to AppServer item notifications', () => {
    const mapEvent = createSweNotificationMapper();
    const planDelta: RuntimeEvent = {
      id: 'event_plan_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'plan.delta',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { itemId: 'plan_1', delta: '1. Inspect\n' },
    };
    const reasoningDelta: RuntimeEvent = {
      id: 'event_reasoning_1',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'reasoning.raw_delta',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { itemId: 'reasoning_1', delta: 'Need evidence.', contentIndex: 0 },
    };

    expect(mapEvent(planDelta)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'plan', id: 'plan_1', text: '' },
          startedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        },
      },
      {
        method: 'item/plan/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'plan_1', delta: '1. Inspect\n' },
      },
    ]);
    expect(mapEvent(reasoningDelta)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'reasoning', id: 'reasoning_1', summary: [], content: [] },
          startedAtMs: Date.parse('2026-06-27T00:00:02.000Z'),
        },
      },
      {
        method: 'item/reasoning/textDelta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'reasoning_1', delta: 'Need evidence.', contentIndex: 0 },
      },
    ]);
  });

  it('maps Plan mode message completion to the authoritative AppServer plan item', () => {
    const mapEvent = createSweNotificationMapper();
    const created: RuntimeEvent = {
      id: 'event_plan_msg_created',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_plan',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'streaming',
          planMode: { mode: 'plan', status: 'awaiting_confirmation' },
        },
      },
    };
    const planDelta: RuntimeEvent = {
      id: 'event_plan_delta',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'plan.delta',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { itemId: 'plan_1', delta: '1. Inspect\n' },
    };
    const mirroredMessageDelta: RuntimeEvent = {
      id: 'event_plan_msg_delta',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { messageId: 'msg_plan', text: '1. Inspect\n' },
    };
    const completed: RuntimeEvent = {
      id: 'event_plan_completed',
      seq: 4,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-27T00:00:03.000Z',
      payload: {
        messageId: 'msg_plan',
        content: '1. Inspect\n',
        planMode: { mode: 'plan', status: 'awaiting_confirmation' },
      },
    };

    expect(mapEvent(created)).toEqual([]);
    expect(mapEvent(planDelta)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'plan', id: 'plan_1', text: '' },
          startedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
        },
      },
      {
        method: 'item/plan/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'plan_1', delta: '1. Inspect\n' },
      },
    ]);
    expect(mapEvent(mirroredMessageDelta)).toEqual([]);
    expect(mapEvent(completed)).toEqual([
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'plan', id: 'plan_1', text: '1. Inspect\n', status: 'awaiting_confirmation' },
          completedAtMs: Date.parse('2026-06-27T00:00:03.000Z'),
        },
      },
    ]);
  });

  it('maps Plan mode text deltas and later status decisions onto plan items', () => {
    const mapEvent = createSweNotificationMapper();
    const started: RuntimeEvent = {
      id: 'event_turn_started',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.started',
      createdAt: '2026-06-27T00:00:00.000Z',
      payload: { input: 'Plan first.', taskKind: 'regular' },
    };
    const created: RuntimeEvent = {
      id: 'event_plan_msg_created',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        message: {
          id: 'msg_plan',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-27T00:00:01.000Z',
          status: 'streaming',
          planMode: { mode: 'plan', status: 'awaiting_confirmation' },
        },
      },
    };
    const delta: RuntimeEvent = {
      id: 'event_plan_msg_delta',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { messageId: 'msg_plan', text: '1. Inspect first.' },
    };
    const completed: RuntimeEvent = {
      id: 'event_plan_completed',
      seq: 4,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-27T00:00:03.000Z',
      payload: {
        messageId: 'msg_plan',
        content: '1. Inspect first.',
        planMode: { mode: 'plan', status: 'awaiting_confirmation' },
      },
    };
    const turnCompleted: RuntimeEvent = {
      id: 'event_turn_completed',
      seq: 5,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.completed',
      createdAt: '2026-06-27T00:00:04.000Z',
      payload: { taskKind: 'regular' },
    };
    const accepted: RuntimeEvent = {
      id: 'event_plan_accepted',
      seq: 6,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.plan_mode_updated',
      createdAt: '2026-06-27T00:00:05.000Z',
      payload: {
        messageId: 'msg_plan',
        planMode: { mode: 'plan', status: 'accepted' },
      },
    };

    expect(mapEvent(started).map((item) => item.method)).toEqual(['thread/status/changed', 'turn/started']);
    expect(mapEvent(created)).toEqual([]);
    expect(mapEvent(delta)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'plan', id: 'msg_plan', text: '' },
          startedAtMs: Date.parse('2026-06-27T00:00:02.000Z'),
        },
      },
      {
        method: 'item/plan/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'msg_plan', delta: '1. Inspect first.' },
      },
    ]);
    expect(mapEvent(completed)).toEqual([
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'plan', id: 'msg_plan', text: '1. Inspect first.', status: 'awaiting_confirmation' },
          completedAtMs: Date.parse('2026-06-27T00:00:03.000Z'),
        },
      },
    ]);
    expect(mapEvent(turnCompleted).map((item) => item.method)).toEqual(['turn/completed', 'thread/status/changed']);
    expect(mapEvent(accepted)).toEqual([
      {
        method: 'item/completed',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'plan', id: 'msg_plan', text: '1. Inspect first.', status: 'accepted' },
          completedAtMs: Date.parse('2026-06-27T00:00:05.000Z'),
        },
      },
    ]);
  });

  it('maps generic runtime stream items through AppServer item lifecycle notifications', () => {
    const mapEvent = createSweNotificationMapper();
    const started: RuntimeEvent = {
      id: 'event_item_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'item.started',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: { item: { id: 'agent_item_1', kind: 'agent_message', status: 'in_progress' } },
    };
    const delta: RuntimeEvent = {
      id: 'event_item_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'item.delta',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { itemId: 'agent_item_1', delta: 'Hello from item stream.' },
    };
    const completed: RuntimeEvent = {
      id: 'event_item_3',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'item.completed',
      createdAt: '2026-06-27T00:00:03.000Z',
      payload: { item: { id: 'agent_item_1', kind: 'agent_message', content: 'Hello from item stream.', status: 'completed' } },
    };

    expect(mapEvent(started)).toEqual([{
      method: 'item/started',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: { type: 'agentMessage', id: 'agent_item_1', text: '', phase: null, memoryCitation: null },
        startedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
      },
    }]);
    expect(mapEvent(delta)).toEqual([{
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'agent_item_1', delta: 'Hello from item stream.' },
    }]);
    expect(mapEvent(completed)).toEqual([{
      method: 'item/completed',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: { type: 'agentMessage', id: 'agent_item_1', text: 'Hello from item stream.', phase: null, memoryCitation: null },
        completedAtMs: Date.parse('2026-06-27T00:00:03.000Z'),
      },
    }]);
  });

  it('maps runtime collab tool call stream items through AppServer item lifecycle notifications', () => {
    const mapEvent = createSweNotificationMapper();
    const started: RuntimeEvent = {
      id: 'event_collab_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'item.started',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        item: {
          id: 'collab_1',
          kind: 'collab_tool_call',
          status: 'in_progress',
          collabToolCall: {
            tool: 'spawn_agent',
            senderThreadId: 'thread_parent',
            newThreadId: 'thread_child',
            prompt: 'Inspect auth',
          },
        },
      },
    };
    const completed: RuntimeEvent = {
      id: 'event_collab_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'item.completed',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: {
        item: {
          id: 'collab_1',
          kind: 'collab_tool_call',
          status: 'completed',
          collabToolCall: {
            tool: 'spawn_agent',
            senderThreadId: 'thread_parent',
            newThreadId: 'thread_child',
            prompt: 'Inspect auth',
            agentStatus: 'completed',
          },
        },
      },
    };

    expect(mapEvent(started)).toEqual([{
      method: 'item/started',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: {
          type: 'collabToolCall',
          id: 'collab_1',
          tool: 'spawn_agent',
          status: 'inProgress',
          senderThreadId: 'thread_parent',
          newThreadId: 'thread_child',
          prompt: 'Inspect auth',
        },
        startedAtMs: Date.parse('2026-06-27T00:00:01.000Z'),
      },
    }]);
    expect(mapEvent(completed)).toEqual([{
      method: 'item/completed',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        item: {
          type: 'collabToolCall',
          id: 'collab_1',
          tool: 'spawn_agent',
          status: 'completed',
          senderThreadId: 'thread_parent',
          newThreadId: 'thread_child',
          prompt: 'Inspect auth',
          agentStatus: 'completed',
        },
        completedAtMs: Date.parse('2026-06-27T00:00:02.000Z'),
      },
    }]);
  });

  it('does not duplicate transcript deltas once canonical stream items own a message', () => {
    const mapEvent = createSweNotificationMapper();
    const started: RuntimeEvent = {
      id: 'event_item_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'item.started',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        item: {
          id: 'msg_assistant',
          kind: 'agent_message',
          status: 'in_progress',
          transcriptMessageId: 'msg_assistant',
        },
      },
    };
    const itemDelta: RuntimeEvent = {
      id: 'event_item_2',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'item.delta',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { itemId: 'msg_assistant', delta: 'Hello' },
    };
    const messageDelta: RuntimeEvent = {
      id: 'event_msg_1',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt: '2026-06-27T00:00:03.000Z',
      payload: { messageId: 'msg_assistant', text: 'Hello' },
    };
    const completed: RuntimeEvent = {
      id: 'event_item_3',
      seq: 4,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'item.completed',
      createdAt: '2026-06-27T00:00:04.000Z',
      payload: {
        item: {
          id: 'msg_assistant',
          kind: 'agent_message',
          content: 'Hello',
          status: 'completed',
          transcriptMessageId: 'msg_assistant',
        },
      },
    };
    const messageCompleted: RuntimeEvent = {
      id: 'event_msg_2',
      seq: 5,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-27T00:00:05.000Z',
      payload: { messageId: 'msg_assistant' },
    };

    const notifications = [
      ...mapEvent(started),
      ...mapEvent(itemDelta),
      ...mapEvent(messageDelta),
      ...mapEvent(completed),
      ...mapEvent(messageCompleted),
    ];

    expect(notifications.filter((item) => item.method === 'item/agentMessage/delta')).toEqual([
      {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread_1', turnId: 'turn_1', itemId: 'msg_assistant', delta: 'Hello' },
      },
    ]);
    expect(notifications.filter((item) => item.method === 'item/completed')).toHaveLength(1);
  });

  it('maps model safety, verification, token count, and explicit turn diff notifications', () => {
    const mapEvent = createSweNotificationMapper();
    const stepSnapshot = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      threadLastSeq: 3,
      conversationMessageIds: ['msg_user'],
      messageIds: ['msg_system', 'msg_user'],
      toolNames: ['read_file'],
      toolRuntimes: [{
        name: 'read_file',
        source: 'host' as const,
        exposure: 'direct' as const,
        supportsParallel: true,
        waitsForRuntimeCancellation: true,
      }],
      toolChoice: 'auto' as const,
      toolEnvironment: { id: 'project_1', cwd: '/tmp/project' },
      selectedSkills: [],
      mcpServerKeys: ['filesystem'],
      mcpServerCount: 1,
      permissionProfile: 'workspace-write' as const,
      featureKeys: ['request_permissions_tool'],
      worldState: {
        activeProviderId: 'test',
        memoryEnabled: true,
        threadMessageCount: 1,
        threadUpdatedAt: '2026-06-27T00:00:00.000Z',
      },
    };
    const snapshot: RuntimeEvent = {
      id: 'event_snapshot_1',
      seq: 0,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.step_snapshot',
      createdAt: '2026-06-27T00:00:00.500Z',
      payload: { snapshot: stepSnapshot },
    };
    const safety: RuntimeEvent = {
      id: 'event_safety_1',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'safety.buffering',
      createdAt: '2026-06-27T00:00:01.000Z',
      payload: {
        buffering: {
          model: 'current-model',
          fasterModel: 'faster-model',
          reasons: ['user_risk'],
          showBufferingUi: true,
          useCases: ['cyber'],
        },
      },
    };
    const verification: RuntimeEvent = {
      id: 'event_verification_1',
      seq: 2,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'model.verification',
      createdAt: '2026-06-27T00:00:02.000Z',
      payload: { verification: { model: 'current-model', provider: 'setsuna', warnings: ['fallback'] } },
    };
    const tokenCount: RuntimeEvent = {
      id: 'event_tokens_1',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'token.count',
      createdAt: '2026-06-27T00:00:03.000Z',
      payload: { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, modelContextWindow: 128000 },
    };
    const reasoningSummaryPart: RuntimeEvent = {
      id: 'event_reasoning_summary_part_1',
      seq: 4,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'reasoning.summary_part_added',
      createdAt: '2026-06-27T00:00:03.500Z',
      payload: { itemId: 'reasoning_1', summaryIndex: 2 },
    };
    const diff: RuntimeEvent = {
      id: 'event_diff_1',
      seq: 5,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.diff',
      createdAt: '2026-06-27T00:00:04.000Z',
      payload: { unifiedDiff: 'diff --git a/a.txt b/a.txt' },
    };

    const mappedSnapshot = mapEvent(snapshot);
    expect(mappedSnapshot).toEqual([{
      method: 'turn/stepSnapshot/updated',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        stepSnapshot: {
          createdAtMs: 1782518400500,
          snapshot: stepSnapshot,
        },
      },
    }]);
    const mappedStepSnapshot = mappedSnapshot[0];
    if (mappedStepSnapshot?.method !== 'turn/stepSnapshot/updated') throw new Error('expected a step snapshot notification');
    mappedStepSnapshot.params.stepSnapshot.snapshot.toolRuntimes![0]!.name = 'mutated';
    expect(stepSnapshot.toolRuntimes[0]!.name).toBe('read_file');
    expect(mapEvent(safety)).toEqual([{
      method: 'model/safetyBuffering/updated',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        model: 'current-model',
        useCases: ['cyber'],
        reasons: ['user_risk'],
        showBufferingUi: true,
        fasterModel: 'faster-model',
      },
    }]);
    expect(mapEvent(verification)).toEqual([{
      method: 'model/verification',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        verifications: [{ model: 'current-model', provider: 'setsuna', warnings: ['fallback'] }],
      },
    }]);
    expect(mapEvent(reasoningSummaryPart)).toEqual([
      {
        method: 'item/started',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          item: { type: 'reasoning', id: 'reasoning_1', summary: [], content: [] },
          startedAtMs: 1782518403500,
        },
      },
      {
        method: 'item/reasoning/summaryPartAdded',
        params: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          itemId: 'reasoning_1',
          summaryIndex: 2,
        },
      },
    ]);
    expect(mapEvent(tokenCount)).toEqual([{
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread_1',
        turnId: 'turn_1',
        tokenUsage: {
          total: {
            totalTokens: 15,
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 15,
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 128000,
        },
      },
    }]);
    expect(mapEvent(diff)).toEqual([{
      method: 'turn/diff/updated',
      params: { threadId: 'thread_1', turnId: 'turn_1', diff: 'diff --git a/a.txt b/a.txt' },
    }]);
  });

  it('aggregates turn diff updates across a AppServer SWE mapper stream', () => {
    const mapEvent = createSweNotificationMapper();
    const first = fileCompletedEvent(1, 'one.txt', 'one');
    const second = fileCompletedEvent(2, 'two.txt', 'two');
    const duplicateExplicitDiff: RuntimeEvent = {
      id: 'event_duplicate_diff',
      seq: 3,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.diff',
      createdAt: '2026-06-27T00:00:03.000Z',
      payload: { unifiedDiff: 'diff --git a/one.txt b/one.txt\n--- /dev/null\n+++ b/one.txt\n+one' },
    };

    const firstDiff = mapEvent(first).find((item) => item.method === 'turn/diff/updated');
    const secondDiff = mapEvent(second).find((item) => item.method === 'turn/diff/updated');
    const duplicateDiff = mapEvent(duplicateExplicitDiff).find((item) => item.method === 'turn/diff/updated');

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
    const duplicateText = duplicateDiff?.params && 'diff' in duplicateDiff.params ? duplicateDiff.params.diff : '';
    expect(duplicateText.match(/diff --git a\/one\.txt b\/one\.txt/g)).toHaveLength(1);
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

  it('projects persisted runtime turn stream items ahead of transcript fallbacks', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Stored item stream thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:05.000Z',
      archived: false,
      messageCount: 2,
      lastMessagePreview: 'Hello from item stream.',
      lastSeq: 8,
      turns: [
        {
          id: 'turn_1',
          input: 'stream using response items',
          startedAt: '2026-06-27T00:00:00.000Z',
          completedAt: '2026-06-27T00:00:05.000Z',
          status: 'completed',
          diff: 'diff --git a/a.txt b/a.txt',
          items: [
            { id: 'plan_item_1', kind: 'plan', status: 'completed', content: '1. Inspect state.' },
            { id: 'reasoning_item_1', kind: 'reasoning', status: 'completed', content: 'Need context.' },
            {
              id: 'agent_item_1',
              kind: 'agent_message',
              status: 'completed',
              content: 'Hello from item stream.',
              transcriptMessageId: 'msg_assistant',
            },
          ],
          modelVerifications: [{ model: 'current-model', provider: 'setsuna', warnings: ['fallback'] }],
          safetyBuffering: {
            model: 'current-model',
            fasterModel: 'fast-model',
            reasons: ['policy'],
            showBufferingUi: true,
            useCases: ['cyber'],
          },
          stepSnapshots: [{
            createdAt: '2026-06-27T00:00:00.500Z',
            snapshot: {
              threadId: 'thread_1',
              turnId: 'turn_1',
              threadLastSeq: 8,
              conversationMessageIds: ['msg_user'],
              messageIds: ['msg_user', 'msg_assistant'],
              toolNames: ['run_shell_command'],
              toolChoice: 'auto',
              toolEnvironment: { id: 'project_1', cwd: '/tmp/project' },
              selectedSkills: [],
              mcpServerKeys: [],
              mcpServerCount: 0,
              permissionProfile: 'workspace-write',
              featureKeys: [],
              worldState: {
                threadMessageCount: 2,
                threadUpdatedAt: '2026-06-27T00:00:05.000Z',
              },
            },
          }],
          tokenCounts: [{
            createdAt: '2026-06-27T00:00:04.000Z',
            usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
            modelContextWindow: 128000,
            tokensUntilCompaction: 64000,
          }],
        },
      ],
      messages: [
        {
          id: 'msg_user',
          turnId: 'turn_1',
          role: 'user',
          content: 'stream using response items',
          createdAt: '2026-06-27T00:00:01.000Z',
          status: 'complete',
        },
        {
          id: 'msg_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: 'Hello from item stream.',
          createdAt: '2026-06-27T00:00:02.000Z',
          completedAt: '2026-06-27T00:00:05.000Z',
          status: 'complete',
          toolRuns: [{
            id: 'call_shell',
            name: 'run_shell_command',
            status: 'success',
            argumentsPreview: '{"command":"pnpm test"}',
            resultPreview: '$ pnpm test\nexit: 0',
            data: { process_id: 'shell_1', command: 'pnpm test', directory: '.', exit_code: 0 },
          }],
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)).toMatchObject([{
      id: 'turn_1',
      status: 'completed',
      startedAt: 1782518400,
      completedAt: 1782518405,
      diff: 'diff --git a/a.txt b/a.txt',
      modelVerifications: [{ model: 'current-model', provider: 'setsuna', warnings: ['fallback'] }],
      safetyBuffering: {
        model: 'current-model',
        fasterModel: 'fast-model',
        reasons: ['policy'],
        showBufferingUi: true,
        useCases: ['cyber'],
      },
      stepSnapshots: [{
        createdAtMs: 1782518400500,
        snapshot: {
          threadId: 'thread_1',
          turnId: 'turn_1',
          toolNames: ['run_shell_command'],
          toolEnvironment: { id: 'project_1', cwd: '/tmp/project' },
        },
      }],
      tokenCounts: [{
        createdAtMs: 1782518404000,
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        modelContextWindow: 128000,
        tokensUntilCompaction: 64000,
      }],
      items: [
        { type: 'userMessage', id: 'msg_user', content: [{ type: 'text', text: 'stream using response items' }] },
        { type: 'plan', id: 'plan_item_1', text: '1. Inspect state.' },
        { type: 'reasoning', id: 'reasoning_item_1', summary: ['Need context.'] },
        { type: 'agentMessage', id: 'agent_item_1', text: 'Hello from item stream.' },
        { type: 'commandExecution', id: 'call_shell', command: 'pnpm test', processId: 'shell_1' },
      ],
    }]);
    const items = runtimeThreadToSweTurns(thread)[0]?.items ?? [];
    expect(items.filter((item) => item.id === 'msg_assistant')).toEqual([]);
  });

  it('merges tool result data into persisted stream tool call items', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Stored dynamic tool item thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:04.000Z',
      archived: false,
      messageCount: 2,
      lastMessagePreview: 'Done.',
      lastSeq: 6,
      turns: [{
        id: 'turn_1',
        startedAt: '2026-06-27T00:00:00.000Z',
        completedAt: '2026-06-27T00:00:04.000Z',
        status: 'completed',
        items: [{
          id: 'call_dynamic',
          kind: 'tool_call',
          status: 'completed',
          toolCall: { id: 'call_dynamic', name: 'tickets__lookup_ticket', arguments: '{"id":"ABC-123"}' },
        }],
      }],
      messages: [
        {
          id: 'msg_user',
          turnId: 'turn_1',
          role: 'user',
          content: 'Look up ticket ABC-123.',
          createdAt: '2026-06-27T00:00:01.000Z',
          status: 'complete',
        },
        {
          id: 'msg_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: 'Done.',
          createdAt: '2026-06-27T00:00:02.000Z',
          completedAt: '2026-06-27T00:00:04.000Z',
          status: 'complete',
          toolRuns: [{
            id: 'call_dynamic',
            name: 'tickets__lookup_ticket',
            status: 'success',
            argumentsPreview: '{"id":"ABC-123"}',
            data: {
              contentItems: [{ type: 'inputText', text: 'Ticket ABC-123 is open.' }],
              success: true,
            },
            durationMs: 15,
          }],
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)[0]?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'dynamicToolCall',
        id: 'call_dynamic',
        tool: 'tickets__lookup_ticket',
        contentItems: [{ type: 'inputText', text: 'Ticket ABC-123 is open.' }],
        success: true,
        durationMs: 15,
      }),
    ]));
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

  it('projects mailbox deliveries into AppServer collabToolCall history items', () => {
    const thread: RuntimeThread = {
      id: 'thread_parent',
      title: 'Mailbox thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:03.000Z',
      archived: false,
      messageCount: 2,
      lastMessagePreview: 'Handled.',
      lastSeq: 4,
      mailboxDeliveries: [
        {
          id: 'mail_1',
          turnId: 'turn_parent',
          createdAt: '2026-06-27T00:00:01.000Z',
          content: 'child found the regression',
          deliveryMode: 'queue_only',
          fromThreadId: 'thread_child',
          fromAgentId: 'agent_child',
        },
      ],
      messages: [
        {
          id: 'msg_user',
          turnId: 'turn_parent',
          role: 'user',
          content: 'Check auth.',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'complete',
        },
        {
          id: 'msg_assistant',
          turnId: 'turn_parent',
          role: 'assistant',
          content: 'Handled.',
          createdAt: '2026-06-27T00:00:02.000Z',
          completedAt: '2026-06-27T00:00:03.000Z',
          status: 'complete',
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)).toMatchObject([
      {
        id: 'turn_parent',
        items: [
          { type: 'userMessage', id: 'msg_user' },
          {
            type: 'collabToolCall',
            id: 'mailbox_mail_1',
            tool: 'send_input',
            status: 'completed',
            senderThreadId: 'thread_child',
            receiverThreadId: 'thread_parent',
            prompt: 'child found the regression',
          },
          { type: 'agentMessage', id: 'msg_assistant', text: 'Handled.' },
        ],
      },
    ]);
  });

  it('projects persisted Plan mode assistant messages as AppServer plan items', () => {
    const thread: RuntimeThread = {
      id: 'thread_plan',
      title: 'Plan thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:02.000Z',
      archived: false,
      messageCount: 2,
      lastMessagePreview: '1. Inspect first.',
      lastSeq: 2,
      messages: [
        {
          id: 'msg_user',
          turnId: 'turn_plan',
          role: 'user',
          content: 'Plan before editing.',
          createdAt: '2026-06-27T00:00:00.000Z',
          status: 'complete',
        },
        {
          id: 'msg_plan',
          turnId: 'turn_plan',
          role: 'assistant',
          content: '1. Inspect first.\n2. Wait for confirmation.',
          createdAt: '2026-06-27T00:00:01.000Z',
          completedAt: '2026-06-27T00:00:02.000Z',
          status: 'complete',
          planMode: { mode: 'plan', status: 'awaiting_confirmation' },
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)).toMatchObject([
      {
        id: 'turn_plan',
        items: [
          { type: 'userMessage', id: 'msg_user' },
          {
            type: 'plan',
            id: 'msg_plan',
            text: '1. Inspect first.\n2. Wait for confirmation.',
            status: 'awaiting_confirmation',
          },
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

  it('keeps stored review mode markers when canonical stream items exist', () => {
    const thread: RuntimeThread = {
      id: 'thread_review',
      title: 'Review stream thread',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:04.000Z',
      archived: false,
      messageCount: 4,
      lastMessagePreview: 'Captured.',
      lastSeq: 4,
      turns: [{
        id: 'turn_review',
        startedAt: '2026-06-27T00:00:00.000Z',
        completedAt: '2026-06-27T00:00:04.000Z',
        status: 'completed',
        items: [{
          id: 'ai_sdk_agent_message_0',
          kind: 'agent_message',
          status: 'completed',
          content: 'Captured.',
        }],
      }],
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
          content: 'Captured.',
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
          reviewMode: { kind: 'exited', review: 'Captured.' },
        },
      ],
    };

    expect(runtimeThreadToSweTurns(thread)[0]?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'userMessage', id: 'turn_review' }),
      expect.objectContaining({ type: 'enteredReviewMode', id: 'turn_review', review: 'commit 1234567: Tidy UI colors' }),
      expect.objectContaining({ type: 'agentMessage', text: 'Captured.' }),
      expect.objectContaining({ type: 'exitedReviewMode', id: 'turn_review', review: 'Captured.' }),
    ]));
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
