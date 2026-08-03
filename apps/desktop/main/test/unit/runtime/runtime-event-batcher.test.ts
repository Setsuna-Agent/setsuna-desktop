import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeEventBatcher } from '../../../src/runtime/runtime-event-batcher.js';

describe('runtime event batcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers ordered stream events once per frame-sized interval', () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const batcher = new RuntimeEventBatcher(deliver, { flushIntervalMs: 16 });

    batcher.enqueue(messageDelta(1, 'a'));
    batcher.enqueue(messageDelta(2, 'b'));
    vi.advanceTimersByTime(15);
    expect(deliver).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver.mock.calls[0]?.[0].events.map((event: RuntimeEvent) => event.seq))
      .toEqual([1, 2]);
  });

  it('flushes pending deltas together with a terminal event immediately', () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const batcher = new RuntimeEventBatcher(deliver, { flushIntervalMs: 16 });

    batcher.enqueue(messageDelta(1, 'partial'));
    batcher.enqueue(turnCompleted(2));

    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver.mock.calls[0]?.[0].events.map((event: RuntimeEvent) => event.type))
      .toEqual(['message.delta', 'turn.completed']);
    vi.runAllTimers();
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('bounds a live batch and drops pending work when cancelled', () => {
    vi.useFakeTimers();
    const deliver = vi.fn();
    const batcher = new RuntimeEventBatcher(deliver, {
      flushIntervalMs: 16,
      maxBatchSize: 2,
    });

    batcher.enqueue(messageDelta(1, 'a'));
    batcher.enqueue(messageDelta(2, 'b'));
    expect(deliver).toHaveBeenCalledOnce();

    batcher.enqueue(messageDelta(3, 'c'));
    batcher.cancel();
    vi.runAllTimers();
    expect(deliver).toHaveBeenCalledOnce();
  });
});

function messageDelta(seq: number, text: string): RuntimeEvent {
  return {
    id: `event_${seq}`,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'message.delta',
    createdAt: '2026-08-03T00:00:00.000Z',
    payload: { messageId: 'message_1', text },
  };
}

function turnCompleted(seq: number): RuntimeEvent {
  return {
    id: `event_${seq}`,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'turn.completed',
    createdAt: '2026-08-03T00:00:01.000Z',
    payload: {},
  };
}
