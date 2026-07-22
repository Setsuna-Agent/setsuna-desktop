import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../../src/events.js';
import {
  createSweNotificationMapper,
  runtimeEventToSweNotifications
} from '../../src/swe-events.js';

describe('runtime AppServer SWE assistant streaming', () => {
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
});
