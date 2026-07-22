import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { RuntimeEventWriter } from '../../../src/loop/lifecycle/runtime-event-writer.js';
import { systemClock } from '../../../src/ports/clock.js';

describe('runtime event writer', () => {
  it('coalesces stream deltas and flushes them before terminal events', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-test-')), systemClock, new RandomIdGenerator());
    const eventBus = new InMemoryEventBus();
    const writer = new RuntimeEventWriter(store, eventBus, 10_000);
    const thread = await store.createThread({ title: 'Delta batching' });
    const published: RuntimeEvent[] = [];
    eventBus.subscribe(thread.id, (event) => published.push(event));
    const createdAt = systemClock.now().toISOString();

    await writer.append(thread.id, {
      id: 'event_message',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.created',
      createdAt,
      payload: {
        message: {
          id: 'msg_1', turnId: 'turn_1', role: 'assistant', content: '', createdAt, status: 'streaming',
        },
      },
    });
    for (const [index, text] of ['a', 'b', 'c'].entries()) {
      await writer.append(thread.id, {
        id: `event_delta_${index}`,
        threadId: thread.id,
        turnId: 'turn_1',
        type: 'message.delta',
        createdAt,
        payload: { messageId: 'msg_1', text },
      });
    }
    await writer.append(thread.id, {
      id: 'event_completed',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt,
      payload: { messageId: 'msg_1' },
    });

    const events = await store.listEvents(thread.id);
    expect(events.map((event) => event.type)).toEqual([
      'thread.created', 'message.created', 'message.delta', 'message.completed',
    ]);
    expect(events[2]).toMatchObject({ payload: { messageId: 'msg_1', text: 'abc' } });
    expect(published.map((event) => event.type)).toEqual(['message.created', 'message.delta', 'message.completed']);
    await expect(store.getThread(thread.id)).resolves.toMatchObject({
      messages: [expect.objectContaining({ id: 'msg_1', content: 'abc', status: 'complete' })],
    });
  });

  it('keeps only the latest buffered tool preview before execution starts', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-preview-test-')), systemClock, new RandomIdGenerator());
    const eventBus = new InMemoryEventBus();
    const writer = new RuntimeEventWriter(store, eventBus, 10_000);
    const thread = await store.createThread({ title: 'Tool preview batching' });
    const createdAt = systemClock.now().toISOString();

    await writer.append(thread.id, {
      id: 'event_message',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.created',
      createdAt,
      payload: {
        message: { id: 'msg_1', turnId: 'turn_1', role: 'assistant', content: '', createdAt, status: 'streaming' },
      },
    });
    for (const argumentsLength of [10, 20, 30]) {
      await writer.append(thread.id, {
        id: `event_preview_${argumentsLength}`,
        threadId: thread.id,
        turnId: 'turn_1',
        type: 'tool.preview',
        createdAt,
        payload: {
          toolCallId: 'call_1',
          toolName: 'write_file',
          argumentsPreview: `preview-${argumentsLength}`,
          argumentsLength,
        },
      });
    }
    await writer.append(thread.id, {
      id: 'event_started',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'tool.started',
      createdAt,
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        argumentsPreview: '{"file_path":"src/generated.ts","content":"done"}',
      },
    });

    const previews = (await store.listEvents(thread.id)).filter((event) => event.type === 'tool.preview');
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      id: 'event_preview_30',
      payload: { toolCallId: 'call_1', argumentsPreview: 'preview-30', argumentsLength: 30 },
    });
    await expect(store.getThread(thread.id)).resolves.toMatchObject({
      messages: [expect.objectContaining({
        toolRuns: [expect.objectContaining({ id: 'call_1', phase: 'executing', status: 'running' })],
      })],
    });
  });
});
