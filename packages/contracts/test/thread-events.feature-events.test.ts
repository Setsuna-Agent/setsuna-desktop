import { describe, expect, it } from 'vitest';
import type { StoredFeatureEventEnvelope } from '../src/events.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';

describe('Feature event Core projection compatibility', () => {
  it('separates feature provenance from navigation ownership and clears only explicitly supplied bindings', () => {
    const at = '2026-09-30T00:00:00Z';
    const thread: RuntimeThread = {
      id: 'thread_1', title: 'Execution', featureId: 'automation', createdAt: at, updatedAt: at,
      archived: false, messageCount: 0, lastMessagePreview: '', lastSeq: 0, messages: [],
    };
    const origin = { featureId: 'automation', entityId: 'task_1' };
    const visible = applyRuntimeEventToThread(thread, {
      id: 'event_1', seq: 1, threadId: thread.id, type: 'thread.updated', createdAt: at,
      payload: { featureId: null, projectId: 'iriya', origin },
    });
    expect(visible.featureId).toBeUndefined();
    expect(visible).toMatchObject({ projectId: 'iriya', origin });
    const renamed = applyRuntimeEventToThread(visible, {
      id: 'event_2', seq: 2, threadId: thread.id, type: 'thread.updated', createdAt: at,
      payload: { title: 'Renamed' },
    });
    expect(renamed).toMatchObject({ projectId: 'iriya', origin, title: 'Renamed' });
    const global = applyRuntimeEventToThread(renamed, {
      id: 'event_3', seq: 3, threadId: thread.id, type: 'thread.updated', createdAt: at,
      payload: { projectId: null },
    });
    expect(global.projectId).toBeUndefined();
    expect(global.origin).toEqual(origin);
    expect(thread.featureId).toBe('automation');
    expect(renamed.projectId).toBe('iriya');
  });

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
