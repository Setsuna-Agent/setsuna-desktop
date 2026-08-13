import { describe, expect, it } from 'vitest';
import {
  RUNTIME_ACTIVITY_EVENT_DISPOSITIONS,
  RUNTIME_SWE_EVENT_DISPOSITIONS,
  RUNTIME_THREAD_EVENT_DISPOSITIONS,
} from '../src/event-projections/dispositions.js';
import {
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
  type RuntimeEventType,
} from '../src/events.js';
import { runtimeEventToSweNotifications } from '../src/swe-events.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';

const THREAD_IGNORED_EVENT_TYPES = [
  'thread.deleted',
  'reasoning.summary_part_added',
  'runtime.warning',
] satisfies RuntimeEventType[];

const SWE_IGNORED_EVENT_TYPES = [
  'thread.metadata_updated',
  'thread.memory_mode_updated',
  'thread.context_cleared',
  'turn.input_queued',
  'turn.input_updated',
  'turn.input_deleted',
  'message.updated',
  'messages.deleted',
  'messages.truncated',
  'hook.started',
  'hook.completed',
  'approval.override_registered',
  'runtime.warning',
] satisfies RuntimeEventType[];

const ACTIVITY_INCLUDED_EVENT_TYPES = [
  'thread.context_cleared',
  'thread.context_compacting',
  'thread.context_compacted',
  'turn.started',
  'tool.started',
  'tool.completed',
  'hook.started',
  'hook.completed',
  'approval.requested',
  'approval.resolved',
  'approval.override_registered',
  'turn.completed',
  'turn.cancelled',
  'runtime.warning',
  'runtime.error',
] satisfies RuntimeEventType[];

describe('runtime event projection dispositions', () => {
  it('classifies every runtime event exactly once for each consumer', () => {
    expect(RUNTIME_EVENT_TYPES).toHaveLength(47);

    for (const dispositions of [
      RUNTIME_THREAD_EVENT_DISPOSITIONS,
      RUNTIME_SWE_EVENT_DISPOSITIONS,
      RUNTIME_ACTIVITY_EVENT_DISPOSITIONS,
    ]) {
      expect(Object.keys(dispositions)).toEqual([...RUNTIME_EVENT_TYPES]);
      for (const disposition of Object.values(dispositions)) {
        if (disposition.action === 'ignore') {
          expect(disposition.reason.trim()).not.toBe('');
        }
      }
    }
  });

  it('locks the intentional thread, SWE, and activity boundaries', () => {
    expect(typesWithAction(RUNTIME_THREAD_EVENT_DISPOSITIONS, 'ignore'))
      .toEqual(THREAD_IGNORED_EVENT_TYPES);
    expect(typesWithAction(RUNTIME_SWE_EVENT_DISPOSITIONS, 'ignore'))
      .toEqual(SWE_IGNORED_EVENT_TYPES);
    expect(typesWithAction(RUNTIME_ACTIVITY_EVENT_DISPOSITIONS, 'include'))
      .toEqual(ACTIVITY_INCLUDED_EVENT_TYPES);
  });

  it('keeps explicitly ignored thread events out of domain state', () => {
    const thread = baseThread();
    const ignoredEvents: RuntimeEvent[] = [
      runtimeEvent('thread.deleted', {}),
      runtimeEvent('reasoning.summary_part_added', { itemId: 'reasoning_1' }),
      runtimeEvent('runtime.warning', { message: 'Warning retained in event history.' }),
    ];

    for (const [index, event] of ignoredEvents.entries()) {
      const projected = applyRuntimeEventToThread(thread, {
        ...event,
        seq: index + 1,
      } as RuntimeEvent);

      expect(projected).toEqual({
        ...thread,
        lastSeq: index + 1,
        updatedAt: event.createdAt,
      });
    }
  });

  it('emits no live SWE notification for explicitly ignored event types', () => {
    for (const type of SWE_IGNORED_EVENT_TYPES) {
      expect(runtimeEventToSweNotifications(runtimeEventWithOpaquePayload(type))).toEqual([]);
    }
  });
});

function typesWithAction(
  dispositions: Record<RuntimeEventType, { action: string }>,
  action: string,
): RuntimeEventType[] {
  return RUNTIME_EVENT_TYPES.filter((type) => dispositions[type].action === action);
}

function runtimeEvent<TType extends RuntimeEventType>(
  type: TType,
  payload: Extract<RuntimeEvent, { type: TType }>['payload'],
): Extract<RuntimeEvent, { type: TType }> {
  return {
    id: `event_${type}`,
    seq: 1,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type,
    createdAt: '2026-07-30T00:00:01.000Z',
    payload,
  } as Extract<RuntimeEvent, { type: TType }>;
}

function runtimeEventWithOpaquePayload(type: RuntimeEventType): RuntimeEvent {
  // Ignored SWE events must exit before inspecting their type-specific payload.
  return {
    id: `event_${type}`,
    seq: 1,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type,
    createdAt: '2026-07-30T00:00:01.000Z',
    payload: {},
  } as RuntimeEvent;
}

function baseThread(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    archived: false,
    messageCount: 1,
    lastMessagePreview: 'Hello',
    lastSeq: 0,
    messages: [{
      id: 'message_1',
      turnId: 'turn_1',
      role: 'assistant',
      content: 'Hello',
      createdAt: '2026-07-30T00:00:00.000Z',
      status: 'complete',
    }],
  };
}
