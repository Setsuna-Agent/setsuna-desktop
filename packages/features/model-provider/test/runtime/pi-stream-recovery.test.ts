import type { ModelStreamEvent } from '@setsuna-desktop/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamWithModelTimeout } from '../../src/runtime/model-request-timeout.js';
import { recoverIncompletePiStream } from '../../src/runtime/pi-stream-recovery.js';

afterEach(() => vi.useRealTimers());

describe('incomplete Pi stream recovery', () => {
  it('retains failed reasoning separately and only emits successful replay metadata', async () => {
    vi.useFakeTimers();
    const createStream = vi.fn(() => attempt(createStream.mock.calls.length));
    const pending = collect(recoverIncompletePiStream(createStream, new AbortController().signal));

    await vi.advanceTimersByTimeAsync(1_000);
    const events = await pending;
    expect(createStream).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual({
      type: 'item_completed',
      item: { id: 'reasoning-1', kind: 'reasoning', content: 'partial', status: 'failed' },
    });
    expect(events.filter((event) => event.type === 'model_verification')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'assistant_metadata')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'text_delta')).toEqual([{ type: 'text_delta', text: 'answer' }]);
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'stop' });
  });

  it('stops after two stream retries and preserves the original error', async () => {
    vi.useFakeTimers();
    const error = new Error('Stream ended without finish_reason');
    const createStream = vi.fn(() => failAfter([], error));
    const pending = expect(collect(recoverIncompletePiStream(createStream, new AbortController().signal)))
      .rejects.toBe(error);

    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(createStream).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each<ModelStreamEvent>([
    { type: 'item_started', item: { id: 'text', kind: 'agent_message', content: 'partial answer' } },
    { type: 'item_completed', item: { id: 'text', kind: 'agent_message', content: 'partial answer' } },
    { type: 'text_delta', text: 'partial answer' },
    { type: 'item_started', item: { id: 'call', kind: 'tool_call' } },
    { type: 'tool_call_delta', call: { id: 'call', name: 'write_file', argumentsDelta: '{' } },
    { type: 'tool_calls', toolCalls: [{ id: 'call', name: 'write_file', arguments: '{}' }] },
  ])('does not replay after $type output', async (event) => {
    const error = new Error('Stream ended without finish_reason');
    const createStream = vi.fn(() => failAfter([event], error));

    await expect(collect(recoverIncompletePiStream(createStream, new AbortController().signal)))
      .rejects.toBe(error);
    expect(createStream).toHaveBeenCalledOnce();
  });

  it.each([false, true])('retries after an empty text item lifecycle (completed: %s)', async (completed) => {
    vi.useFakeTimers();
    const emptyText: ModelStreamEvent[] = [
      { type: 'item_started', item: { id: 'text', kind: 'agent_message', content: '' } },
      ...(completed ? [{
        type: 'item_completed' as const,
        item: { id: 'text', kind: 'agent_message' as const, content: '', status: 'completed' as const },
      }] : []),
    ];
    const createStream = vi.fn(() => createStream.mock.calls.length === 1
      ? failAfter(emptyText, new Error('Stream ended without finish_reason'))
      : attempt(2));
    const pending = expect(collect(recoverIncompletePiStream(createStream, new AbortController().signal)))
      .resolves.toContainEqual({ type: 'done', finishReason: 'stop' });

    await Promise.all([pending, vi.advanceTimersByTimeAsync(1_000)]);
    expect(createStream).toHaveBeenCalledTimes(2);
  });

  it('does not retry unrelated errors after reasoning', async () => {
    const error = Object.assign(new Error('Unauthorized'), { status: 401 });
    const createStream = vi.fn(() => failAfter([
      { type: 'item_started', item: { id: 'reasoning', kind: 'reasoning' } },
      { type: 'item_delta', itemId: 'reasoning', delta: 'partial' },
    ], error));

    await expect(collect(recoverIncompletePiStream(createStream, new AbortController().signal)))
      .rejects.toBe(error);
    expect(createStream).toHaveBeenCalledOnce();
  });

  it('cancels the retry backoff without starting another request', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const createStream = vi.fn(() => failAfter([], new Error('Stream ended without finish_reason')));
    const cancelled = new Error('User stopped the turn.');
    const pending = expect(collect(recoverIncompletePiStream(createStream, parent.signal))).rejects.toBe(cancelled);

    await vi.advanceTimersByTimeAsync(500);
    parent.abort(cancelled);
    await pending;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(createStream).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares the original deadline across stream retries and backoff', async () => {
    vi.useFakeTimers();
    const createStream = vi.fn(async function* (): AsyncGenerator<ModelStreamEvent> {
      yield { type: 'item_started', item: { id: 'thinking', kind: 'reasoning' } };
      await new Promise((resolve) => setTimeout(resolve, 400));
      throw new Error('Stream ended without finish_reason');
    });
    const stream = streamWithModelTimeout(
      (signal) => recoverIncompletePiStream(createStream, signal),
      undefined,
      { totalTimeoutMs: 2_000 },
    );
    const pending = expect(collect(stream)).rejects.toMatchObject({ name: 'TimeoutError' });

    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(createStream).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

async function* attempt(number: number): AsyncGenerator<ModelStreamEvent> {
  yield { type: 'item_started', item: { id: `reasoning-${number}`, kind: 'reasoning' } };
  yield { type: 'item_delta', itemId: `reasoning-${number}`, delta: 'partial' };
  if (number === 1) throw new Error('Stream ended without finish_reason');
  yield {
    type: 'item_completed',
    item: { id: `reasoning-${number}`, kind: 'reasoning', content: 'partial', status: 'completed' },
  };
  yield { type: 'text_delta', text: 'answer' };
  yield { type: 'assistant_metadata', providerMetadata: { schemaVersion: 3 } };
  yield { type: 'done', finishReason: 'stop' };
}

async function* failAfter(events: ModelStreamEvent[], error: Error): AsyncGenerator<ModelStreamEvent> {
  yield* events;
  throw error;
}

async function collect(stream: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
