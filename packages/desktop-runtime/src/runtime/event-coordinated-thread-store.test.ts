import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../adapters/store/json-thread-store.js';
import { RuntimeEventWriter } from '../loop/runtime-event-writer.js';
import { systemClock } from '../ports/clock.js';
import { EventCoordinatedThreadStore } from './event-coordinated-thread-store.js';

describe('event-coordinated thread store', () => {
  it('flushes buffered deltas before assigning seq to a direct mutation', async () => {
    const inner = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-coordinated-store-test-')), systemClock, new RandomIdGenerator());
    const writer = new RuntimeEventWriter(inner, new InMemoryEventBus(), 10_000);
    const store = new EventCoordinatedThreadStore(inner, writer);
    const thread = await store.createThread({ title: 'Original title' });
    const createdAt = systemClock.now().toISOString();
    await writer.append(thread.id, {
      id: 'event_message',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.created',
      createdAt,
      payload: {
        message: {
          id: 'msg_1',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt,
          status: 'streaming',
        },
      },
    });
    await writer.append(thread.id, {
      id: 'event_delta',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt,
      payload: { messageId: 'msg_1', text: 'before metadata' },
    });

    await store.updateThread(thread.id, { title: 'Updated title' });

    const events = await store.listEvents(thread.id);
    expect(events.slice(-2).map((event) => event.type)).toEqual(['message.delta', 'thread.updated']);
    await expect(store.getThread(thread.id)).resolves.toMatchObject({
      title: 'Updated title',
      messages: [expect.objectContaining({ content: 'before metadata' })],
    });
  });
});
