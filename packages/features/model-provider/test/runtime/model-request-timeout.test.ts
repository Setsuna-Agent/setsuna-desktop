import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamWithModelTimeout } from '../../src/runtime/model-request-timeout.js';

const MINUTE_MS = 60_000;

afterEach(() => {
  vi.useRealTimers();
});

describe('model request lifetime', () => {
  it('keeps waiting for a slow first event and long pauses between events', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const stream = streamWithModelTimeout(async function* (signal) {
      requestSignal = signal;
      await new Promise((resolve) => setTimeout(resolve, 3 * MINUTE_MS));
      yield 'first';
      await new Promise((resolve) => setTimeout(resolve, 3 * MINUTE_MS));
      yield 'second';
    });

    const first = expect(stream.next()).resolves.toEqual({ value: 'first', done: false });
    await vi.advanceTimersByTimeAsync(3 * MINUTE_MS);
    await first;
    expect(requestSignal?.aborted).toBe(false);

    const second = expect(stream.next()).resolves.toEqual({ value: 'second', done: false });
    await vi.advanceTimersByTimeAsync(3 * MINUTE_MS);
    await second;
    expect(requestSignal?.aborted).toBe(false);
    await expect(stream.next()).resolves.toMatchObject({ done: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts at the total deadline even when earlier events arrived', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const close = vi.fn(async () => ({ value: undefined, done: true as const }));
    const next = vi.fn()
      .mockResolvedValueOnce({ value: 'first', done: false })
      .mockImplementation(() => new Promise(() => {}));
    const stream = streamWithModelTimeout((signal) => {
      requestSignal = signal;
      return { [Symbol.asyncIterator]: () => ({ next, return: close }) };
    });

    await expect(stream.next()).resolves.toEqual({ value: 'first', done: false });
    await vi.advanceTimersByTimeAsync(14 * MINUTE_MS);
    const pending = expect(stream.next()).rejects.toMatchObject({
      name: 'TimeoutError', message: 'Model request timed out.',
    });
    await vi.advanceTimersByTimeAsync(MINUTE_MS - 1);
    expect(requestSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(requestSignal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors user cancellation immediately while waiting for the provider', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const reason = new Error('User stopped the turn.');
    const close = vi.fn(async () => ({ value: undefined, done: true as const }));
    let requestSignal: AbortSignal | undefined;
    const stream = streamWithModelTimeout((signal) => {
      requestSignal = signal;
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<string>>(() => {}),
          return: close,
        }),
      };
    }, parent.signal);

    const pending = expect(stream.next()).rejects.toBe(reason);
    parent.abort(reason);
    await pending;
    expect(requestSignal?.reason).toBe(reason);
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
