import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAvailableModels } from '../../src/runtime/model-discovery.js';

afterEach(() => vi.useRealTimers());

describe('model discovery', () => {
  it.each([undefined, '2023-01-01'])('sends Anthropic versioning with custom authentication (version override: %s)', async (version) => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      Response.json({ data: [{ id: 'claude-model' }] })
    ));
    await fetchAvailableModels({
      provider: 'anthropic', baseUrl: 'https://models.test', apiKey: '',
      requestHeaders: { 'x-api-key': 'custom-key', ...(version ? { 'anthropic-version': version } : {}) },
    }, null, fetchImpl);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://models.test/v1/models');
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-api-key')).toBe('custom-key');
    expect(headers.get('anthropic-version')).toBe(version ?? '2023-06-01');
  });

  it('applies edited headers during discovery and omits session templates without a conversation', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ data: [{ id: 'model' }] }))
    ));
    await fetchAvailableModels({
      provider: 'openai-compatible', baseUrl: 'https://models.test/v1',
      requestHeaders: { 'User-Agent': 'my-client/{{appVersion}}', Authorization: 'custom-auth', 'x-session': '{{sessionId}}' },
    }, null, fetchImpl, undefined, '1.2.3');
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get('user-agent')).toBe('my-client/1.2.3');
    expect(headers.get('authorization')).toBe('custom-auth');
    expect(headers.has('x-session')).toBe(false);
  });

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
