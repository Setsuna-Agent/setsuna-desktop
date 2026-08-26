import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAvailableModels } from '../../src/runtime/model-discovery.js';

afterEach(() => vi.useRealTimers());

describe('model discovery', () => {
  it('cancels the provider request when the feature route is aborted', async () => {
    const route = new AbortController();
    const reason = new DOMException('Client disconnected', 'AbortError');
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error('Expected discovery signal.'));
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })) as typeof fetch;

    const pending = fetchAvailableModels({
      provider: 'openai-compatible',
      baseUrl: 'https://models.example/v1',
    }, null, fetchImpl, route.signal);
    route.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('aborts a stalled provider request at the discovery timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error('Expected discovery signal.'));
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) as typeof fetch;

    const pending = fetchAvailableModels({
      provider: 'openai-compatible',
      baseUrl: 'https://models.example/v1',
    }, null, fetchImpl);
    const rejected = expect(pending).rejects.toThrow('模型列表请求超时。');
    await vi.advanceTimersByTimeAsync(10_000);

    await rejected;
  });
});
