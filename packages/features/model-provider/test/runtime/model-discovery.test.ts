import type { Api, Model } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAvailableModels } from '../../src/runtime/model-discovery.js';

afterEach(() => vi.useRealTimers());

describe('model discovery', () => {
  it('fills exact upstream model IDs on a custom gateway using only the supplied catalog', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [
      { id: 'catalog-model', name: 'Gateway display name' },
      { id: 'catalog-model-latest' },
      { id: 'CATALOG-MODEL' },
    ] }));
    const models = await fetchAvailableModels({
      provider: 'openai-compatible', catalogProviderId: null, baseUrl: 'https://gateway.test/v1',
    }, null, fetchImpl, undefined, 'test', [catalogProvider('upstream')]);

    expect(models).toEqual([
      {
        id: 'catalog-model', name: 'Gateway display name', contextWindowTokens: 256_000, maxOutputTokens: 32_000,
        thinkingEnabled: true, thinkingEfforts: ['low', 'medium', 'high'], defaultThinkingEffort: 'medium', supportsImages: true,
      },
      { id: 'catalog-model-latest', name: 'catalog-model-latest' },
      { id: 'CATALOG-MODEL', name: 'CATALOG-MODEL' },
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith('https://gateway.test/v1/models', expect.anything());
  });

  it.each([
    [null, 'https://gateway.test/v1', undefined],
    ['primary', 'https://gateway.test/v1', 256_000],
    ['secondary', 'https://gateway.test/v1', 128_000],
    [undefined, 'https://primary.test/v1', 256_000],
    ['missing-provider', 'https://gateway.test/v1', undefined],
  ] as const)('resolves shared IDs using catalog identity %s and endpoint %s', async (catalogProviderId, baseUrl, contextWindowTokens) => {
    const models = await fetchAvailableModels({ provider: 'openai-responses', catalogProviderId, baseUrl }, null,
      async () => Response.json({ data: ['catalog-model'] }), undefined, 'test', [
        catalogProvider('primary'), catalogProvider('secondary', { contextWindow: 128_000 }),
      ]);
    if (contextWindowTokens === undefined) {
      expect(models).toEqual([{ id: 'catalog-model', name: 'catalog-model' }]);
    } else {
      expect(models[0]).toMatchObject({ contextWindowTokens, thinkingEnabled: true, supportsImages: true });
    }
  });

  it('accepts duplicate IDs with identical capabilities without inheriting provider-specific metadata', async () => {
    const models = await fetchAvailableModels({ provider: 'openai-compatible', baseUrl: 'https://gateway.test/v1' }, null,
      async () => Response.json({ data: ['catalog-model'] }), undefined, 'test', [
        catalogProvider('primary'), catalogProvider('secondary', { name: 'Another display name', headers: { 'x-private': 'secret' } }),
      ]);
    expect(models[0]).toMatchObject({ contextWindowTokens: 256_000, supportsImages: true });
    expect(models[0]).not.toHaveProperty('provider');
    expect(models[0]).not.toHaveProperty('baseUrl');
    expect(models[0]).not.toHaveProperty('headers');
  });

  it.each([
    { contextWindowTokens: 64_000, maxOutputTokens: 4_000, thinkingEnabled: false, supportsImages: false },
    { thinkingEfforts: ['custom'], defaultThinkingEffort: 'custom' },
    { thinkingEfforts: [] },
  ])('keeps explicit server capabilities authoritative: %j', async (capabilities) => {
    const models = await fetchAvailableModels({ provider: 'openai-compatible', baseUrl: 'https://gateway.test/v1' }, null,
      async () => Response.json({ data: [{ id: 'catalog-model', ...capabilities }] }), undefined, 'test', [catalogProvider('primary')]);
    expect(models[0]).toMatchObject(capabilities);
    expect(models[0]?.contextWindowTokens).toBe('contextWindowTokens' in capabilities ? capabilities.contextWindowTokens : 256_000);
    if (!('defaultThinkingEffort' in capabilities)) {
      expect(models[0]?.defaultThinkingEffort).toBeUndefined();
      expect(models[0]?.thinkingEfforts).toEqual([]);
    }
  });

  it.each([
    ['https://models.test', undefined],
    ['https://models.test', '2023-01-01'],
    ['https://models.test/v1', undefined],
    ['https://models.test/v1/', undefined],
  ])('discovers Anthropic models with custom authentication (base: %s, version override: %s)', async (baseUrl, version) => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      Response.json({ data: [{ id: 'claude-model' }] })
    ));
    await fetchAvailableModels({
      provider: 'anthropic', baseUrl, apiKey: '',
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

function catalogProvider(id: string, overrides: Partial<Model<Api>> = {}) {
  const model: Model<Api> = {
    id: 'catalog-model', name: 'Catalog model', api: 'openai-responses', provider: id,
    baseUrl: `https://${id}.test/v1`, reasoning: true, input: ['text', 'image'],
    contextWindow: 256_000, maxTokens: 32_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    thinkingLevelMap: { minimal: null, low: 'low', medium: 'medium', high: 'high' },
    ...overrides,
  };
  return { ...openaiProvider(), id, name: id, getModels: () => [model] };
}
