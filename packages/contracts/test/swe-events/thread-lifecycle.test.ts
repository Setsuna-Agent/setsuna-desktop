import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../../src/events.js';
import {
  createSweNotificationMapper,
  runtimeEventToSweNotifications
} from '../../src/swe-events.js';

describe('runtime AppServer SWE thread lifecycle', () => {
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
});
