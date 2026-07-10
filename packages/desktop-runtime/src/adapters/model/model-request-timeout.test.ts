import { describe, expect, it } from 'vitest';
import { runWithModelTimeout, streamWithModelTimeout } from './model-request-timeout.js';

describe('model request timeout', () => {
  it('aborts a model stream that stops producing events', async () => {
    let receivedSignal: AbortSignal | undefined;
    const collect = async () => {
      for await (const _event of streamWithModelTimeout((signal) => {
        receivedSignal = signal;
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<string>>(() => undefined),
          }),
        };
      }, undefined, { idleTimeoutMs: 10, totalTimeoutMs: 100 })) {
        // The source deliberately never yields.
      }
    };

    await expect(collect()).rejects.toThrow('Model stream became idle');
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('passes through a healthy finite stream', async () => {
    const values: string[] = [];
    for await (const value of streamWithModelTimeout(async function* () {
      yield 'alpha';
      yield 'beta';
    }, undefined, { idleTimeoutMs: 100, totalTimeoutMs: 1_000 })) {
      values.push(value);
    }

    expect(values).toEqual(['alpha', 'beta']);
  });

  it('enforces a total timeout for non-streaming model operations', async () => {
    let receivedSignal: AbortSignal | undefined;
    const running = runWithModelTimeout((signal) => {
      receivedSignal = signal;
      return new Promise(() => undefined);
    }, undefined, { totalTimeoutMs: 10 });

    await expect(running).rejects.toThrow('Model request timed out');
    expect(receivedSignal?.aborted).toBe(true);
  });
});
