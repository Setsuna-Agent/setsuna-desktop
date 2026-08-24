import { describe, expect, it } from 'vitest';
import type { StoredFeatureEventEnvelope } from '../src/events.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';

describe('Feature event Core projection compatibility', () => {
  it('advances the durable sequence without interpreting an event whose owner is absent', () => {
    const thread: RuntimeThread = {
      id: 'thread_1',
      title: 'Historical thread',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      messages: [],
      lastSeq: 3,
    };
    const event: StoredFeatureEventEnvelope = {
      id: 'event_7',
      seq: 7,
      threadId: thread.id,
      type: 'feature.event',
      createdAt: '2026-08-01T00:00:07.000Z',
      featureId: 'removed-feature',
      eventType: 'removed-feature.state-changed',
      schemaVersion: 99,
      payload: { future: 'opaque' },
    };

    const projected = applyRuntimeEventToThread(thread, event);

    expect(projected).toMatchObject({
      lastSeq: 7,
      updatedAt: event.createdAt,
      title: thread.title,
      messageCount: 0,
    });
    expect(projected.messages).toBe(thread.messages);
  });
});
