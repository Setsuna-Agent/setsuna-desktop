import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { InMemoryConversationDebugTraceStore } from '@setsuna-desktop/feature-conversation-debug/runtime';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { createTestThreadStore } from '../../support/thread-store.js';
import { RuntimeEventWriter } from '../../../src/loop/lifecycle/runtime-event-writer.js';
import { systemClock } from '../../../src/ports/clock.js';

describe('runtime event writer', () => {
  it('records per-turn stream coalescing metrics without adding transcript events', async () => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-metrics-test-')),
      systemClock,
      ids,
    );
    const debugTraces = new InMemoryConversationDebugTraceStore({
      id: (prefix) => ids.id(prefix),
      now: () => systemClock.now(),
    });
    const writer = new RuntimeEventWriter(
      store,
      new InMemoryEventBus(),
      10_000,
      debugTraces,
    );
    const thread = await store.createThread({ title: 'Stream metrics' });
    const createdAt = systemClock.now().toISOString();

    await writer.append(thread.id, {
      id: 'event_turn_started',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.started',
      createdAt,
      payload: { input: 'Measure this turn.' },
    });
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
      id: 'event_message_completed',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt,
      payload: { messageId: 'msg_1', content: 'abc' },
    });
    await writer.append(thread.id, {
      id: 'event_turn_completed',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.completed',
      createdAt,
      payload: {},
    });

    expect(debugTraces.list(thread.id).traces).toEqual([
      expect.objectContaining({
        afterEventSeq: 6,
        kind: 'stream.pipeline.summary',
        turnId: 'turn_1',
        payload: {
          batchFlushCount: 1,
          coalescedEventCount: 2,
          maxBufferedEventCount: 1,
          persistedEventCount: 5,
          persistedStreamCharacters: 3,
          persistedStreamDeltaCount: 1,
          receivedEventCount: 7,
          receivedMergeableEventCount: 3,
          receivedStreamCharacters: 3,
          receivedStreamDeltaCount: 3,
          terminalEventType: 'turn.completed',
        },
      }),
    ]);
    expect((await store.listEvents(thread.id)).map((event) => event.type)).toEqual([
      'thread.created',
      'turn.started',
      'message.created',
      'message.delta',
      'message.completed',
      'turn.completed',
    ]);
  });

  it('does not reopen finalized metrics for late events after cancellation', async () => {
    const ids = new RandomIdGenerator();
    const store = createTestThreadStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-cancelled-metrics-test-')),
      systemClock,
      ids,
    );
    const debugTraces = new InMemoryConversationDebugTraceStore({
      id: (prefix) => ids.id(prefix),
      now: () => systemClock.now(),
    });
    const writer = new RuntimeEventWriter(store, new InMemoryEventBus(), 10_000, debugTraces);
    const thread = await store.createThread({ title: 'Cancelled stream metrics' });
    const createdAt = systemClock.now().toISOString();

    await writer.append(thread.id, {
      id: 'event_turn_started',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.started',
      createdAt,
      payload: { input: 'Cancel this turn.' },
    });
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
    await writer.append(thread.id, {
      id: 'event_turn_cancelled',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.cancelled',
      createdAt,
      payload: { reason: 'User cancelled.' },
    });

    // A producer can still invoke its callbacks while unwinding the abort signal.
    await writer.append(thread.id, {
      id: 'event_late_delta',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt,
      payload: { messageId: 'msg_1', text: 'late' },
    });
    await writer.flushThread(thread.id);
    await writer.append(thread.id, {
      id: 'event_late_completed',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.completed',
      createdAt,
      payload: {},
    });

    expect(debugTraces.list(thread.id).traces).toEqual([
      expect.objectContaining({
        afterEventSeq: 4,
        kind: 'stream.pipeline.summary',
        turnId: 'turn_1',
        payload: expect.objectContaining({
          persistedEventCount: 3,
          receivedEventCount: 3,
          terminalEventType: 'turn.cancelled',
        }),
      }),
    ]);
  });

  it('coalesces stream deltas and flushes them before terminal events', async () => {
    const store = createTestThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-test-')), systemClock, new RandomIdGenerator());
    const eventBus = new InMemoryEventBus();
    const writer = new RuntimeEventWriter(store, eventBus, 10_000);
    const thread = await store.createThread({ title: 'Delta batching' });
    const published: StoredThreadEvent[] = [];
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

  it('preserves reasoning and content order when a channel resumes inside one batch', async () => {
    const store = createTestThreadStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-channel-order-test-')),
      systemClock,
      new RandomIdGenerator(),
    );
    const writer = new RuntimeEventWriter(store, new InMemoryEventBus(), 10_000);
    const thread = await store.createThread({ title: 'Channel order' });
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
    for (const [index, delta] of [
      { channel: 'reasoning' as const, text: 'reasoning-1' },
      { channel: 'content' as const, text: 'content-1' },
      { channel: 'reasoning' as const, text: 'reasoning-2' },
    ].entries()) {
      await writer.append(thread.id, {
        id: `event_delta_${index}`,
        threadId: thread.id,
        turnId: 'turn_1',
        type: 'message.delta',
        createdAt,
        payload: { messageId: 'msg_1', ...delta },
      });
    }
    await writer.append(thread.id, {
      id: 'event_completed',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt,
      payload: { messageId: 'msg_1', content: 'content-1' },
    });

    const persistedDeltas = (await store.listEvents(thread.id))
      .filter((event) => event.type === 'message.delta')
      .map((event) => event.payload);
    expect(persistedDeltas).toEqual([
      { messageId: 'msg_1', channel: 'reasoning', text: 'reasoning-1' },
      { messageId: 'msg_1', channel: 'content', text: 'content-1' },
      { messageId: 'msg_1', channel: 'reasoning', text: 'reasoning-2' },
    ]);
    await expect(store.getThread(thread.id)).resolves.toMatchObject({
      messages: [expect.objectContaining({
        content: 'content-1',
        streamParts: [
          { type: 'reasoning', content: 'reasoning-1' },
          { type: 'content', content: 'content-1' },
          { type: 'reasoning', content: 'reasoning-2' },
        ],
      })],
    });
  });

  it('coalesces dual-written item and message deltas from one stream', async () => {
    const store = createTestThreadStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-dual-stream-test-')),
      systemClock,
      new RandomIdGenerator(),
    );
    const writer = new RuntimeEventWriter(store, new InMemoryEventBus(), 10_000);
    const thread = await store.createThread({ title: 'Dual stream batching' });
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
        id: `event_item_${index}`,
        threadId: thread.id,
        turnId: 'turn_1',
        type: 'item.delta',
        createdAt,
        payload: { itemId: 'msg_1', delta: text },
      });
      await writer.append(thread.id, {
        id: `event_message_${index}`,
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
      payload: { messageId: 'msg_1', content: 'abc' },
    });

    const events = await store.listEvents(thread.id);
    expect(events.map((event) => event.type)).toEqual([
      'thread.created', 'message.created', 'item.delta', 'message.delta', 'message.completed',
    ]);
    expect(events[2]).toMatchObject({ type: 'item.delta', payload: { itemId: 'msg_1', delta: 'abc' } });
    expect(events[3]).toMatchObject({ type: 'message.delta', payload: { messageId: 'msg_1', text: 'abc' } });
  });

  it('does not move a reasoning delta backwards past an intervening item stream', async () => {
    const store = createTestThreadStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-cross-type-order-test-')),
      systemClock,
      new RandomIdGenerator(),
    );
    const writer = new RuntimeEventWriter(store, new InMemoryEventBus(), 10_000);
    const thread = await store.createThread({ title: 'Cross-type order' });
    const createdAt = systemClock.now().toISOString();

    const deltas = [
      {
        id: 'event_reasoning_1',
        type: 'reasoning.raw_delta',
        payload: { itemId: 'reasoning_item', contentIndex: 0, delta: 'first ' },
      },
      {
        id: 'event_item_1',
        type: 'item.delta',
        payload: { itemId: 'msg_1', delta: 'content' },
      },
      {
        id: 'event_reasoning_2',
        type: 'reasoning.raw_delta',
        payload: { itemId: 'reasoning_item', contentIndex: 0, delta: 'second' },
      },
    ] as const;
    for (const delta of deltas) {
      await writer.append(thread.id, {
        ...delta,
        threadId: thread.id,
        turnId: 'turn_1',
        createdAt,
      });
    }
    await writer.append(thread.id, {
      id: 'event_turn_completed',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.completed',
      createdAt,
      payload: {},
    });

    expect((await store.listEvents(thread.id)).slice(1)).toMatchObject([
      { id: 'event_reasoning_1', type: 'reasoning.raw_delta', payload: { delta: 'first ' } },
      { id: 'event_item_1', type: 'item.delta', payload: { delta: 'content' } },
      { id: 'event_reasoning_2', type: 'reasoning.raw_delta', payload: { delta: 'second' } },
      { id: 'event_turn_completed', type: 'turn.completed' },
    ]);
  });

  it('coalesces plan and reasoning parts without crossing turn or lifecycle boundaries', async () => {
    const store = createTestThreadStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-structured-delta-test-')),
      systemClock,
      new RandomIdGenerator(),
    );
    const eventBus = new InMemoryEventBus();
    const writer = new RuntimeEventWriter(store, eventBus, 10_000);
    const thread = await store.createThread({ title: 'Structured delta batching' });
    const createdAt = systemClock.now().toISOString();
    const published: StoredThreadEvent[] = [];
    eventBus.subscribe(thread.id, (event) => published.push(event));

    const deltas = [
      {
        id: 'event_plan_1a',
        turnId: 'turn_1',
        type: 'plan.delta',
        payload: { itemId: 'shared_item', delta: 'Inspect ' },
      },
      {
        id: 'event_plan_1b',
        turnId: 'turn_1',
        type: 'plan.delta',
        payload: { itemId: 'shared_item', delta: 'files.' },
      },
      {
        id: 'event_plan_2a',
        turnId: 'turn_2',
        type: 'plan.delta',
        payload: { itemId: 'shared_item', delta: 'Run ' },
      },
      {
        id: 'event_plan_2b',
        turnId: 'turn_2',
        type: 'plan.delta',
        payload: { itemId: 'shared_item', delta: 'tests.' },
      },
      {
        id: 'event_summary_0a',
        turnId: 'turn_1',
        type: 'reasoning.summary_delta',
        payload: { itemId: 'reasoning_item', summaryIndex: 0, delta: 'Need ' },
      },
      {
        id: 'event_summary_0b',
        turnId: 'turn_1',
        type: 'reasoning.summary_delta',
        payload: { itemId: 'reasoning_item', summaryIndex: 0, delta: 'context.' },
      },
      {
        id: 'event_summary_1a',
        turnId: 'turn_1',
        type: 'reasoning.summary_delta',
        payload: { itemId: 'reasoning_item', summaryIndex: 1, delta: 'Then ' },
      },
      {
        id: 'event_summary_1b',
        turnId: 'turn_1',
        type: 'reasoning.summary_delta',
        payload: { itemId: 'reasoning_item', summaryIndex: 1, delta: 'act.' },
      },
      {
        id: 'event_raw_0a',
        turnId: 'turn_1',
        type: 'reasoning.raw_delta',
        payload: { itemId: 'reasoning_item', contentIndex: 0, delta: 'raw ' },
      },
      {
        id: 'event_raw_0b',
        turnId: 'turn_1',
        type: 'reasoning.raw_delta',
        payload: { itemId: 'reasoning_item', contentIndex: 0, delta: 'zero' },
      },
      {
        id: 'event_raw_1a',
        turnId: 'turn_1',
        type: 'reasoning.raw_delta',
        payload: { itemId: 'reasoning_item', contentIndex: 1, delta: 'raw ' },
      },
      {
        id: 'event_raw_1b',
        turnId: 'turn_1',
        type: 'reasoning.raw_delta',
        payload: { itemId: 'reasoning_item', contentIndex: 1, delta: 'one' },
      },
    ] as const;
    for (const delta of deltas) {
      await writer.append(thread.id, {
        ...delta,
        threadId: thread.id,
        createdAt,
      });
    }

    await writer.append(thread.id, {
      id: 'event_summary_part',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'reasoning.summary_part_added',
      createdAt,
      payload: { itemId: 'reasoning_item', summaryIndex: 1 },
    });
    await writer.append(thread.id, {
      id: 'event_summary_after_boundary',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'reasoning.summary_delta',
      createdAt,
      payload: { itemId: 'reasoning_item', summaryIndex: 1, delta: 'After boundary.' },
    });
    await writer.append(thread.id, {
      id: 'event_turn_completed',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.completed',
      createdAt,
      payload: {},
    });

    const persisted = (await store.listEvents(thread.id)).slice(1);
    expect(persisted).toMatchObject([
      { id: 'event_plan_1a', turnId: 'turn_1', type: 'plan.delta', payload: { delta: 'Inspect files.' } },
      { id: 'event_plan_2a', turnId: 'turn_2', type: 'plan.delta', payload: { delta: 'Run tests.' } },
      { id: 'event_summary_0a', type: 'reasoning.summary_delta', payload: { summaryIndex: 0, delta: 'Need context.' } },
      { id: 'event_summary_1a', type: 'reasoning.summary_delta', payload: { summaryIndex: 1, delta: 'Then act.' } },
      { id: 'event_raw_0a', type: 'reasoning.raw_delta', payload: { contentIndex: 0, delta: 'raw zero' } },
      { id: 'event_raw_1a', type: 'reasoning.raw_delta', payload: { contentIndex: 1, delta: 'raw one' } },
      { id: 'event_summary_part', type: 'reasoning.summary_part_added' },
      { id: 'event_summary_after_boundary', type: 'reasoning.summary_delta', payload: { delta: 'After boundary.' } },
      { id: 'event_turn_completed', type: 'turn.completed' },
    ]);
    expect(published).toEqual(persisted);
  });

  it('keeps only the latest buffered tool preview before execution starts', async () => {
    const store = createTestThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-event-writer-preview-test-')), systemClock, new RandomIdGenerator());
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
