import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../../src/events.js';
import {
  createSweNotificationMapper
} from '../../src/swe-events.js';

describe('runtime AppServer SWE canonical stream items', () => {
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
});
